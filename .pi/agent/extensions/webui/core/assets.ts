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
	try {
		return {
			templateHtml: readFileSync(getCoreExportAssetPath("template.html"), "utf8"),
			templateCss: readFileSync(getCoreExportAssetPath("template.css"), "utf8"),
			templateJs: readFileSync(getCoreExportAssetPath("template.js"), "utf8"),
			markedJs: readFileSync(getCoreExportAssetPath("vendor", "marked.min.js"), "utf8"),
			highlightJs: readFileSync(getCoreExportAssetPath("vendor", "highlight.min.js"), "utf8"),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to load pi export-html assets: ${message}`);
	}
}

export function renderCoreCss(templateCss: string, themeName?: string): string {
	return templateCss
		.replace("{{THEME_VARS}}", generateThemeCss(themeName))
		.replace(/\{\{BODY_BG\}\}/g, "var(--exportPageBg)")
		.replace(/\{\{CONTAINER_BG\}\}/g, "var(--exportCardBg)")
		.replace(/\{\{INFO_BG\}\}/g, "var(--exportInfoBg)");
}
