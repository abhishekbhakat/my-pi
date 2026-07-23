import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Open a URL in the default browser on macOS, Windows, and Linux.
 *
 * Windows: `start` treats the first quoted argument as the window title, so we
 * pass an empty title before the URL. Use cmd.exe explicitly (not bare `cmd`).
 */
export async function openBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	if (process.platform === "darwin") {
		await pi.exec("open", [url]);
		return;
	}

	if (process.platform === "win32") {
		await pi.exec("cmd.exe", ["/c", "start", "", url]);
		return;
	}

	await pi.exec("xdg-open", [url]);
}
