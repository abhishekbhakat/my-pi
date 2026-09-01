/** SSM layout CSS. Same tokens/fonts as webui export-html. Vertical padding 50% of original. */
export const SSM_PAGE_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
:root { --line-height: 18px; --panel-border: var(--dim); }
html, body { height: 100%; }
body {
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
  font-size: 12px; line-height: var(--line-height); color: var(--text);
  background: var(--body-bg); display: flex; flex-direction: column; min-height: 100%;
}
.theme-banner {
  padding: 3px 12px; background: var(--toolErrorBg, #3c2828); color: var(--error, #f88);
  border-bottom: 1px solid var(--panel-border); font-size: 11px;
}
.top {
  display: flex; gap: 12px; justify-content: space-between; align-items: flex-start;
  padding: 4px 12px; border-bottom: 1px solid var(--panel-border); background: var(--container-bg);
  flex-wrap: wrap; flex-shrink: 0;
}
h1 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text); }
.sub { margin: 1px 0 0; color: var(--muted); font-size: 11px; }
.top-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.chk {
  color: var(--muted); font-size: 11px; display: flex; gap: 4px; align-items: center;
  cursor: pointer; user-select: none;
}
input[type="search"], input[type="text"] {
  min-width: 18rem; padding: 2px 8px; border-radius: 3px; border: 1px solid var(--panel-border);
  background: var(--body-bg); color: var(--text); font: inherit; font-size: 11px;
}
input[type="search"]:focus, input[type="text"]:focus { outline: none; border-color: var(--accent); }
input[type="search"]::placeholder { color: var(--muted); }
button, .btn {
  padding: 1.5px 8px; border-radius: 3px; border: 1px solid var(--panel-border); background: transparent;
  color: var(--muted); cursor: pointer; font: inherit; font-size: 10px;
}
button:hover, .btn:hover { color: var(--text); border-color: var(--text); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--body-bg); }
button.primary:hover { opacity: 0.92; color: var(--body-bg); border-color: var(--accent); }
button.danger { border-color: var(--error); color: var(--error); }
.stats {
  padding: 3px 12px; border-bottom: 1px solid var(--panel-border); background: var(--body-bg);
  color: var(--muted); font-size: 11px; display: flex; gap: 12px; flex-wrap: wrap; flex-shrink: 0;
}
.stats .live-pill { color: var(--success); }
.layout {
  flex: 1; display: grid;
  grid-template-columns: minmax(200px, 280px) minmax(240px, 1.1fr) minmax(260px, 1fr);
  min-height: 0;
}
.folders, .sessions, .detail { overflow: auto; min-height: 0; }
.folders { background: var(--container-bg); border-right: 1px solid var(--panel-border); }
.sessions { background: var(--body-bg); border-right: 1px solid var(--panel-border); }
.detail { background: var(--body-bg); padding: 6px 12px; }
.folder {
  display: block; width: 100%; text-align: left; border: 0; border-radius: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-border) 55%, transparent);
  background: transparent; padding: 4px 10px; color: var(--text);
  font: inherit; font-size: 12px; cursor: pointer;
}
.folder:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.folder.active { background: var(--selectedBg); }
.folder .path { font-size: 11px; word-break: break-all; color: var(--text); }
.folder .meta { color: var(--muted); font-size: 10px; margin-top: 1px; }
.session-row {
  display: flex; gap: 4px; align-items: stretch;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-border) 55%, transparent);
  padding: 2px 6px 2px 0;
}
.session-row.active { background: var(--selectedBg); }
.session-row:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.session-select {
  flex: 1; min-width: 0; text-align: left; border: 0; border-radius: 0;
  background: transparent; padding: 3px 8px; color: var(--text);
  font: inherit; font-size: 12px; cursor: pointer;
}
.session-select .meta { color: var(--muted); font-size: 10px; margin-top: 1px; }
.session-select .title { font-weight: 600; font-size: 12px; }
.session-select .preview {
  color: var(--muted); font-size: 11px; margin-top: 1.5px; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.badge {
  display: inline-block; font-size: 9px; padding: 0.5px 5px; border-radius: 3px;
  border: 1px solid var(--dim); color: var(--muted); margin-right: 4px;
  vertical-align: 1px; text-transform: lowercase;
}
.badge.live { color: var(--success); border-color: color-mix(in srgb, var(--success) 50%, var(--dim)); }
.badge.archived { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 50%, var(--dim)); }
.empty { color: var(--muted); font-size: 11px; padding: 4px 0; }
.detail h2 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.detail dl {
  display: grid; grid-template-columns: 72px 1fr; gap: 2px 8px; margin: 0 0 6px; font-size: 11px;
}
.detail dt { color: var(--muted); }
.detail dd { margin: 0; word-break: break-all; color: var(--text); }
.detail .preview-box {
  background: var(--userMessageBg, var(--container-bg)); border: 1px solid var(--panel-border);
  border-radius: 3px; padding: 4px 10px; white-space: pre-wrap; font-size: 12px;
  margin-bottom: 6px; color: var(--userMessageText, var(--text));
}
.detail .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 5px; }
.detail code.cmd {
  display: block; background: var(--container-bg); border: 1px solid var(--panel-border);
  border-radius: 3px; padding: 4px 10px; font: inherit; font-size: 11px;
  white-space: pre-wrap; word-break: break-all; color: var(--mdCode, var(--accent));
}
@media (max-width: 960px) {
  .layout { grid-template-columns: 1fr; }
  .folders, .sessions { max-height: 12rem; border-right: none; border-bottom: 1px solid var(--panel-border); }
}
`;
