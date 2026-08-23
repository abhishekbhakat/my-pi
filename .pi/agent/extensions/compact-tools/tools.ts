import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { buildToolBlock, WidthAwareLines } from "./cards";
import { ELAPSED_KEY, TOOL_NAMES, type ToolName } from "./constants";

type BuiltInTools = {
	read: ReturnType<typeof createReadTool>;
	write: ReturnType<typeof createWriteTool>;
	edit: ReturnType<typeof createEditTool>;
	bash: ReturnType<typeof createBashTool>;
	grep: ReturnType<typeof createGrepTool>;
	find: ReturnType<typeof createFindTool>;
	ls: ReturnType<typeof createLsTool>;
};

const toolCache = new Map<string, BuiltInTools>();

function getTools(cwd: string): BuiltInTools {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = {
			read: createReadTool(cwd),
			write: createWriteTool(cwd),
			edit: createEditTool(cwd),
			bash: createBashTool(cwd),
			grep: createGrepTool(cwd),
			find: createFindTool(cwd),
			ls: createLsTool(cwd),
		};
		toolCache.set(cwd, tools);
	}
	return tools;
}

export function registerCompactTools(pi: ExtensionAPI): void {
	const seed = getTools(process.cwd());
	const startedAtByCallId = new Map<string, number>();
	const elapsedTimerByCallId = new Map<string, ReturnType<typeof setInterval>>();
	const owned = new Set<string>(TOOL_NAMES);

	function stopTimer(id: string | undefined): void {
		if (!id) return;
		const timer = elapsedTimerByCallId.get(id);
		if (timer) clearInterval(timer);
		elapsedTimerByCallId.delete(id);
	}

	function ensureTimer(id: string, invalidate: () => void): number {
		let started = startedAtByCallId.get(id);
		if (started === undefined) {
			started = Date.now();
			startedAtByCallId.set(id, started);
		}
		if (!elapsedTimerByCallId.has(id)) {
			const timer = setInterval(() => invalidate(), 1000);
			timer.unref?.();
			elapsedTimerByCallId.set(id, timer);
		}
		return started;
	}

	function elapsedFor(id: string | undefined, result: any): number {
		const persisted = Number(result?.details?.[ELAPSED_KEY]);
		if (Number.isFinite(persisted)) return persisted;
		const started = id ? startedAtByCallId.get(id) : undefined;
		return started === undefined ? 0 : Math.max(0, Date.now() - started);
	}

	pi.on("tool_execution_start", async (event) => {
		if (!owned.has(event.toolName)) return;
		if (!startedAtByCallId.has(event.toolCallId)) {
			startedAtByCallId.set(event.toolCallId, Date.now());
		}
	});

	pi.on("tool_execution_end", async (event) => {
		if (!owned.has(event.toolName)) return;
		stopTimer(event.toolCallId);
	});

	pi.on("tool_result", async (event) => {
		if (!owned.has(event.toolName)) return;
		const started = startedAtByCallId.get(event.toolCallId);
		if (started === undefined) return;
		return {
			details: {
				...(event.details ?? {}),
				[ELAPSED_KEY]: Math.max(0, Date.now() - started),
			},
		};
	});

	pi.on("session_shutdown", async () => {
		for (const timer of elapsedTimerByCallId.values()) clearInterval(timer);
		elapsedTimerByCallId.clear();
		startedAtByCallId.clear();
	});

	function register(name: ToolName, source: BuiltInTools[ToolName], description?: string): void {
		pi.registerTool({
			name,
			label: name,
			description: description ?? source.description,
			parameters: source.parameters,
			promptSnippet: (source as any).promptSnippet,
			promptGuidelines: (source as any).promptGuidelines,
			renderShell: "self",
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const tools = getTools(ctx.cwd);
				return tools[name].execute(toolCallId, params as never, signal, onUpdate);
			},
			renderCall(args, theme, context) {
				if (!context?.isPartial) return new Container();
				const id = context.toolCallId;
				const started = ensureTimer(id, () => context.invalidate());
				return new WidthAwareLines(
					() =>
						buildToolBlock(name, (args ?? {}) as Record<string, unknown>, {}, {
							isPartial: true,
							elapsedMs: Date.now() - started,
						}),
					(text) => theme.bg("toolPendingBg", text),
				);
			},
			renderResult(result, options, theme, context) {
				if (options?.isPartial) return new Container();
				const isError = context?.isError ?? result?.isError ?? false;
				const id = context?.toolCallId;
				stopTimer(id);
				const lines = buildToolBlock(
					name,
					(context?.args ?? {}) as Record<string, unknown>,
					result,
					{
						isError,
						expanded: options?.expanded ?? false,
						elapsedMs: elapsedFor(id, result),
					},
				);
				return new WidthAwareLines(lines, (text) =>
					theme.bg(isError ? "toolErrorBg" : "toolSuccessBg", text),
				);
			},
		});
	}

	register("read", seed.read);
	register("write", seed.write);
	register("edit", seed.edit);
	register(
		"bash",
		seed.bash,
		"Execute bash commands (`tree --gitignore`, `ls`, `rg`,  etc.)",
	);
	register("grep", seed.grep);
	register("find", seed.find);
	register("ls", seed.ls);
}
