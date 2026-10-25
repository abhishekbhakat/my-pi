/**
 * Plan tool - tool-enforced checklist state for the plan skill.
 *
 * Source of truth: <cwd>/.agents/PLAN-<slug>.json (machine state).
 * Human view:     <cwd>/.agents/PLAN-<slug>.md (rendered on every mutation).
 *
 * Invariants this tool enforces (so the skill needs no coach gates per item):
 * 1. No item goes done without a check declared at create time that ran
 *    AFTER the item's files last changed and exited 0. The tool runs cmd
 *    checks itself; the agent cannot paste output or swap the check.
 * 2. One active item at a time. claim(n) fails until every depends_on is done.
 * 3. Evidence goes stale: a touched file under item.files clears it.
 * 4. complete(n) re-runs finished items' checks (regression sweep).
 * 5. amends are append-only; the second structural amend, and every drop,
 *    returns ESCALATE so the agent calls reasoning_coach.
 * 6. Judgment items (no cmd check) fail closed: complete needs a recorded
 *    verdict + source (e.g. boolean_guy Noul). No verdict, no done.
 *
 * ESCALATE lines in tool output are the skill's event-driven triggers.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = ".agents";
const PREFIX = "PLAN-";
const CHECK_TIMEOUT_MS = 120_000;
const OUTPUT_EXCERPT = 1500;

interface CmdEvidence {
	kind: "cmd";
	cmd: string;
	exit: number;
	passed: boolean;
	output: string;
	at: number;
	mtimes: Record<string, number>;
}

interface JudgmentEvidence {
	kind: "judgment";
	verdict: "pass" | "fail";
	source: string;
	at: number;
}

type Evidence = CmdEvidence | JudgmentEvidence;

interface PlanItem {
	id: number;
	action: string;
	files: string[];
	check?: string;
	judgment?: string;
	dependsOn: number[];
	assumptions: string[];
	state: "pending" | "active" | "done" | "dropped";
	evidence?: Evidence;
	failedRuns: number;
	claimedAt?: number;
	claimScope?: string[];
}

interface Amend {
	at: number;
	op: string;
	itemId?: number;
	reason: string;
	detail: string;
}

interface PlanState {
	v: 1;
	goal: string;
	slug: string;
	created: number;
	status: "active" | "done" | "abandoned";
	current: number | null;
	riskiestItem: number | null;
	risks: string[];
	items: PlanItem[];
	amends: Amend[];
	structuralAmends: number;
}

interface ToolText {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

function text(content: string, details?: Record<string, unknown>): ToolText {
	return { content: [{ type: "text", text: content }], details: details ?? {} };
}

function plansDir(cwd: string): string {
	return join(cwd, DIR);
}

function statePath(cwd: string, slug: string): string {
	return join(plansDir(cwd), `${PREFIX}${slug}.json`);
}

function viewPath(cwd: string, slug: string): string {
	return join(plansDir(cwd), `${PREFIX}${slug}.md`);
}

function slugify(goal: string): string {
	const words = goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean);
	return words.slice(0, 4).join("-").slice(0, 48) || "plan";
}

function loadState(file: string): PlanState {
	return JSON.parse(readFileSync(file, "utf8")) as PlanState;
}

function listPlanFiles(cwd: string): string[] {
	try {
		return readdirSync(plansDir(cwd))
			.filter((f) => f.startsWith(PREFIX) && f.endsWith(".json"))
			.map((f) => join(plansDir(cwd), f))
			.sort();
	} catch {
		return [];
	}
}

function activePlan(cwd: string): PlanState | null {
	for (const file of listPlanFiles(cwd)) {
		try {
			const state = loadState(file);
			if (state.status === "active") return state;
		} catch {}
	}
	return null;
}

/** Most recent plan regardless of status, for `status` after a plan settles. */
function latestPlan(cwd: string): PlanState | null {
	let latest: PlanState | null = null;
	for (const file of listPlanFiles(cwd)) {
		try {
			const state = loadState(file);
			if (!latest || state.created > latest.created) latest = state;
		} catch {}
	}
	return latest;
}

function pruneFinished(cwd: string): void {
	for (const file of listPlanFiles(cwd)) {
		try {
			const state = loadState(file);
			if (state.status !== "active") {
				rmSync(file, { force: true });
				rmSync(viewPath(cwd, state.slug), { force: true });
			}
		} catch {}
	}
}

function renderView(state: PlanState): string {
	const lines: string[] = [
		"---",
		`goal: ${state.goal}`,
		`created: ${new Date(state.created).toISOString().slice(0, 10)}`,
		`status: ${state.status}`,
		`current: ${state.current ?? "-"}`,
		"---",
		"",
		"## Plan",
		...state.items.map((it) => `${it.id}. ${it.action}`),
		"",
		"## Checklist",
		...state.items.map((it) => {
			const mark = it.state === "done" ? "x" : it.state === "dropped" ? "~" : " ";
			const check = it.check ? ` [check: \`${it.check}\`]` : it.judgment ? " [judgment]" : "";
			return `- [${mark}] ${it.id}. ${it.action}${check}`;
		}),
		"",
		"## Amends",
		...(state.amends.length
			? state.amends.map((a) => `- ${a.op}${a.itemId ? ` item ${a.itemId}` : ""}: ${a.reason} -> ${a.detail}`)
			: ["- none"]),
	];
	return lines.join("\n") + "\n";
}

function saveState(cwd: string, state: PlanState): void {
	mkdirSync(plansDir(cwd), { recursive: true });
	writeFileSync(statePath(cwd, state.slug), JSON.stringify(state, null, 2) + "\n");
	writeFileSync(viewPath(cwd, state.slug), renderView(state));
}

function mtimesOf(files: string[], cwd: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const f of files) {
		try {
			out[f] = statSync(join(cwd, f)).mtimeMs;
		} catch {
			out[f] = 0;
		}
	}
	return out;
}

function evidenceStale(cwd: string, item: PlanItem): string[] {
	if (!item.evidence || item.evidence.kind !== "cmd") return [];
	const changed: string[] = [];
	const now = mtimesOf(item.files, cwd);
	for (const [file, at] of Object.entries(item.evidence.mtimes)) {
		if (now[file] !== at) changed.push(file);
	}
	return changed;
}

function runCmd(cmd: string, cwd: string, signal?: AbortSignal): Promise<{ exit: number; output: string }> {
	return new Promise((resolve) => {
		execFile("sh", ["-c", cmd], { cwd, timeout: CHECK_TIMEOUT_MS, maxBuffer: 1024 * 1024, signal }, (err, stdout, stderr) => {
			const exit = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : err ? 1 : 0;
			const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim().slice(-OUTPUT_EXCERPT);
			resolve({ exit, output });
		});
	});
}

/**
 * Dirty paths for scope-drift detection. Uses `git status --porcelain -z
 * --untracked-files=all`: NUL-separated entries keep leading status spaces and
 * never collapse new directories to `dir/`. R/C entries put the rename source
 * in the following NUL field, which is skipped so only the current path counts.
 * No trim and no excerpt slice here: both mangle paths.
 */
function gitScope(cwd: string): Promise<string[] | null> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["status", "--porcelain", "-z", "--untracked-files=all"],
			{ cwd, maxBuffer: 4 * 1024 * 1024, signal: undefined },
			(err, stdout) => {
				if (err) return resolve(null);
				const fields = String(stdout).split("\0");
				const paths: string[] = [];
				for (let i = 0; i < fields.length; i++) {
					const field = fields[i];
					if (field.length < 4) continue; // empty or malformed entry
					paths.push(field.slice(3));
					const code = field.slice(0, 2);
					if (code.includes("R") || code.includes("C")) i++; // skip rename source field
				}
				resolve(paths);
			},
		);
	});
}

function statusLine(state: PlanState): string {
	const settled = state.items.filter((i) => i.state === "done" || i.state === "dropped").length;
	const total = state.items.length;
	const current = state.items.find((i) => i.state === "active");
	const next = state.items.find((i) => i.state === "pending");
	if (state.status === "abandoned") return "Plan abandoned.";
	if (state.status === "done" || settled === total) {
		return `All ${settled}/${total} items settled. Run the completion packet.`;
	}
	return `Item ${settled + 1}/${total} current: ${current ? `${current.id}. ${current.action}` : "none"}. Next: ${next ? `${next.id}. ${next.action}` : "-"}.`;
}

/** Mark the plan done once no pending or active items remain (done or dropped). */
function settleIfDone(state: PlanState): boolean {
	if (state.items.some((i) => i.state === "pending" || i.state === "active")) return false;
	state.status = "done";
	state.current = null;
	return true;
}

export default function planExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "plan",
		label: "Plan",
		description:
			"Tool-enforced checklist state for multi-step plans. create stores goal + items with a declared check per item; " +
			"claim starts one item, check runs its declared shell check inside the harness, complete marks done only on fresh " +
			"passing evidence (judgment items need a recorded verdict + source). complete re-runs finished checks and flags " +
			"scope drift. amend is append-only; the second structural amend and every drop return ESCALATE. status renders " +
			"the state line. State lives in .agents/PLAN-<slug>.json; the .md view is generated.",
		promptSnippet: "Multi-step work: plan create once, then claim -> do -> check -> complete per item. ESCALATE means call reasoning_coach.",
		promptGuidelines: [
			"One active item at a time; claim fails until depends_on items are done.",
			"Checks are declared at create time and run by the tool. Do not ask to mark items done by assertion.",
			"Tool output starting with ESCALATE is a trigger to call reasoning_coach (Packet C) before continuing.",
			"When every item is done, run the completion packet (reasoning_coach) before reporting done.",
		],
		parameters: Type.Object({
			action: StringEnum(["create", "list", "status", "claim", "check", "complete", "amend", "abandon"] as const, {
				description: "create/list/status manage plans; claim/check/complete drive one item; amend is logged; abandon stops",
			}),
			goal: Type.Optional(Type.String({ description: "Goal verbatim (create only)" })),
			items: Type.Optional(
				Type.Array(
					Type.Object({
						action: Type.String({ description: "One bounded, verifiable action" }),
						files: Type.Optional(Type.Array(Type.String(), { description: "Files this item may touch (scope drift detection)" })),
						check: Type.Optional(Type.String({ description: "Shell command; exit 0 = item verified. Prefer the narrowest check." })),
						judgment: Type.Optional(Type.String({ description: "Acceptance text for items with no runnable check (mutually exclusive with check)" })),
						dependsOn: Type.Optional(Type.Array(Type.Integer(), { description: "Item ids that must be done first" })),
						assumptions: Type.Optional(Type.Array(Type.String(), { description: "Assumptions whose failure should escalate" })),
					}),
				),
				{ description: "Checklist items (create only). Fewest that work, cap 5 per group." },
			),
			riskiestItem: Type.Optional(Type.Integer({ description: "Item id after which a wrong approach gets expensive (create only)" })),
			risks: Type.Optional(Type.Array(Type.String(), { description: "Top risks (create only)" })),
			item: Type.Optional(Type.Integer({ description: "Item id (claim, check, complete, amend)" })),
			text: Type.Optional(Type.String({ description: "New action text (amend reword/add)" })),
			reason: Type.Optional(Type.String({ description: "Why (amend only, append-only log)" })),
			op: Type.Optional(StringEnum(["reword", "add", "drop", "reorder", "check_change"] as const, { description: "Amend kind" })),
			order: Type.Optional(Type.Array(Type.Integer(), { description: "New id order (amend reorder)" })),
			check: Type.Optional(Type.String({ description: "Replacement check (amend check_change/add)" })),
			judgment: Type.Optional(Type.String({ description: "Replacement acceptance text (amend check_change/add)" })),
			files: Type.Optional(Type.Array(Type.String(), { description: "Replacement files (amend check_change/add)" })),
			judgmentVerdict: Type.Optional(StringEnum(["pass", "fail"] as const, { description: "Judge verdict (complete of a judgment item)" })),
			judgmentSource: Type.Optional(Type.String({ description: "Who judged and what they returned, e.g. boolean_guy Noul q1=true" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext): Promise<ToolText> {
			const cwd = ctx.cwd;

			if (params.action === "list") {
				const files = listPlanFiles(cwd);
				if (files.length === 0) return text("No plans.");
				const rows = files.map((f) => {
					try {
						const s = loadState(f);
						return `${PREFIX}${s.slug}: ${s.status}, ${s.items.filter((i) => i.state === "done").length}/${s.items.length} done - ${s.goal}`;
					} catch {
						return `${f}: unreadable`;
					}
				});
				return text(rows.join("\n"));
			}

			if (params.action === "create") {
				const goal = (params.goal ?? "").trim();
				const specs = params.items ?? [];
				if (!goal) throw new Error("create needs goal.");
				if (specs.length === 0) throw new Error("create needs items.");
				const existing = activePlan(cwd);
				if (existing) throw new Error(`Active plan ${PREFIX}${existing.slug} exists (${statusLine(existing)}). Finish it, or amend/abandon it first. Never overwrite.`);
				for (const [i, s] of specs.entries()) {
					if (s.check && s.judgment) throw new Error(`item ${i + 1}: check and judgment are mutually exclusive.`);
					if (!s.check && !s.judgment) throw new Error(`item ${i + 1}: declare a check (shell command) or judgment (acceptance text).`);
				}
				pruneFinished(cwd);
				const now = Date.now();
				const state: PlanState = {
					v: 1,
					goal,
					slug: slugify(goal),
					created: now,
					status: "active",
					current: null,
					riskiestItem: params.riskiestItem ?? null,
					risks: params.risks ?? [],
					items: specs.map((s, i) => ({
						id: i + 1,
						action: s.action,
						files: s.files ?? [],
						check: s.check,
						judgment: s.judgment,
						dependsOn: s.dependsOn ?? [],
						assumptions: s.assumptions ?? [],
						state: "pending" as const,
						failedRuns: 0,
					})),
					amends: [],
					structuralAmends: 0,
				};
				for (const it of state.items) {
					for (const dep of it.dependsOn) {
						if (!state.items.some((d) => d.id === dep)) throw new Error(`item ${it.id}: dependsOn ${dep} does not exist.`);
					}
				}
				saveState(cwd, state);
				return text(`Plan created: ${DIR}/${PREFIX}${state.slug}.json (view .md)\n${statusLine(state)}\n${renderView(state)}`);
			}

			// Remaining actions need the active plan; status also shows a settled one.
			const state = params.action === "status" ? (activePlan(cwd) ?? latestPlan(cwd)) : activePlan(cwd);
			if (!state) throw new Error("No active plan. Use create first (or list).");
			const find = (id?: number) => {
				const item = state.items.find((i) => i.id === id);
				if (!item) throw new Error(`No item ${id}.`);
				return item;
			};
			const finish = (msg: string, escalate: string[] = []) => {
				saveState(cwd, state);
				const prefix = escalate.map((e) => `ESCALATE [${e}]`).join("\n");
				return text(`${prefix ? `${prefix}\n` : ""}${msg}`, { escalate: escalate.length > 0, triggers: escalate });
			};

			if (params.action === "status") return text(`${statusLine(state)}\n${renderView(state)}`);

			if (params.action === "claim") {
				const item = find(params.item);
				if (item.state === "done") throw new Error(`Item ${item.id} already done.`);
				const active = state.items.find((i) => i.state === "active");
				if (active && active.id !== item.id) throw new Error(`Item ${active.id} is active. One item at a time; complete it first.`);
				const blocked = item.dependsOn.filter((d) => state.items.find((i) => i.id === d)?.state !== "done");
				if (blocked.length) throw new Error(`Item ${item.id} blocked: depends on ${blocked.join(", ")}.`);
				item.state = "active";
				state.current = item.id;
				item.claimedAt = Date.now();
				item.claimScope = (await gitScope(cwd)) ?? [];
				return finish(`Claimed ${item.id}. ${item.action}\nAssumptions to hold: ${item.assumptions.join("; ") || "none declared"}`);
			}

			if (params.action === "check") {
				const item = find(params.item);
				if (item.state !== "active") throw new Error(`Item ${item.id} is not active. claim it first.`);
				if (item.judgment) {
					return text(`JUDGMENT REQUIRED for item ${item.id}: ${item.judgment}\nRun the judge (e.g. boolean_guy Noul), then complete with judgmentVerdict + judgmentSource. If no judge is available, ESCALATE [uncheckable].`);
				}
				const cmd = item.check as string;
				const { exit, output } = await runCmd(cmd, cwd, signal);
				const passed = exit === 0;
				item.evidence = { kind: "cmd", cmd, exit, passed, output, at: Date.now(), mtimes: mtimesOf(item.files, cwd) };
				if (passed) {
					item.failedRuns = 0;
					return finish(`check passed (exit 0): ${cmd}\n${output}`);
				}
				item.failedRuns += 1;
				const escalate = item.failedRuns >= 2 ? ["two_failed_fixes"] : [];
				return finish(`check FAILED (exit ${exit}): ${cmd}\n${output}\nFix and re-run check.`, escalate);
			}

			if (params.action === "complete") {
				const item = find(params.item);
				if (item.state !== "active") throw new Error(`Item ${item.id} is not active.`);
				if (item.judgment) {
					if (params.judgmentVerdict !== "pass") {
						throw new Error(`Judgment item ${item.id} needs judgmentVerdict=pass and judgmentSource. Verdict missing or fail; fix and re-ask, or ESCALATE [uncheckable].`);
					}
					if (!(params.judgmentSource ?? "").trim()) throw new Error("judgmentSource required (who judged, what they returned).");
					item.evidence = { kind: "judgment", verdict: "pass", source: params.judgmentSource.trim(), at: Date.now() };
				} else {
					const ev = item.evidence;
					if (!ev || ev.kind !== "cmd") throw new Error(`No check evidence for item ${item.id}. Run check first.`);
					if (!ev.passed) throw new Error(`Last check for item ${item.id} failed (exit ${ev.exit}). Fix and re-run check.`);
					const changed = evidenceStale(cwd, item);
					if (changed.length) throw new Error(`Evidence stale, files changed after check: ${changed.join(", ")}. Re-run check.`);
				}
				item.state = "done";
				state.current = null;

				const escalate: string[] = [];
				// Regression sweep: finished cmd items must still pass.
				const regressions: string[] = [];
				for (const done of state.items) {
					if (done.id === item.id || done.state !== "done" || !done.check) continue;
					const { exit, output } = await runCmd(done.check, cwd, signal);
					if (exit !== 0) regressions.push(`item ${done.id} now fails: ${done.check}\n${output}`);
				}
				if (regressions.length) escalate.push("regression");
				// Scope drift: new touched files outside this item's declared set.
				// git failure (non-git cwd) must be loud, never a silent pass.
				const scope = await gitScope(cwd);
				const known = new Set([...(item.claimScope ?? []), ...state.items.flatMap((i) => i.files)]);
				const drift = (scope ?? []).filter((f) => !known.has(f));
				if (drift.length) escalate.push("scope_drift");

				const allSettled = settleIfDone(state);
				const parts = [`Item ${item.id} done. ${statusLine(state)}`];
				if (regressions.length) parts.push(`REGRESSION:\n${regressions.join("\n")}`);
				if (scope === null) parts.push("Scope drift check unavailable: git status failed (not a git repo?). No drift detection on this completion.");
				if (drift.length) parts.push(`Files outside declared scope: ${drift.join(", ")}`);
				if (allSettled) parts.push("All items settled. Run the completion packet (reasoning_coach) before reporting done.");
				return finish(parts.join("\n"), escalate);
			}

			if (params.action === "amend") {
				const reason = (params.reason ?? "").trim();
				if (!reason) throw new Error("amend needs reason (append-only log).");
				const structural = params.op !== "reword";
				let detail = "";
				const escalate: string[] = [];
				if (params.op === "reword") {
					const item = find(params.item);
					detail = `${item.action} -> ${params.text ?? ""}`;
					item.action = (params.text ?? "").trim() || item.action;
				} else if (params.op === "add") {
					const id = Math.max(0, ...state.items.map((i) => i.id)) + 1;
					if (!params.check && !params.judgment) throw new Error("add needs check or judgment.");
					state.items.push({
						id,
						action: (params.text ?? "").trim() || `item ${id}`,
						files: params.files ?? [],
						check: params.check,
						judgment: params.judgment,
						dependsOn: params.item ? [params.item] : [],
						assumptions: [],
						state: "pending",
						failedRuns: 0,
					});
					detail = `added item ${id}`;
				} else if (params.op === "drop") {
					const item = find(params.item);
					item.state = "dropped";
					if (state.current === item.id) state.current = null;
					detail = `dropped item ${item.id}`;
					if (settleIfDone(state)) detail += "; all items settled, plan done";
					escalate.push("drop");
				} else if (params.op === "reorder") {
					const order = params.order ?? [];
					const ids = state.items.map((i) => i.id).sort((a, b) => a - b);
					if (order.slice().sort((a, b) => a - b).join(",") !== ids.join(",")) throw new Error(`order must be a permutation of ${ids.join(",")}.`);
					state.items = order.map((id) => state.items.find((i) => i.id === id) as PlanItem);
					detail = `order -> ${order.join(",")}`;
				} else if (params.op === "check_change") {
					const item = find(params.item);
					detail = `check ${item.check ?? item.judgment} -> ${params.check ?? params.judgment ?? ""}`;
					item.check = params.check;
					item.judgment = params.judgment;
					if (params.files) item.files = params.files;
					item.evidence = undefined;
				} else {
					throw new Error("amend needs op.");
				}
				state.amends.push({ at: Date.now(), op: params.op ?? "?", itemId: params.item, reason, detail });
				if (structural) {
					state.structuralAmends += 1;
					if (state.structuralAmends >= 2) escalate.push("structural_amend");
				}
				return finish(`Amended: ${detail}\n${statusLine(state)}`, escalate);
			}

			if (params.action === "abandon") {
				state.status = "abandoned";
				saveState(cwd, state);
				return text(`Plan ${PREFIX}${state.slug} abandoned.`);
			}

			throw new Error(`Unknown action ${String(params.action)}.`);
		},
	});
}
