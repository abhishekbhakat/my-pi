import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPiPackageRoot } from "../utils/path";

interface ThemeJson {
	vars?: Record<string, string | number>;
	colors: Record<string, string | number>;
	export?: {
		pageBg?: string | number;
		cardBg?: string | number;
		infoBg?: string | number;
	};
}

function getThemeFile(themeName?: string): string {
	const name = themeName ?? "dark";

	// 1. Project-local theme
	const projectTheme = resolve(process.cwd(), ".pi", "agent", "themes", `${name}.json`);
	if (existsSync(projectTheme)) return projectTheme;

	// 2. User-global theme (~/.pi/agent/themes/)
	const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
	const globalTheme = resolve(homeDir, ".pi", "agent", "themes", `${name}.json`);
	if (existsSync(globalTheme)) return globalTheme;

	// 3. Built-in theme shipped with pi package
	return resolve(getPiPackageRoot(), "dist", "modes", "interactive", "theme", `${name}.json`);
}

function loadThemeJson(themeName?: string): ThemeJson {
	const filePath = getThemeFile(themeName);
	return JSON.parse(readFileSync(filePath, "utf8")) as ThemeJson;
}

function resolveVarRefs(value: string | number, vars: Record<string, string | number>, visited = new Set<string>()): string | number {
	if (typeof value === "number" || value === "" || value.startsWith("#") || value.startsWith("rgb")) {
		return value;
	}
	if (visited.has(value)) {
		throw new Error(`Circular variable reference detected: ${value}`);
	}
	if (!(value in vars)) {
		return value;
	}
	visited.add(value);
	return resolveVarRefs(vars[value], vars, visited);
}

function resolveThemeColors(colors: Record<string, string | number>, vars: Record<string, string | number> = {}): Record<string, string | number> {
	const resolved: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(colors)) {
		resolved[key] = resolveVarRefs(value, vars);
	}
	return resolved;
}

function ansi256ToHex(index: number): string {
	const basicColors = [
		"#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
		"#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
	];
	if (index < 16) return basicColors[index];
	if (index < 232) {
		const cubeIndex = index - 16;
		const r = Math.floor(cubeIndex / 36);
		const g = Math.floor((cubeIndex % 36) / 6);
		const b = cubeIndex % 6;
		const toHex = (n: number) => (n === 0 ? 0 : 55 + n * 40).toString(16).padStart(2, "0");
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}
	const gray = 8 + (index - 232) * 10;
	const grayHex = gray.toString(16).padStart(2, "0");
	return `#${grayHex}${grayHex}${grayHex}`;
}

function getResolvedThemeColors(themeName?: string): Record<string, string> {
	const name = themeName ?? "dark";
	const isLight = name === "light";
	const themeJson = loadThemeJson(name);
	const resolved = resolveThemeColors(themeJson.colors, themeJson.vars ?? {});
	const defaultText = isLight ? "#000000" : "#e5e5e7";
	const cssColors: Record<string, string> = {};
	for (const [key, value] of Object.entries(resolved)) {
		if (typeof value === "number") cssColors[key] = ansi256ToHex(value);
		else if (value === "") cssColors[key] = defaultText;
		else cssColors[key] = value;
	}
	return cssColors;
}

function getThemeExportColors(themeName?: string): { pageBg?: string; cardBg?: string; infoBg?: string } {
	const themeJson = loadThemeJson(themeName);
	const exportSection = themeJson.export;
	if (!exportSection) return {};
	const vars = themeJson.vars ?? {};
	const resolveColor = (value?: string | number): string | undefined => {
		if (value === undefined) return undefined;
		const resolved = resolveVarRefs(value, vars);
		if (typeof resolved === "number") return ansi256ToHex(resolved);
		if (resolved === "") return undefined;
		return resolved;
	};
	return {
		pageBg: resolveColor(exportSection.pageBg),
		cardBg: resolveColor(exportSection.cardBg),
		infoBg: resolveColor(exportSection.infoBg),
	};
}

function parseColor(color: string): { r: number; g: number; b: number } | undefined {
	const hexMatch = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
	if (hexMatch) {
		return {
			r: Number.parseInt(hexMatch[1], 16),
			g: Number.parseInt(hexMatch[2], 16),
			b: Number.parseInt(hexMatch[3], 16),
		};
	}
	const rgbMatch = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
	if (rgbMatch) {
		return {
			r: Number.parseInt(rgbMatch[1], 10),
			g: Number.parseInt(rgbMatch[2], 10),
			b: Number.parseInt(rgbMatch[3], 10),
		};
	}
	return undefined;
}

function getLuminance(r: number, g: number, b: number): number {
	const toLinear = (value: number) => {
		const scaled = value / 255;
		return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function adjustBrightness(color: string, factor: number): string {
	const parsed = parseColor(color);
	if (!parsed) return color;
	const adjust = (value: number) => Math.min(255, Math.max(0, Math.round(value * factor)));
	return `rgb(${adjust(parsed.r)}, ${adjust(parsed.g)}, ${adjust(parsed.b)})`;
}

function deriveExportColors(baseColor: string): { pageBg: string; cardBg: string; infoBg: string } {
	const parsed = parseColor(baseColor);
	if (!parsed) {
		return {
			pageBg: "rgb(24, 24, 30)",
			cardBg: "rgb(30, 30, 36)",
			infoBg: "rgb(60, 55, 40)",
		};
	}
	const isLight = getLuminance(parsed.r, parsed.g, parsed.b) > 0.5;
	if (isLight) {
		return {
			pageBg: adjustBrightness(baseColor, 0.96),
			cardBg: baseColor,
			infoBg: `rgb(${Math.min(255, parsed.r + 10)}, ${Math.min(255, parsed.g + 5)}, ${Math.max(0, parsed.b - 20)})`,
		};
	}
	return {
		pageBg: adjustBrightness(baseColor, 0.7),
		cardBg: adjustBrightness(baseColor, 0.85),
		infoBg: `rgb(${Math.min(255, parsed.r + 20)}, ${Math.min(255, parsed.g + 15)}, ${parsed.b})`,
	};
}

export function generateThemeCss(themeName?: string): string {
	const colors = getResolvedThemeColors(themeName);
	const themeExport = getThemeExportColors(themeName);
	const userMessageBg = colors.userMessageBg || "#343541";
	const derived = deriveExportColors(userMessageBg);
	const lines: string[] = [];
	for (const [key, value] of Object.entries(colors)) {
		lines.push(`--${key}: ${value};`);
	}
	lines.push(`--exportPageBg: ${themeExport.pageBg ?? derived.pageBg};`);
	lines.push(`--exportCardBg: ${themeExport.cardBg ?? derived.cardBg};`);
	lines.push(`--exportInfoBg: ${themeExport.infoBg ?? derived.infoBg};`);
	return lines.join("\n      ");
}
