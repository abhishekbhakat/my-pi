import type { ExtensionCommandContext, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Markdown, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type PanelState = {
	title: string;
	body: string;
	status: string;
	failed?: boolean;
};

const HINT = "Esc cancel";
const WIDGET_KEY = "capability-panel";
// Overlays used to cap at maxHeight: 40%. Widgets render every line they
// return, so bound the body instead to keep the editor visible.
const MAX_BODY_LINES = 8;

let uiRef: ExtensionUIContext | undefined;
let panel: CapabilityPanel | undefined;
let inputUnsub: (() => void) | undefined;
let onEscape: (() => void) | undefined;

function cleanupInput(): void {
	inputUnsub?.();
	inputUnsub = undefined;
	onEscape = undefined;
}

export function closeCapabilityPanel(): void {
	cleanupInput();
	// Clearing the widget disposes the panel component via the TUI.
	uiRef?.setWidget(WIDGET_KEY, undefined);
	uiRef = undefined;
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
		const body = this.markdown.render(Math.max(1, innerW - 1));
		const overflow = body.length - MAX_BODY_LINES;
		const visible = overflow > 0 ? body.slice(-MAX_BODY_LINES) : body;
		const lines = visible.map((line) => wrap(line));
		if (overflow > 0) {
			lines.unshift(wrap(th.fg("dim", `... ${overflow} earlier line(s) hidden`)));
		}
		const bottom = th.fg("border", `╰${"─".repeat(innerW)}╯`);
		return [top, wrap(th.fg("dim", this.status)), ...lines, wrap(th.fg("dim", HINT)), bottom];
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	dispose(): void {
		// The TUI can dispose widgets externally (session switch, reload).
		// Drop the Escape listener so a dead panel never consumes input.
		cleanupInput();
		if (panel === this) {
			panel = undefined;
			uiRef = undefined;
		}
	}
}

/**
 * Show the streaming panel as a widget above the editor so it sits with the
 * other status widgets instead of covering the top of the screen.
 * Widget order is insertion order; emit "capability:panel-open" after showing
 * so widgets like tool-counter re-paint and land below this panel.
 */
export function showCapabilityPanel(
	ctx: ExtensionCommandContext,
	state: PanelState,
): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify(`${state.title}: ${state.body}`, state.failed ? "error" : "info");
		return;
	}

	uiRef = ctx.ui;

	if (panel) {
		panel.setState(state);
		bindInput(ctx);
		return;
	}

	ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
		panel = new CapabilityPanel(tui, theme, state);
		return panel;
	}, { placement: "aboveEditor" });

	bindInput(ctx);
}

export function updateCapabilityPanel(state: PanelState): void {
	panel?.setState(state);
}
