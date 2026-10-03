import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SCRIPTS_DIR = path.resolve(MODULE_DIR, "..");
export const SCRIPT_DIR = SCRIPTS_DIR;
export const REPO_ROOT = path.resolve(SCRIPTS_DIR, "..");
export const HOME_AGENT = path.join(os.homedir(), ".pi", "agent");
export const REPO_AGENT = path.join(REPO_ROOT, ".pi", "agent");
export const SKIP_DIRS = new Set(["node_modules", ".git"]);

export const TEXT_EXT = new Set([
  ".ts", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".txt",
  ".css", ".html", ".htm", ".svg", ".xml", ".sh", ".bash", ".zsh",
  ".ps1", ".bat", ".cmd", ".py", ".toml", ".ini", ".cfg", ".conf",
]);
export const TEXT_NAME = new Set([
  "LICENSE", "README", "Makefile", ".gitignore", ".gitattributes", ".npmrc", ".editorconfig",
]);

export const INSTALL_ROOT = ["settings.json", "models.json", "SYSTEM.md", "deciders.json"];
export const SYNC_ROOT = [
  "settings.json", "models.json", "models-store.json",
  "SYSTEM.md", "deciders.json",
];
