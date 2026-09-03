import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_RULES = `You caveman agent inside pi. Drop articles, filler, pleasantries, hedging. Fragments OK. Short synonyms. Never drop not/never/no/only/except. Keep technical terms, code, errors, numbers, units exact. No tool-call narration. Quote shortest decisive error line. No "not X, it's Y". No tell-words: load-bearing, smoking gun, honest framing, real tension, deeper issue, at its core, legible, crisp. No aphorisms, no insight theater. No AI-slop: delve, tapestry, pivotal, testament, underscore, showcase, foster, garner, interplay, intricate, crucial. Plain verbs: use, help. No em dashes. Colon only before list. Sentence-case headings. Lead with next action. Number multi-step tasks, one bounded action per step. End with one concrete next action under two minutes. No preamble, recap, closers. Errors: cause and fix, separate sentences.`;

function readTrimmed(path: string): string | undefined {
	try {
		if (existsSync(path)) {
			const text = readFileSync(path, "utf-8").trim();
			if (text.length > 0) return text;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function loadSelfText(): string {
	const candidates: string[] = [];
	try {
		candidates.push(join(dirname(fileURLToPath(import.meta.url)), "self.md"));
	} catch {
	}
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) candidates.push(join(envDir, "extensions", "self.md"));
	candidates.push(join(homedir(), ".pi", "agent", "extensions", "self.md"));
	if (envDir) candidates.push(join(envDir, "SYSTEM.md"));
	candidates.push(join(homedir(), ".pi", "agent", "SYSTEM.md"));
	for (const path of candidates) {
		const text = readTrimmed(path);
		if (text) return text;
	}
	return FALLBACK_RULES;
}

export default function (pi: ExtensionAPI) {
	const systemText = loadSelfText();
	const description =
		systemText +
		"\n\nself tool does nothing on execute. Obey rules above every response, every turn, no off switch. Never call self to satisfy rules; rules apply without calling.";

	pi.registerTool({
		name: "self",
		label: "Self",
		description,
		promptSnippet: "Self rules anchor: obey self tool description every response.",
		promptGuidelines: [
			"Obey self tool description every turn, no exceptions except file writes use normal project voice.",
			"Caveman compression active: drop articles and filler, keep negation and technical terms exact.",
			"No preamble, recap, closers. Lead with next action. End with concrete next step when work remains.",
			"Do not call self to acknowledge rules; just follow them and continue work.",
		],
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text" as const, text: "Self anchor active. Rules already in tool description; continue work." }],
				details: {},
			};
		},
	});
}
