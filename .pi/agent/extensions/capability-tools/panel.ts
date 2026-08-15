import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { Markdown, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type PanelState = {
	title: string;
	body: string;
	status: string;
	failed?: boolean;
};

const HINT = "Esc cancel";

let handle: OverlayHandle | undefined;
let finish: (() => void) | undefined;
let panel: CapabilityPanel | undefined;
let inputUnsub: (() => void) | undefined;
let onEscape: (() => void) | undefined;

export function closeCapabilityPanel(): void {
	inputUnsub?.();
	inputUnsub = undefined;
	onEscape = undefined;
	handle?.hide();
	finish?.();
	handle = undefined;
	finish = undefined;
	panel = undefined;
}

export function setPanelEscape(handler?: () => void): void {
	onEscape = handler;
}

function bindInput(ctx: ExtensionCommandContext): void {
	inputUnsub?.();
	if (!ctx.hasUI) {
		inputUnsub = undefined;
		return;
	}
	inputUnsub = ctx.ui.onTerminalInput((data) => {
		if (!matchesKey(data, "escape")) return;
		if (onEscape) onEscape();
		else closeCapabilityPanel();
		return { consume: true };
	});
}

class CapabilityPanel {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly markdown: Markdown;
	private title: string;
	private status: string;
	private failed = false;

	constructor(tui: TUI, theme: Theme, state: PanelState) {
		this.tui = tui;
		this.theme = theme;
		this.title = state.title;
		this.status = state.status;
		this.failed = state.failed === true;
		this.markdown = new Markdown(state.body, 0, 0, getMarkdownTheme());
	}

	setState(state: PanelState): void {
		this.title = state.title;
		this.status = state.status;
		this.failed = state.failed === true;
		this.markdown.setText(state.body);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = Math.max(1, width - 2);
		const color = this.failed ? "error" : "accent";
		const titleStr = truncateToWidth(` ${this.title} `, innerW);
		const titleW = visibleWidth(titleStr);
		const left = "─".repeat(Math.max(0, Math.floor((innerW - titleW) / 2)));
		const right = "─".repeat(Math.max(0, innerW - titleW - left.length));
		const top = th.fg("border", `╭${left}`) + th.fg(color, titleStr) + th.fg("border", `${right}╮`);
		const wrap = (text: string): string => (
			th.fg("border", "│") + truncateToWidth(` ${text}`, innerW, "...", true) + th.fg("border", "│")
		);
		const body = this.markdown.render(Math.max(1, innerW - 1)).map((line) => wrap(line));
		const bottom = th.fg("border", `╰${"─".repeat(innerW)}╯`);
		return [top, wrap(th.fg("dim", this.status)), ...body, wrap(th.fg("dim", HINT)), bottom];
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	dispose(): void {
		if (panel === this) {
			panel = undefined;
			handle = undefined;
			finish = undefined;
		}
	}
}

export async function showCapabilityPanel(
	ctx: ExtensionCommandContext,
	state: PanelState,
): Promise<void> {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify(`${state.title}: ${state.body}`, state.failed ? "error" : "info");
		return;
	}

	if (panel) {
		panel.setState(state);
		bindInput(ctx);
		return;
	}

	await new Promise<void>((resolve, reject) => {
		void ctx.ui.custom<void>((tui, theme, _kb, done) => {
			finish = done;
			panel = new CapabilityPanel(tui, theme, state);
			resolve();
			return panel;
		}, {
			overlay: true,
			overlayOptions: {
				anchor: "top-center",
				width: "100%",
				maxHeight: "40%",
				margin: { top: 0, left: 0, right: 0 },
				nonCapturing: true,
			},
			onHandle: (next) => {
				handle = next;
				next.unfocus();
			},
		}).catch(reject);
	});

	bindInput(ctx);
}

export function updateCapabilityPanel(state: PanelState): void {
	panel?.setState(state);
}
