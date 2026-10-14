/**
 * In-process SDK MCP server exposing Pi tools to the Claude Code model.
 *
 * Schema registry plus a rendezvous channel: the model sees real tools
 * (native tool_use blocks), the CLI calls the handler, and the handler
 * awaits the Pi outcome for its native id (delivered by the next provider
 * cycle from Pi's own toolResult records). Handlers never execute anything.
 */
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Tool } from "@earendil-works/pi-ai";
import type { ActiveBridgeTurn } from "./rendezvous.ts";
import { jsonSchemaToRawShape } from "./zodSchema.ts";

/** Per-tool-call wall-clock limit; Pi permission prompts can take minutes. */
const MCP_TOOL_TIMEOUT_MS = 600_000;

/** Minimal MCP CallToolResult shape (the SDK re-exports it only as a type dep). */
export type McpCallToolResult = {
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
	isError?: boolean;
};

/** Build the "pi" MCP server for one SDK turn. */
export function buildPiMcpServer(tools: Tool[], turn: ActiveBridgeTurn) {
	const definitions = tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: jsonSchemaToRawShape(tool.parameters as Record<string, any>),
		handler: async (args: Record<string, unknown>): Promise<McpCallToolResult> => {
			const outcome = await turn.nextOutcome(tool.name);
			return { content: outcome.content, isError: outcome.isError || undefined };
		},
	}));
	return createSdkMcpServer({ name: "pi", timeout: MCP_TOOL_TIMEOUT_MS, tools: definitions });
}