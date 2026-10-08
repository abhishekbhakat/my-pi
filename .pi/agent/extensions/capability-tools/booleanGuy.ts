import { Type } from "@sinclair/typebox";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askDeciders, deciderModelLabel } from "../shared/deciders/index.ts";
import type { WireQuestions } from "../shared/deciders/types.ts";
import { DEFAULT_IGNORE_PATHS } from "./definitions";
import { buildCapabilityContext } from "./context";
import type { CapabilityContextBundle, CapabilityDef, CapabilityToolInput } from "./types";

const MAX_QUESTIONS = 16;
const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RESERVED = new Set(["task", "conversation", "git_status", "git_diff", "tree", "files", "timeline"]);
const CAPS = {
	task: 8000,
	conversation: 20000,
	git_status: 8000,
	git_diff: 40000,
	tree: 8000,
	filesTotal: 80000,
	fileEach: 12000,
	timeline: 8000,
	stateTotal: 100000,
};

export const BOOLEAN_GUY_DEF: CapabilityDef = {
	name: "boolean-guy",
	toolName: "boolean_guy",
	label: "Boolean Guy",
	description: "Ask the configured decision model (Jev, Clef, GLiDE, or pplx-decider) structured Noul/Choice/Score questions over capability context. Returns typed judgments and probabilities only, not explanations. The calling agent supplies questions and decides thresholds.",
	model: deciderModelLabel("booleanGuy"),
	systemPrompt: "",
	file: "booleanGuy.ts",
	promptSnippet: "Get typed yes/no, choice, and score judgments from the configured decision model (no explanations).",
	promptGuidelines: [
		"Supply questions yourself; Jev returns raw noul/choice/score only, no explanations",
	],
	includeConversation: true,
	includeTree: false,
	includeGitStatus: true,
	includeGitDiff: false,
	includeChangedFiles: true,
	includeTimeline: false,
	timelineModel: "claude-code-cli/haiku",
	maxContextChars: 200000,
	maxConversationChars: 20000,
	maxTreeChars: 8000,
	maxTimelineChars: 8000,
	maxFiles: 24,
	maxCodeFileChars: 12000,
	maxStructuredFileChars: 12000,
	ignorePaths: DEFAULT_IGNORE_PATHS,
};

const noulQuestion = Type.Object({
	id: Type.String(),
	kind: Type.Literal("noul"),
	instructions: Type.String(),
	criteria: Type.Optional(Type.Object({
		true: Type.Optional(Type.String()),
		false: Type.Optional(Type.String()),
	})),
});

const choiceQuestion = Type.Object({
	id: Type.String(),
	kind: Type.Literal("choice"),
	instructions: Type.String(),
	criteria: Type.Record(Type.String(), Type.String()),
});

const scoreQuestion = Type.Object({
	id: Type.String(),
	kind: Type.Literal("score"),
	instructions: Type.String(),
	criteria: Type.Array(Type.String(), { minItems: 2, maxItems: 10 }),
});

export const BOOLEAN_GUY_SCHEMA = Type.Object({
	task: Type.String({ description: "What the judgments are about; copied to state.task" }),
	questions: Type.Array(Type.Union([noulQuestion, choiceQuestion, scoreQuestion]), {
		description: "Agent-authored TypeSafe questions (Noul, Choice, Score). Cap 16.",
		minItems: 1,
		maxItems: MAX_QUESTIONS,
	}),
	paths: Type.Optional(Type.Array(Type.String())),
	extraState: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	includeConversation: Type.Optional(Type.Boolean()),
	includeTree: Type.Optional(Type.Boolean()),
	includeDiff: Type.Optional(Type.Boolean()),
});

export type BooleanGuyInput = {
	task: string;
	questions: Array<{
		id: string;
		kind: "noul" | "choice" | "score";
		instructions: string;
		criteria?: unknown;
	}>;
	paths?: string[];
	extraState?: Record<string, unknown>;
	includeConversation?: boolean;
	includeTree?: boolean;
	includeDiff?: boolean;
};

function clip(value: string, max: number): string {
	return value.length <= max ? value : value.slice(0, max);
}

function validateQuestions(questions: BooleanGuyInput["questions"]): string | null {
	if (!Array.isArray(questions) || questions.length < 1 || questions.length > MAX_QUESTIONS) {
		return `questions must be 1 to ${MAX_QUESTIONS} items.`;
	}
	const seen = new Set<string>();
	for (const question of questions) {
		if (!ID_RE.test(question.id) || seen.has(question.id)) return `Bad or duplicate id: ${question.id}`;
		seen.add(question.id);
		if (!question.instructions?.trim()) return `Empty instructions for ${question.id}`;
		const criteria = question.criteria;
		if (question.kind === "choice" && (!criteria || typeof criteria !== "object" || Array.isArray(criteria) || Object.keys(criteria).length < 2)) {
			return `${question.id}: choice criteria must be an object map with 2+ options.`;
		}
		if (question.kind === "score" && (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10)) {
			return `${question.id}: score criteria must be 2 to 10 level strings.`;
		}
	}
	return null;
}

function toSystemOneQuestions(questions: BooleanGuyInput["questions"]): Record<string, unknown> {
	const map: Record<string, unknown> = {};
	for (const question of questions) {
		if (question.kind === "noul") {
			const body: Record<string, unknown> = { type: "noul", instructions: question.instructions };
			if (question.criteria && typeof question.criteria === "object" && !Array.isArray(question.criteria)) {
				body.criteria = question.criteria;
			}
			map[question.id] = body;
		} else if (question.kind === "choice") {
			map[question.id] = { type: "choice", instructions: question.instructions, criteria: question.criteria };
		} else {
			map[question.id] = { type: "score", instructions: question.instructions, criteria: question.criteria };
		}
	}
	return map;
}

function section(bundle: CapabilityContextBundle, title: string): string {
	return bundle.sections.find((item) => item.title === title)?.content ?? "";
}

function buildState(task: string, bundle: CapabilityContextBundle, extraState?: Record<string, unknown>): Record<string, unknown> {
	// TypeSafe rejects oversized state (400 max_tokens_exceeded around ~50k
	// tokens). Fill named fields in priority order under one shared char budget.
	const state: Record<string, unknown> = {
		task: clip(task, CAPS.task),
	};
	let total = String(state.task).length;
	const addField = (key: string, content: string | undefined, cap: number) => {
		if (!content) return;
		const room = Math.max(0, CAPS.stateTotal - total);
		if (room < 200) return;
		const value = clip(content, Math.min(cap, room));
		state[key] = value;
		total += key.length + value.length;
	};
	addField("git_status", section(bundle, "Git Status"), CAPS.git_status);
	addField("conversation", section(bundle, "Recent Conversation"), CAPS.conversation);
	addField("git_diff", section(bundle, "Git Diff"), CAPS.git_diff);
	addField("tree", section(bundle, "Workspace Tree"), CAPS.tree);
	addField("timeline", section(bundle, "Action Timeline"), CAPS.timeline);
	{
		const room = Math.max(0, CAPS.stateTotal - total);
		const budget = Math.min(CAPS.filesTotal, room);
		const picked: Record<string, string> = {};
		let size = 0;
		for (const [pathName, content] of Object.entries(bundle.fileContents ?? {})) {
			const value = clip(content, Math.min(CAPS.fileEach, Math.max(0, budget - size)));
			if (!value) break;
			picked[pathName] = value;
			size += pathName.length + value.length;
			if (size >= budget) break;
		}
		if (Object.keys(picked).length > 0) {
			state.files = picked;
			total += size;
		}
	}
	if (extraState) {
		for (const [key, value] of Object.entries(extraState)) {
			if (!RESERVED.has(key)) state[key] = value;
		}
	}
	return state;
}

function fail(code: string, message: string) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ ok: false, code, message }) }],
		details: { status: "error", capability: "boolean_guy", code },
	};
}

export async function executeBooleanGuy(
	pi: ExtensionAPI,
	input: BooleanGuyInput,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback | undefined,
	ctx: ExtensionContext,
) {
	const invalid = validateQuestions(input.questions ?? []);
	if (invalid) return fail("unprocessable", invalid);

	onUpdate?.({
		content: [{ type: "text", text: "Assembling named state for boolean_guy..." }],
		details: { status: "assembling", capability: "boolean_guy" },
	});

	const contextInput: CapabilityToolInput = {
		task: input.task,
		paths: input.paths,
		includeConversation: input.includeConversation,
		includeTree: input.includeTree,
		includeDiff: input.includeDiff,
		includeTimeline: false,
	};
	const bundle = await buildCapabilityContext(pi, ctx, BOOLEAN_GUY_DEF, contextInput, signal);
	const state = buildState(input.task, bundle, input.extraState);
	const questions = toSystemOneQuestions(input.questions);

	onUpdate?.({
		content: [{ type: "text", text: `Calling ${deciderModelLabel("booleanGuy")} (${input.questions.length} questions)...` }],
		details: { status: "running", capability: "boolean_guy" },
	});

	const result = await askDeciders("booleanGuy", state, questions as unknown as WireQuestions, { signal });
	if (!result.ok) return fail(result.code, result.message);

	const payload = {
		ok: true,
		model: result.model,
		usage: result.usage ?? null,
		answers: result.answers,
	};
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
		details: { status: "done", capability: "boolean_guy", model: payload.model },
	};
}
