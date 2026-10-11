/** Detect haiku-style "I can't read/trace code this turn" preambles. */
export function isRefusalPreamble(text: string): boolean {
	const head = text.trim().replace(/^(?:#+\s*|note:\s*)/i, "").slice(0, 400);
	if (!head) return false;
	if (
		/\bi (?:can'?t|cannot|am unable to|don'?t have (?:access|the ability) to)\b[^.\n]{0,100}\b(?:read|see|access|trace|open|inspect|view|run)\b/i.test(
			head,
		)
	) {
		return true;
	}
	if (/\btools? (?:are|is) (?:disabled|unavailable|not available)\b/i.test(head)) return true;
	if (/\binferred from (?:the )?(?:file ?names|directory tree)\b/i.test(head)) return true;
	if (/\bi could(?:n't| not) (?:re-?)?(?:run|trace|read|open)\b/i.test(head)) return true;
	return false;
}
