import { homedir } from "node:os";

export const CYAN = "\x1b[36m";
export const YELLOW = "\x1b[33m";
export const MAGENTA = "\x1b[35m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const DIM = "\x1b[2m";
export const BOLD = "\x1b[1m";
export const RESET = "\x1b[0m";

const LEAD = "  ";
export const GUTTER = `${LEAD}${DIM}${String.fromCharCode(0x250a)}${RESET}`;
export const INDENT = `${GUTTER}   `;
export const ELAPSED_KEY = "compactToolsElapsedMs";
export const HOME = homedir();

export const TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls", "tree"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** File extensions whose inline TUI image preview is suppressed (card only). */
export const NO_TUI_IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"tif",
	"tiff",
	"ico",
	"avif",
	"heic",
	"heif",
	"svg",
]);
