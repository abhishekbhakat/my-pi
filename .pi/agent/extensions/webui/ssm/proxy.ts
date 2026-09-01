import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";

/** Raw byte proxy to a loopback live backend. No buffering. */
export function proxyToLive(
	request: IncomingMessage,
	response: ServerResponse,
	port: number,
	onDead: () => void,
	opts?: { path?: string; extraHeaders?: Record<string, string | string[]> },
): void {
	const headers = { ...request.headers, host: `127.0.0.1:${port}` };
	const up = httpRequest(
		{
			hostname: "127.0.0.1",
			port,
			path: opts?.path ?? request.url,
			method: request.method,
			headers,
		},
		(incoming) => {
			const out = { ...incoming.headers, ...opts?.extraHeaders };
			response.writeHead(incoming.statusCode ?? 502, out);
			incoming.pipe(response);
		},
	);
	up.setTimeout(0);
	up.on("error", () => {
		onDead();
		if (!response.headersSent) {
			response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
			response.end("Live pi backend is gone. Open a pi session, then refresh.");
			return;
		}
		response.end();
	});
	request.pipe(up);
}

export function renderNoLivePage(): string {
	return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Pi — no live session</title>
<style>
body { font: 13px ui-monospace, Menlo, monospace; background: #141520; color: #e8ecf4; padding: 24px; }
a { color: #7eaaff; }
</style>
</head><body>
<p>No live pi session attached.</p>
<p>Start pi in a project, then open <a href="/live">live UI</a> again.</p>
<p><a href="/ssm">Session manager</a> still works (disk catalog).</p>
</body></html>`;
}
