// Runs inside the upstream export renderer's closure, once per page.
export const INCREMENTAL_RENDERER_JS = String.raw`
      const toolOwners = new Map();
      function indexLiveEntry(entry) {
        byId.set(entry.id, entry);
        if (entry.type === 'label') {
          if (entry.label) labelMap.set(entry.targetId, entry.label);
          else labelMap.delete(entry.targetId);
        }
        if (entry.type === 'message' && entry.message.role === 'assistant') {
          for (const block of entry.message.content || []) {
            if (block.type === 'toolCall') {
              toolOwners.set(block.id, entry.id);
              toolCallMap.set(block.id, { name: block.name, arguments: block.arguments });
            }
          }
        }
      }
      entries.forEach(indexLiveEntry);
      function preserveLivePresentation(oldNode, node) {
        if (!oldNode) return;
        for (const selector of ['.tool-execution', '.tool-output.expandable', '.thinking-text', '.thinking-collapsed']) {
          const oldParts = oldNode.querySelectorAll(selector);
          node.querySelectorAll(selector).forEach((part, index) => {
            const oldPart = oldParts[index];
            if (!oldPart) return;
            for (const name of ['webui-collapsed', 'webui-processed', 'expanded']) {
              part.classList.toggle(name, oldPart.classList.contains(name));
            }
            part.style.display = oldPart.style.display;
          });
        }
      }
      window.__piWebuiRenderer = {
        version: 1,
        data,
        byId,
        cursor() {
          return { sessionId: header.id, count: entries.length, lastId: entries.at(-1)?.id || null };
        },
        ingest(delta) {
          if (delta.sessionId !== header.id) throw new Error('Session changed. Reopen from /ssm.');
          const oldPath = getPath(currentLeafId);
          const follow = currentLeafId === data.leafId || !currentLeafId;
          const affected = new Set();
          if (delta.reset) {
            entries.length = 0;
            byId.clear(); labelMap.clear(); toolCallMap.clear(); toolOwners.clear(); entryCache.clear();
          }
          for (const entry of delta.entries) {
            if (byId.has(entry.id)) throw new Error('Duplicate entry in session delta.');
            entries.push(entry);
            indexLiveEntry(entry);
            affected.add(entry.id);
          }
          for (const entry of delta.entries) {
            if (entry.type === 'message' && entry.message.role === 'toolResult') {
              const owner = toolOwners.get(entry.message.toolCallId);
              if (owner) affected.add(owner);
            }
          }
          if (entries.length !== delta.count || (entries.at(-1)?.id || null) !== delta.lastId) {
            throw new Error('Session delta cursor mismatch.');
          }
          for (const id of affected) entryCache.delete(id);
          data.leafId = delta.leafId;
          const target = follow || !byId.has(currentLeafId) ? delta.leafId : currentLeafId;
          const path = getPath(target);
          treeNodeMap = null;
          globalStats = computeStats(entries);
          const samePrefix = !delta.reset && oldPath.length <= path.length &&
            oldPath.every((entry, index) => entry.id === path[index].id);
          if (!samePrefix) {
            navigateTo(target, 'none');
          } else {
            currentLeafId = target;
            if (follow) currentTargetId = target;
            forceTreeRerender();
            document.getElementById('header-container').innerHTML = renderHeader();
            attachHeaderHandlers();
            const messages = document.getElementById('messages');
            path.forEach((entry, index) => {
              if (index < oldPath.length && !affected.has(entry.id)) return;
              const node = renderEntryToNode(entry);
              if (!node) return;
              const oldNode = document.getElementById('entry-' + entry.id);
              preserveLivePresentation(oldNode, node);
              if (oldNode) oldNode.replaceWith(node);
              else messages.appendChild(node);
              node.querySelectorAll('.copy-link-btn').forEach(button => {
                button.addEventListener('click', event => {
                  event.stopPropagation();
                  copyToClipboard(buildShareUrl(button.dataset.entryId), button);
                });
              });
            });
          }
          window.dispatchEvent(new Event('webui-rendered'));
        }
      };
`;
