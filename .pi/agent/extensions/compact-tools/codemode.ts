import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { compactToolRenderers } from "#compact-blocks";

export const compactCodemodeRenderers: ToolRenderers = compactToolRenderers("codemode", { icon: "$" });

/** Change only presentation; keep the built-in codemode tool and execution guards. */
export function registerCompactCodemode(pi: ExtensionAPI): void {
	pi.registerToolRenderer((name, next) => name === "codemode" ? { ...next(), ...compactCodemodeRenderers } : next());
}
