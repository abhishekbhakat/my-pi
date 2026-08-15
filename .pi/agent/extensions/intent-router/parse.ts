import { instructionRouteKey, isRecord, type Decision } from "./types";

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

export function parseDecision(value: unknown): Decision {
	if (!isRecord(value) || (value.kind !== "question" && value.kind !== "instruction")) {
		throw new Error("classifier kind must be question|instruction");
	}
	if (value.needsCurrentThread === true) {
		return {
			kind: value.kind,
			needsCurrentThread: true,
			includesEnglish: false,
			key: "question",
		};
	}
	if (value.kind === "question") {
		return { kind: "question", includesEnglish: false, key: "question" };
	}
	if (value.lane !== "ops" && value.lane !== "code" && value.lane !== "terminal") {
		throw new Error("instruction lane must be ops|code|terminal");
	}
	if (value.level !== "basic" && value.level !== "adv" && value.level !== "readonly") {
		throw new Error("instruction level must be basic|adv|readonly");
	}
	if (value.level === "readonly" && value.lane !== "terminal") {
		throw new Error("readonly is only valid with lane=terminal");
	}
	return {
		kind: "instruction",
		lane: value.lane,
		level: value.level,
		includesEnglish: value.includesEnglish !== false,
		key: instructionRouteKey(value.lane, value.level),
	};
}
