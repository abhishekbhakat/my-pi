#!/usr/bin/env bun
/**
 * Justify markdown tables (default ceiling 128).
 *
 * bun justify.ts [file.md] [-w N] [--stdout] [-o out] [--no-jev]
 * stdin if no path.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_WIDTH, justifyMarkdown } from "./justify-core.ts";

function usage(): never {
	console.error("Usage: bun justify.ts [-w N] [--stdout] [-o out] [--no-jev] [file.md]");
	process.exit(2);
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	let width = DEFAULT_WIDTH;
	let stdout = false;
	let output: string | undefined;
	let noJev = false;
	const paths: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];
		if (tok === "-w" || tok === "--width") {
			const next = argv[++i];
			if (!next || !/^\d+$/.test(next)) usage();
			width = Number(next);
			continue;
		}
		if (tok === "--stdout") {
			stdout = true;
			continue;
		}
		if (tok === "--no-jev") {
			noJev = true;
			continue;
		}
		if (tok === "-o" || tok === "--output") {
			const next = argv[++i];
			if (!next) usage();
			output = next;
			continue;
		}
		if (tok.startsWith("-")) {
			console.error(`Unknown flag: ${tok}`);
			return 2;
		}
		paths.push(tok);
	}

	if (width < 8) {
		console.error("width must be >= 8");
		return 2;
	}
	if (paths.length > 1) {
		console.error("one input file only");
		return 2;
	}
	if (stdout && output) {
		console.error("Use either --stdout or -o, not both");
		return 2;
	}

	const path = paths[0];
	const text = path
		? readFileSync(path, "utf8")
		: await Bun.stdin.text();

	const result = await justifyMarkdown(text, width, !noJev);

	if (output) writeFileSync(output, result, "utf8");
	else if (path && !stdout) writeFileSync(path, result, "utf8");
	else process.stdout.write(result);
	return 0;
}

if (import.meta.main) {
	process.exit(await main());
}
