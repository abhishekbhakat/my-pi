import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { patchTemplateJs } from "../core/template-adapter";
import { WEBUI_SHELL_JS } from "../web/shell";
import { MODEL_CONTROLS_JS } from "../web/model-controls";
import { getCoreExportAssetPath } from "../utils/path";
import { generateThemeCss } from "./theme";

export interface ExportHtmlAssets {
	templateHtml: string;
	templateCss: string;
	templateJs: string;
	markedJs: string;
	markedCjkFriendlyJs: string;
	highlightJs: string;
}

let cachedAssets: ExportHtmlAssets | undefined;

export function loadCoreExportHtmlAssets(): ExportHtmlAssets {
	if (cachedAssets) return cachedAssets;
	try {
		cachedAssets = {
			templateHtml: readFileSync(getCoreExportAssetPath("template.html"), "utf8"),
			templateCss: readFileSync(getCoreExportAssetPath("template.css"), "utf8"),
			templateJs: readFileSync(getCoreExportAssetPath("template.js"), "utf8"),
			markedJs: readFileSync(getCoreExportAssetPath("vendor", "marked.min.js"), "utf8"),
			markedCjkFriendlyJs: readFileSync(getCoreExportAssetPath("vendor", "marked-cjk-friendly.min.js"), "utf8"),
			highlightJs: readFileSync(getCoreExportAssetPath("vendor", "highlight.min.js"), "utf8"),
		};
		return cachedAssets;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to load pi export-html assets: ${message}`);
	}
}

interface LiveAsset { body: string; contentType: string }
const liveAssets = new Map<string, LiveAsset>();
const liveBundles = new Map<string, Record<string, string>>();

export function getLiveAsset(path: string): LiveAsset | undefined {
	return liveAssets.get(path);
}

export function getLiveAssetPaths(themeName?: string): Record<string, string> {
	const key = themeName ?? "dark";
	const existing = liveBundles.get(key);
	if (existing) return existing;
	const assets = loadCoreExportHtmlAssets();
	const bodies = {
		marked: assets.markedJs, cjk: assets.markedCjkFriendlyJs, highlight: assets.highlightJs,
		renderer: patchTemplateJs(assets.templateJs), shell: WEBUI_SHELL_JS, controls: MODEL_CONTROLS_JS,
		style: renderCoreCss(assets.templateCss, themeName),
	};
	const paths: Record<string, string> = {};
	for (const [name, body] of Object.entries(bodies)) {
		const css = name === "style";
		const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
		const path = `/__webui/assets/${name}.${hash}.${css ? "css" : "js"}`;
		liveAssets.set(path, { body, contentType: css ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
		paths[name] = path;
	}
	liveBundles.set(key, paths);
	return paths;
}

export function renderCoreCss(templateCss: string, themeName?: string): string {
	return templateCss
		.replace("{{THEME_VARS}}", generateThemeCss(themeName))
		.replace(/\{\{BODY_BG\}\}/g, "var(--exportPageBg)")
		.replace(/\{\{CONTAINER_BG\}\}/g, "var(--exportCardBg)")
		.replace(/\{\{INFO_BG\}\}/g, "var(--exportInfoBg)")
		+ "\n#content > * { max-width: 100%; min-width: 0; }\n";
}
