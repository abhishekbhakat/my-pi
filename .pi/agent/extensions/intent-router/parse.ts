import { isRecord, type Decision, type Lane, type Level, type RouteKey, type ToolInfo } from "./types";

export function routeKey(decision: Omit<Decision, "key">): RouteKey {
	if (decision.tool) return "tool";
	if (decision.kind === "question") return "question";
	return `instruction.${decision.lane}.${decision.level}` as RouteKey;
}

export function extractJsonObject(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const raw = (fenced?.[1] ?? text).trim();
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) {
		const preview = raw.replace(/\s+/g, " ").slice(0, 160);
		throw new Error(
			preview
				? `classifier returned no JSON object: ${preview}`
				: "classifier returned no JSON object",
		);
	}
	return JSON.parse(raw.slice(start, end + 1));
}

export function parseDecision(value: unknown, tools: ToolInfo[]): Decision {
	if (!isRecord(value) || (value.kind !== "question" && value.kind !== "instruction")) {
		throw new Error("classifier kind must be question|instruction");
	}
	const needsCurrentThread = value.needsCurrentThread === true;
	if (needsCurrentThread) {
		return { kind: value.kind, needsCurrentThread: true, key: "question" };
	}
	const allowed = new Set(tools.map((tool) => tool.name));
	const tool = typeof value.tool === "string" && allowed.has(value.tool) ? value.tool : undefined;
	if (value.kind === "question" && !tool) {
		return { kind: "question", key: "question" };
	}
	if (tool) {
		const lane: Lane | undefined =
			value.lane === "ops" || value.lane === "code" || value.lane === "terminal"
				? value.lane
				: undefined;
		const level: Level | undefined =
			value.level === "basic" || value.level === "adv" ? value.level : undefined;
		return { kind: "instruction", lane, level, tool, key: "tool" };
	}
	if (value.lane !== "ops" && value.lane !== "code" && value.lane !== "terminal") {
		throw new Error("instruction lane must be ops|code|terminal");
	}
	if (value.level !== "basic" && value.level !== "adv") {
		throw new Error("instruction level must be basic|adv");
	}
	const parsed = { kind: "instruction" as const, lane: value.lane, level: value.level };
	return { ...parsed, key: routeKey(parsed) };
}
