/**
 * Live-candidate decision, ported from /tmp/pi-talk-proto/decide.py.
 * V1 mailbox note: the send path addresses an explicit mailbox id and never
 * calls this. It survives for diagnostics and a future live fast-path.
 * Rules: drop pidAlive=false; NO_LIVE when none; NO_USER_TURN when no
 * timestamp; max lastUserTurnMs wins; exact tie = AMBIGUOUS (fail loudly).
 */
export interface Candidate {
	id: string;
	sessionFile?: string;
	leafId?: string;
	lastUserTurnMs: number | null;
	pidAlive: boolean;
}

export type DecideResult =
	| { ok: true; winner: Candidate }
	| { ok: false; code: "NO_LIVE" | "NO_USER_TURN" | "AMBIGUOUS"; detail: string };

export function decide(candidates: Candidate[]): DecideResult {
	const live = candidates.filter((c) => c.pidAlive);
	if (live.length === 0) {
		return { ok: false, code: "NO_LIVE", detail: `no live endpoints among ${candidates.length} candidates` };
	}
	const withTurn = live.filter((c): c is Candidate & { lastUserTurnMs: number } =>
		typeof c.lastUserTurnMs === "number",
	);
	if (withTurn.length === 0) {
		return { ok: false, code: "NO_USER_TURN", detail: "no candidate has a user-turn timestamp" };
	}
	const top = Math.max(...withTurn.map((c) => c.lastUserTurnMs));
	const winners = withTurn.filter((c) => c.lastUserTurnMs === top);
	if (winners.length > 1) {
		const ids = winners.map((c) => c.id).sort().join(",");
		return { ok: false, code: "AMBIGUOUS", detail: `tie at ${top} between ${ids}` };
	}
	return { ok: true, winner: winners[0]! };
}
