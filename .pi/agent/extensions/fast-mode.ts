import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "fast-mode";
const CONFIG_NAME = "openai-fast.json";
const ORIGINATOR = "codex_cli_rs";
const HINT = "x-codex-routing-hint";
const TIER = "priority";
const WRAP_KEY = Symbol.for("my-pi.fast-mode.wrap.v2");
const FALLBACK = "gpt-5.6-sol";
const CODEX = "openai-codex";

type FastConfig = { enabled: boolean; showStatus: boolean; debug: boolean };
type WrapState = FastConfig & {
	fetchWrapped: boolean;
	wsWrapped: boolean;
	lastModel: string;
	markWire: boolean;
	remember: (provider: string, id: string) => void;
};

const DEFAULT: FastConfig = { enabled: true, showStatus: true, debug: false };

function isCodexId(id: string): boolean {
	return id.startsWith("gpt-5");
}

function rememberCodex(provider: string, id: string): void {
	if (provider !== CODEX || !isCodexId(id)) return;
	wrapState().lastModel = id;
}

function wrapState(): WrapState {
	const g = globalThis as typeof globalThis & { [WRAP_KEY]?: WrapState };
	if (!g[WRAP_KEY]) {
		g[WRAP_KEY] = { ...DEFAULT, fetchWrapped: false, wsWrapped: false, lastModel: "", markWire: false, remember: rememberCodex };
	}
	const state = g[WRAP_KEY];
	if (!state.remember) state.remember = rememberCodex;
	if (state.lastModel && !isCodexId(state.lastModel)) state.lastModel = "";
	return state;
}

function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_NAME);
}

function readConfig(): FastConfig {
	const path = configPath();
	if (!existsSync(path)) return { ...DEFAULT };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<FastConfig>;
		return {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT.enabled,
			showStatus: typeof parsed.showStatus === "boolean" ? parsed.showStatus : DEFAULT.showStatus,
			debug: typeof parsed.debug === "boolean" ? parsed.debug : DEFAULT.debug,
		};
	} catch (error) {
		console.error(`Warning: Could not parse ${path}: ${error}`);
		return { ...DEFAULT };
	}
}

function envOverride(): boolean | undefined {
	const value = process.env.PI_CODEX_FAST;
	if (value === "1" || value === "true") return true;
	if (value === "0" || value === "false") return false;
	return undefined;
}

function applyConfig(config: FastConfig): WrapState {
	const state = wrapState();
	state.enabled = envOverride() ?? config.enabled;
	state.showStatus = config.showStatus;
	state.debug = config.debug;
	return state;
}

function isCodexBackend(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (!["https:", "wss:", "http:", "ws:"].includes(parsed.protocol)) return false;
		const host = parsed.hostname;
		const proxy = (process.env.PI_CODEX_FAST_HOST || "").split(",").map((h) => h.trim()).filter(Boolean);
		const hostOk = host === "chatgpt.com" || host.endsWith(".chatgpt.com")
			|| proxy.some((h) => host === h || host.endsWith(`.${h}`));
		if (!hostOk) return false;
		const path = parsed.pathname.replace(/\/+$/, "");
		return path.endsWith("/backend-api/codex/responses") || path.endsWith("/codex/responses");
	} catch {
		return false;
	}
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

function wireModel(state: WrapState): string {
	return state.lastModel || FALLBACK;
}

function lastWireLabel(state: WrapState): string {
	return state.markWire ? `Last Codex wire: ${wireModel(state)}` : `No Codex request yet; handshake fallback ${FALLBACK}`;
}

function modelFromJson(text: string): string | undefined {
	try {
		const parsed = JSON.parse(text) as { model?: unknown };
		return typeof parsed.model === "string" && parsed.model ? parsed.model : undefined;
	} catch {
		return undefined;
	}
}

function routingHint(model: string): string {
	return `model=${model};tier=${TIER}`;
}

function patchJson(text: string): string | undefined {
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		if (parsed.service_tier === TIER) return undefined;
		parsed.service_tier = TIER;
		return JSON.stringify(parsed);
	} catch {
		return undefined;
	}
}

function patchedRecord(init: HeadersInit | undefined, model: string): Record<string, string> {
	const headers = new Headers(init);
	headers.set("originator", ORIGINATOR);
	headers.set(HINT, routingHint(model));
	headers.delete("content-length");
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});
	return out;
}

function logPatch(kind: string, url: string, model: string): void {
	if (!wrapState().debug) return;
	console.error(`[fast-mode] ${kind} ${url} originator=${ORIGINATOR} hint=${routingHint(model)}`);
}

function isOptions(value: unknown): value is { headers?: HeadersInit } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rememberFromBody(text?: string): string {
	const model = text ? modelFromJson(text) : undefined;
	if (model) rememberCodex(CODEX, model);
	return wireModel(wrapState());
}

function markPatched(kind: string, url: string, model: string): void {
	wrapState().markWire = true;
	logPatch(kind, url, model);
}

function installWrappers(): void {
	const state = wrapState();
	if (!state.fetchWrapped) {
		const originalFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			if (!wrapState().enabled) return originalFetch(input, init);
			if (input instanceof Request) {
				if (!isCodexBackend(input.url)) return originalFetch(input, init);
				const request = new Request(input, init);
				const raw = await request.clone().text();
				const model = rememberFromBody(raw);
				const patched = patchJson(raw);
				markPatched("fetch", request.url, model);
				return originalFetch(new Request(request, {
					headers: patchedRecord(request.headers, model),
					...(patched ? { body: patched } : {}),
				}));
			}
			const url = requestUrl(input);
			if (!isCodexBackend(url)) return originalFetch(input, init);
			const raw = typeof init?.body === "string" ? init.body : undefined;
			const model = rememberFromBody(raw);
			const patched = raw ? patchJson(raw) : undefined;
			markPatched("fetch", url, model);
			return originalFetch(input, { ...init, headers: patchedRecord(init?.headers, model), ...(patched ? { body: patched } : {}) });
		};
		state.fetchWrapped = true;
	}

	const OriginalWebSocket = globalThis.WebSocket;
	if (state.wsWrapped || typeof OriginalWebSocket !== "function") return;

	class FastWebSocket extends OriginalWebSocket {
		constructor(url: string | URL, protocols?: unknown, options?: unknown) {
			const href = typeof url === "string" ? url : url.href;
			const argc = arguments.length;
			if (!wrapState().enabled || !isCodexBackend(href)) {
				if (argc <= 1) super(url);
				else if (argc === 2) super(url, protocols as never);
				else super(url, protocols as never, options as never);
				return;
			}
			const model = wireModel(wrapState());
			if (isOptions(protocols)) {
				super(url, { ...protocols, headers: patchedRecord(protocols.headers, model) });
			} else if (isOptions(options) || argc >= 3) {
				super(url, protocols as never, { ...(isOptions(options) ? options : {}), headers: patchedRecord(isOptions(options) ? options.headers : undefined, model) });
			} else if (argc === 2) {
				super(url, protocols as never, { headers: patchedRecord(undefined, model) });
			} else {
				super(url, { headers: patchedRecord(undefined, model) });
			}
			markPatched("websocket", href, model);
			const originalSend = this.send.bind(this);
			this.send = ((data: unknown, ...rest: unknown[]) => {
				if (!wrapState().enabled || typeof data !== "string") return originalSend(data as never, ...(rest as never[]));
				const next = rememberFromBody(data);
				const patched = patchJson(data);
				if (patched) wrapState().markWire = true;
				if (patched && wrapState().debug) console.error(`[fast-mode] ws-send model=${next} service_tier=${TIER}`);
				return originalSend((patched ?? data) as never, ...(rest as never[]));
			}) as typeof this.send;
		}
	}

	globalThis.WebSocket = FastWebSocket;
	state.wsWrapped = true;
}

function updateStatus(ctx: ExtensionContext, state: WrapState): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(EXTENSION_ID, state.showStatus && state.enabled ? "fast" : undefined);
}

function statusMessage(state: WrapState, ctx: ExtensionContext): string {
	const session = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
	const source = envOverride() === undefined ? "config" : "PI_CODEX_FAST";
	const scope = ctx.model?.provider === CODEX
		? `Session ${session} uses Codex Fast.`
		: `Session ${session} is not Codex. Fast applies only to ${CODEX} requests (chat or tools like patch-reviewer).`;
	if (!state.enabled) return `OpenAI Fast mode is off (${source}). ${scope} New Codex connections only.`;
	return `OpenAI Fast mode is on (${source}). ${scope} ${lastWireLabel(state)}. originator=${ORIGINATOR}, ${HINT}=${routingHint(wireModel(state))}. /restart after toggle if a Codex socket is already open.`;
}

export default function fastModeExtension(pi: ExtensionAPI) {
	installWrappers();
	applyConfig(readConfig());

	pi.on("session_start", (_event, ctx) => {
		updateStatus(ctx, applyConfig(readConfig()));
	});
	pi.on("model_select", (event, ctx) => {
		rememberCodex(event.model.provider, event.model.id);
		updateStatus(ctx, wrapState());
	});
	pi.on("before_provider_request", (_event, ctx) => {
		if (ctx.model?.provider === CODEX) rememberCodex(ctx.model.provider, ctx.model.id);
		updateStatus(ctx, wrapState());
	});

	pi.registerCommand("fast", {
		description: "Toggle ChatGPT Codex Fast mode (originator + routing hint)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"].filter((item) => item.startsWith(prefix.toLowerCase())).map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			const config = readConfig();
			if (action === "status") {
				ctx.ui.notify(statusMessage(applyConfig(config), ctx), "info");
				return;
			}
			if (action && action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
				return;
			}
			if (envOverride() !== undefined) {
				ctx.ui.notify(`PI_CODEX_FAST overrides /fast. Current: ${statusMessage(applyConfig(config), ctx)}`, "warning");
				return;
			}
			const next = { ...config, enabled: action === "on" ? true : action === "off" ? false : !config.enabled };
			writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`);
			const state = applyConfig(next);
			updateStatus(ctx, state);
			ctx.ui.notify(statusMessage(state, ctx), "info");
		},
	});
}
