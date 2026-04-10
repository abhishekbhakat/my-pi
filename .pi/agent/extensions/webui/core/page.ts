import { WEBUI_SHELL_JS } from "../web/shell";
import { loadCoreExportHtmlAssets, renderCoreCss } from "./assets";

export function renderWebUiPage(sessionData: unknown, themeName?: string): string {
	const assets = loadCoreExportHtmlAssets();
	const sessionDataBase64 = Buffer.from(JSON.stringify(sessionData)).toString("base64");
	const css = renderCoreCss(assets.templateCss, themeName);
	const js = `${assets.templateJs}\n\n${WEBUI_SHELL_JS}`;

	const sd = sessionData as { header?: { id?: string }; leafId?: string | null };
	const sessionId = sd?.header?.id ?? sd?.leafId ?? "session";

	return assets.templateHtml
		.replace("<title>Session Export</title>", `<title>${sessionId}.jsonl</title>`)
		.replace("{{CSS}}", css)
		.replace("{{JS}}", js)
		.replace("{{SESSION_DATA}}", sessionDataBase64)
		.replace("{{MARKED_JS}}", assets.markedJs)
		.replace("{{HIGHLIGHT_JS}}", assets.highlightJs);
}
