import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { renderGrid } from "./grid";
import { instances, widgetCtx, throttleState } from "./runtime";

export function scheduleWidgetUpdate() {
	if (!widgetCtx.value) return;
	if (throttleState.timer) return;
	throttleState.timer = setTimeout(() => {
		throttleState.timer = null;
		updateWidgets();
	}, 100);
}

export function updateWidgets() {
	if (!widgetCtx.value) return;

	if (instances.size === 0) {
		widgetCtx.value.ui.setWidget("agent-grid", undefined);
		return;
	}

	widgetCtx.value.ui.setWidget("agent-grid", (_tui: any, theme: any) => {
		return {
			render(width: number): string[] {
				return renderGrid(instances, width, theme);
			},
			invalidate() {},
		};
	});
}
