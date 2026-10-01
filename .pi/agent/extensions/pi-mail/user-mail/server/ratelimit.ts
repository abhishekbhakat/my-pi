/**
 * Rolling per-IP rate limit for the user-mail server (issue #5).
 * v1: 60 messages per minute per source address.
 */

import { RATE_LIMIT_PER_MINUTE } from "../protocol.ts";

export class RateLimiter {
	private readonly hits = new Map<string, number[]>();

	allow(ip: string, now = Date.now()): boolean {
		const windowStart = now - 60_000;
		const past = (this.hits.get(ip) ?? []).filter((t) => t > windowStart);
		if (past.length >= RATE_LIMIT_PER_MINUTE) {
			this.hits.set(ip, past);
			return false;
		}
		past.push(now);
		this.hits.set(ip, past);
		return true;
	}
}
