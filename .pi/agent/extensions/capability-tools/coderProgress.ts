import { appendFileSync } from "node:fs";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";

export type CoderSend = (message: string) => Promise<string>;
export interface CoderUpdate { phase: string; text: string; delta?: boolean; replace?: boolean }
export interface CoderChannel {
	update: (update: CoderUpdate) => void;
	attach: (send?: CoderSend) => void;
}

function clean(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export class CoderProgress {
	phase = "starting";
	private tail = "";
	private streamingPhase = "";

	constructor(private readonly directory: string) {}

	update(update: CoderUpdate): void {
		const value = clean(update.text);
		const prefix = update.delta && this.streamingPhase === update.phase ? "" : `\n[${update.phase}] `;
		const chunk = prefix + value;
		appendFileSync(path.join(this.directory, "progress.log"), chunk, { mode: 0o600 });
		this.tail = (update.replace ? `[${update.phase}] ${value}` : this.tail + chunk).slice(-6000);
		this.phase = update.phase;
		this.streamingPhase = update.delta ? update.phase : "";
	}

	lines(count = 8): string[] {
		return this.tail.split("\n").filter(Boolean).slice(-count).map((line) => line.slice(-180));
	}

	partial(): string {
		return `PARTIAL - not a result. Phase: ${this.phase}\n${this.lines(40).join("\n") || "Waiting for stream events."}`;
	}
}

export function helperProgress(channel?: CoderChannel): AgentToolUpdateCallback | undefined {
	if (!channel) return undefined;
	return (result) => {
		const details = result.details as { status?: string; streamKind?: string } | undefined;
		const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
		channel.update({ phase: details?.streamKind ?? details?.status ?? "running", text, replace: true });
	};
}

/** Map coder subprocess events to the shared progress channel. */
export function coderEvent(event: Record<string, any>, update: CoderChannel["update"]): void {
	if (event.type === "message_update") {
		const delta = event.assistantMessageEvent;
		if (delta?.type === "toolcall_start") update({ phase: "tool", text: `Preparing ${delta.toolName ?? "tool call"}` });
		if (delta?.type === "toolcall_delta") update({ phase: "tool arguments", text: delta.delta ?? "", delta: true });
		if (delta?.type === "text_delta" || delta?.type === "thinking_delta") {
			update({ phase: delta.type === "text_delta" ? "text" : "thinking", text: delta.delta ?? "", delta: true });
		}
	} else if (event.type === "tool_execution_start") {
		const args = event.args ?? {};
		const target = args.path ?? args.command ?? args.action ?? "";
		update({ phase: "tool", text: `${event.toolName} ${String(target).slice(0, 400)}` });
	} else if (event.type === "tool_execution_end") {
		const result = event.result?.content?.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n") ?? "";
		update({ phase: event.isError ? "tool error" : "tool done", text: `${event.toolName} ${result.slice(-500)}` });
	} else if (event.type === "agent_start") {
		update({ phase: "running", text: "Coder processing task." });
	}
}
