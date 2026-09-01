/**
 * Read-only export-html view of any session file (not the live agent UI).
 * Same template/assets as /webui so layout matches.
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { loadCoreExportHtmlAssets, renderCoreCss } from "../core/assets";
import { findSession, getCatalog } from "./sessions";

/**
 * Banner must attach to document.body, NOT #app.
 * #app is display:flex row (sidebar | content). A banner child becomes a
 * phantom left column and looks like "empty space".
 */
const VIEW_BANNER_JS = [
	"(function () {",
	'  "use strict";',
	"  if (document.getElementById('ssm-view-banner')) return;",
	"",
	"  var style = document.createElement('style');",
	"  style.id = 'ssm-view-style';",
	"  style.textContent = [",
	"    '#ssm-view-banner {',",
	"    '  position: sticky; top: 0; z-index: 100;',",
	"    '  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;',",
	"    '  padding: 8px 12px;',",
	"    '  font: 12px ui-monospace, Menlo, Consolas, monospace;',",
	"    '  color: var(--text);',",
	"    '  background: var(--exportCardBg, var(--container-bg, #1e1e24));',",
	"    '  border-bottom: 1px solid var(--dim);',",
	"    '}',",
	"    '#ssm-view-banner .muted { color: var(--muted); font-size: 11px; }',",
	"    '#ssm-view-banner a {',",
	"    '  color: var(--accent); text-decoration: none;',",
	"    '  border: 1px solid var(--dim); border-radius: 3px;',",
	"    '  padding: 3px 8px; font-size: 11px;',",
	"    '}',",
	"    '#ssm-view-banner a:hover { border-color: var(--accent); }',",
	"    '#ssm-view-banner .spacer { flex: 1; }',",
	"    '#webui-scroll-bottom { position: fixed; bottom: 24px; right: 24px; z-index: 30;',",
	"    '  width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--dim);',",
	"    '  background: var(--exportCardBg, var(--container-bg)); color: var(--text); font-size: 18px;',",
	"    '  cursor: pointer; display: none; align-items: center; justify-content: center;',",
	"    '  box-shadow: 0 2px 8px rgba(0,0,0,0.3); opacity: 0; transition: opacity 0.2s; }',",
	"    '#webui-scroll-bottom.visible { display: flex; opacity: 0.85; }',",
	"    '#webui-scroll-bottom:hover { opacity: 1; background: var(--selectedBg); }'",
	"  ].join('\\n');",
	"  document.head.appendChild(style);",
	"",
	"  var bar = document.createElement('div');",
	"  bar.id = 'ssm-view-banner';",
	"  bar.innerHTML = [",
	"    '<strong>Read-only view</strong>',",
	"    '<span class=\"muted\">same layout as /webui · not the live agent</span>',",
	"    '<span class=\"spacer\"></span>',",
	"    '<a href=\"/ssm\">Session manager</a>',",
	"    '<a href=\"/\">Live session</a>'",
	"  ].join('');",
	"  document.body.insertBefore(bar, document.body.firstChild);",
	"",
	"  var btn = document.createElement('button');",
	"  btn.id = 'webui-scroll-bottom';",
	"  btn.title = 'Scroll to bottom';",
	"  btn.textContent = '\\u25BC';",
	"  document.body.appendChild(btn);",
	"  btn.addEventListener('click', function () {",
	"    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });",
	"  });",
	"  function onScroll() {",
	"    var dist = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;",
	"    if (dist > 120) btn.classList.add('visible');",
	"    else btn.classList.remove('visible');",
	"  }",
	"  window.addEventListener('scroll', onScroll, { passive: true });",
	"  setTimeout(onScroll, 50);",
	"})();",
].join("\n");

export async function assertCatalogPath(sessionPath: string): Promise<string> {
	const catalog = await getCatalog();
	const session = findSession(sessionPath, catalog);
	if (!session) {
		const fresh = await getCatalog(true);
		const again = findSession(sessionPath, fresh);
		if (!again) throw new Error("session path not in catalog");
		return again.path;
	}
	return session.path;
}

export function buildViewSessionData(sessionPath: string) {
	const sm = SessionManager.open(sessionPath);
	return {
		header: sm.getHeader(),
		entries: sm.getEntries(),
		leafId: sm.getLeafId(),
		systemPrompt: undefined,
		tools: undefined,
		renderedTools: undefined,
	};
}

export function renderSessionViewHtml(sessionPath: string, themeName?: string): string {
	const sessionData = buildViewSessionData(sessionPath);
	const assets = loadCoreExportHtmlAssets();
	const sessionDataBase64 = Buffer.from(JSON.stringify(sessionData)).toString("base64");
	const css = renderCoreCss(assets.templateCss, themeName);
	const js = `${assets.templateJs}\n\n${VIEW_BANNER_JS}`;
	const header = sessionData.header as { id?: string } | null | undefined;
	const title = header?.id ? `${header.id}.jsonl` : "session view";

	return assets.templateHtml
		.replace("<title>Session Export</title>", `<title>${title}</title>`)
		.replace("{{CSS}}", css)
		.replace("{{JS}}", js)
		.replace("{{SESSION_DATA}}", sessionDataBase64)
		.replace("{{MARKED_JS}}", assets.markedJs)
		.replace("{{HIGHLIGHT_JS}}", assets.highlightJs);
}
