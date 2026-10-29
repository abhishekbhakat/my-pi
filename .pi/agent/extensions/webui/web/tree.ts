// Replaces only sidebar DOM emission. Upstream filtering, connectors and navigation stay intact.
export const WINDOWED_TREE_JS = String.raw`
      function renderTree() {
        const container = document.getElementById('tree-container');
        let state = container.__piLiveTree;
        if (!state) {
          state = container.__piLiveTree = {
            rows: [], active: new Set(), cache: new Map(), rowHeight: 13, start: -1, end: -1, frame: false
          };
          container.setAttribute('role', 'list');
          container.addEventListener('scroll', () => {
            if (state.frame) return;
            state.frame = true;
            requestAnimationFrame(() => { state.frame = false; drawLiveTree(container, state); });
          }, { passive: true });
          window.addEventListener('resize', () => { state.start = -1; drawLiveTree(container, state); });
          if (window.ResizeObserver) new ResizeObserver(() => {
            state.start = -1; drawLiveTree(container, state);
          }).observe(container);
        }
        const tree = buildTree();
        state.active = buildActivePathIds(currentLeafId);
        const flatNodes = flattenTree(tree, state.active);
        state.rows = filterNodes(flatNodes, currentLeafId);
        state.start = -1;
        const index = state.rows.findIndex(row => row.node.entry.id === currentTargetId);
        const viewport = Math.min(container.clientHeight || 600, window.innerHeight || 600);
        if (index >= 0) {
          const top = index * state.rowHeight;
          if (top < container.scrollTop || top + state.rowHeight > container.scrollTop + viewport) {
            // Store desired position before replacing the old filtered rows, whose height may be smaller.
            state.scrollTo = Math.max(0, top - viewport / 2);
          }
        }
        document.getElementById('tree-status').textContent = state.rows.length + ' / ' + flatNodes.length + ' entries';
        drawLiveTree(container, state);
        treeRendered = true;
      }

      function drawLiveTree(container, state) {
        const viewport = Math.min(container.clientHeight || 600, window.innerHeight || 600);
        const desiredTop = state.scrollTo === undefined ? container.scrollTop : state.scrollTo;
        const scrollTop = Math.max(0, Math.min(desiredTop, Math.max(0, state.rows.length * state.rowHeight - viewport)));
        if (desiredTop !== scrollTop) state.scrollTo = scrollTop;
        const start = Math.max(0, Math.floor(scrollTop / state.rowHeight) - 15);
        const end = Math.min(state.rows.length, Math.ceil((scrollTop + viewport) / state.rowHeight) + 15);
        if (state.start === start && state.end === end) return;
        state.start = start; state.end = end;
        const fragment = document.createDocumentFragment();
        const spacer = height => {
          const element = document.createElement('div');
          element.style.height = Math.max(0, height) + 'px';
          element.setAttribute('aria-hidden', 'true');
          fragment.appendChild(element);
        };
        spacer(start * state.rowHeight);
        const visible = new Set();
        for (let index = start; index < end; index++) {
          const row = state.rows[index];
          const entry = row.node.entry;
          visible.add(entry.id);
          let cached = state.cache.get(entry.id);
          if (!cached || cached.entry !== entry || cached.label !== row.node.label) {
            const node = document.createElement('div');
            node.className = 'tree-node';
            node.dataset.id = entry.id;
            node.setAttribute('role', 'listitem');
            node.style.height = state.rowHeight + 'px';
            node.style.overflow = 'hidden';
            const prefix = document.createElement('span'); prefix.className = 'tree-prefix';
            const marker = document.createElement('span'); marker.className = 'tree-marker';
            const content = document.createElement('span'); content.className = 'tree-content';
            content.innerHTML = getTreeNodeDisplayHtml(entry, row.node.label);
            node.append(prefix, marker, content);
            node.addEventListener('click', () => {
              if (window.getSelection().toString()) return;
              navigateTo(findNewestLeaf(entry.id), 'target', entry.id);
            });
            cached = { node, prefix, marker, entry, label: row.node.label };
            state.cache.set(entry.id, cached);
          }
          cached.prefix.textContent = buildTreePrefix(row);
          cached.marker.textContent = state.active.has(entry.id) ? '•' : ' ';
          cached.node.classList.toggle('in-path', state.active.has(entry.id));
          cached.node.classList.toggle('active', entry.id === currentTargetId);
          cached.node.setAttribute('aria-posinset', String(index + 1));
          cached.node.setAttribute('aria-setsize', String(state.rows.length));
          fragment.appendChild(cached.node);
        }
        spacer((state.rows.length - end) * state.rowHeight);
        container.replaceChildren(fragment);
        if (state.scrollTo !== undefined) {
          container.scrollTop = state.scrollTo;
          delete state.scrollTo;
        }
        // Bound cached DOM nodes as well as mounted rows.
        for (const id of state.cache.keys()) if (!visible.has(id)) state.cache.delete(id);
      }
`;

// Path compression preserves nearest-visible-parent semantics without repeated long parent walks.
export const VISIBLE_ANCESTOR_JS = String.raw`
        const ancestorCache = new Map();
        function findVisibleAncestor(nodeId) {
          let currentId = entryMap.get(nodeId)?.node.entry.parentId;
          const traversed = [];
          const visiting = new Set();
          while (currentId != null && !visibleIds.has(currentId) && !ancestorCache.has(currentId)) {
            if (visiting.has(currentId)) { currentId = null; break; }
            visiting.add(currentId); traversed.push(currentId);
            currentId = entryMap.get(currentId)?.node.entry.parentId;
          }
          const result = currentId == null ? null : visibleIds.has(currentId) ? currentId : ancestorCache.get(currentId);
          for (const id of traversed) ancestorCache.set(id, result);
          return result;
        }
`;
