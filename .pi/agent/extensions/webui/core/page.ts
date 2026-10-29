import { getLiveAssetPaths, loadCoreExportHtmlAssets } from "./assets";

/** Static libraries are cached separately; only initial session data is inline. */
export function renderWebUiPage(sessionData: unknown, themeName?: string): string {
	const assets = loadCoreExportHtmlAssets();
	const paths = getLiveAssetPaths(themeName);
	const sd = sessionData as { header?: { id?: string } };
	const sessionId = sd.header?.id ?? "session";
	const url = (name: string) => `${paths[name]}?id=${encodeURIComponent(sessionId)}&pid=${process.pid}`;
	const script = (name: string) => `<script src="${url(name)}"></script>`;
	let html = assets.templateHtml;
	const replacements: [string, string][] = [
		["<title>Session Export</title>", "<title>Pi Web UI</title>"],
		["<style>\n{{CSS}}\n  </style>", `<link rel="stylesheet" href="${url("style")}">`],
		["<script>{{MARKED_JS}}</script>", script("marked")],
		["<script>{{MARKED_CJK_FRIENDLY_JS}}</script>", script("cjk")],
		["<script>{{HIGHLIGHT_JS}}</script>", script("highlight")],
		["<script>\n{{JS}}\n  </script>", ["renderer", "shell", "controls"].map(script).join("\n")],
		["{{SESSION_DATA}}", Buffer.from(JSON.stringify(sessionData)).toString("base64")],
	];
	for (const [anchor, replacement] of replacements) {
		if (html.split(anchor).length !== 2) throw new Error(`Pi export HTML template incompatible (${anchor}).`);
		html = html.replace(anchor, () => replacement);
	}
	return html;
}
