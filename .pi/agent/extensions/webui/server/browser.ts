import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export async function openBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	if (process.platform === "darwin") {
		await pi.exec("open", [url]);
		return;
	}

	if (process.platform === "win32") {
		await pi.exec("cmd", ["/c", "start", "", url]);
		return;
	}

	await pi.exec("xdg-open", [url]);
}
