import { readFileSync } from "node:fs";
import { getCoreExportAssetPath } from "../utils/path";
import { generateThemeCss } from "./theme";

export interface ExportHtmlAssets {
	templateHtml: string;
	templateCss: string;
	templateJs: string;
	markedJs: string;
	highlightJs: string;
}

export function loadCoreExportHtmlAssets(): ExportHtmlAssets {
	return {
		templateHtml: readFileSync(getCoreExportAssetPath("template.html"), "utf8"),
		templateCss: readFileSync(getCoreExportAssetPath("template.css"), "utf8"),
		templateJs: readFileSync(getCoreExportAssetPath("template.js"), "utf8"),
		markedJs: readFileSync(getCoreExportAssetPath("vendor", "marked.min.js"), "utf8"),
		highlightJs: readFileSync(getCoreExportAssetPath("vendor", "highlight.min.js"), "utf8"),
	};
}

export function renderCoreCss(templateCss: string, themeName?: string): string {
	return templateCss
		.replace("{{THEME_VARS}}", generateThemeCss(themeName))
		.replace(/\{\{BODY_BG\}\}/g, "var(--exportPageBg)")
		.replace(/\{\{CONTAINER_BG\}\}/g, "var(--exportCardBg)")
		.replace(/\{\{INFO_BG\}\}/g, "var(--exportInfoBg)");
}
