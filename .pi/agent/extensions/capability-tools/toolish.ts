/** True when the whole answer is fake tool markup, not a prose mention of the tag. */
export function isHallucinatedToolAnswer(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	// DeepSeek can leak its tool protocol as text instead of native toolCall parts.
	const dsmlTag = String.raw`[｜|]{1,2}\s*DSML\s*[｜|]{1,2}\s*`;
	if (new RegExp(`^<${dsmlTag}(?:(?:function_)?calls|invoke)\\b`, "i").test(trimmed)) return true;
	const withoutDsml = trimmed
		.replace(new RegExp(`<${dsmlTag}(?:function_)?calls\\b[^>]*>[\\s\\S]*?<\\/${dsmlTag}(?:function_)?calls\\s*>`, "gi"), "")
		.replace(new RegExp(`<${dsmlTag}invoke\\b[^>]*>[\\s\\S]*?<\\/${dsmlTag}invoke\\s*>`, "gi"), "")
		.trim();
	if (withoutDsml !== trimmed && withoutDsml.length < 40) return true;
	if (/^(?:\s*<pi_tool_call>[\s\S]*?<\/pi_tool_call>\s*)+$/.test(trimmed)) return true;
	if (/^(?:\s*<function_calls>[\s\S]*?<\/function_calls>\s*)+$/i.test(trimmed)) return true;
	if (/^(?:\s*<invoke\b[^>]*>[\s\S]*?<\/invoke>\s*)+$/i.test(trimmed)) return true;
	const withoutPi = trimmed.replace(/<pi_tool_call>[\s\S]*?<\/pi_tool_call>/g, "").trim();
	if (trimmed.includes("<pi_tool_call>") && withoutPi.length < 40) return true;
	const withoutFn = trimmed
		.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
		.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "")
		.trim();
	if (/(?:<function_calls\b|<invoke\b)/i.test(trimmed) && withoutFn.length < 40) return true;
	return false;
}
