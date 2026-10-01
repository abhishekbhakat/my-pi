/**
 * pi wiring for user mail (issue #5). Registers the /pi-user-mail command,
 * the user_mail tool, the renderer, and the election lifecycle hooks.
 * Everything else lives in sibling modules; this is the only file that
 * imports @earendil-works packages.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { getAgentDirPath } from "../mailbox.ts";
import { registerUser } from "./client.ts";
import { getLocalIdentity, setAlias, getUserMailDir, userMailId } from "./identity.ts";
import { MAX_LIST_LIMIT } from "./session/format.ts";
import { performInbox, performRead } from "./mailbox/index.ts";
import { performSend } from "./outbox/index.ts";
import {
	cachedElection,
	dropElection,
	ensureElected,
	NEVER_SERVER,
	setChip,
	stopOwnedServer,
	USER_MAIL_CUSTOM_TYPE,
} from "./session/index.ts";

type ToolResult = {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
};

/** Registers the user_mail tool, /pi-user-mail command, and renderer. */
export function registerUserMail(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		void ensureElected()
			.then((result) => setChip(ctx, result !== null && result.role !== "none"))
			.catch(() => setChip(ctx, false));
	});

	pi.on("session_shutdown", () => {
		void stopOwnedServer();
	});

	pi.registerMessageRenderer(USER_MAIL_CUSTOM_TYPE, (message, options, theme) => {
		const head = theme.fg("accent", "[user-mail] ");
		return new Text(head + String(message.content), options.outputPad, 0);
	});

	pi.registerCommand("pi-user-mail", {
		description: "Register your alias: /pi-user-mail <alias>. No argument shows your identity and server state.",
		async handler(args, ctx) {
			const agentDir = getAgentDirPath();
			const alias = args.trim().replace(/^["']|["']$/g, "");
			let content: string;
			try {
				const result = await ensureElected();
				const state =
					result?.role === "server"
						? `You run the server (${result.serverId}, port ${result.endpoint?.port}).`
						: result?.role === "client"
							? `Server: ${result.serverId} at ${result.endpoint?.host}:${result.endpoint?.port}.`
							: NEVER_SERVER
								? "No server found and this machine never claims one (PI_USER_MAIL_SERVER=never)."
								: "No server on the network; the next session that finds none will claim the role.";
				if (!alias) {
					const identity = await getLocalIdentity(agentDir);
					content = identity.alias
						? `You are ${userMailId(identity)}. ${state}`
						: `Username: ${identity.username}. No alias yet. Register one: /pi-user-mail <alias> ${state}`;
				} else {
					const identity = await setAlias(alias, agentDir);
					content = `Registered. Your mail id: ${userMailId(identity)}. ${state}`;
				}
			} catch (error) {
				// A stale cached election is the usual suspect; drop it so the
				// next command or tool call re-elects.
				dropElection();
				content = error instanceof Error ? error.message : String(error);
			}
			const cached = cachedElection();
			setChip(ctx, cached !== null && cached.role !== "none");
			await pi.sendMessage(
				{ customType: USER_MAIL_CUSTOM_TYPE, content, display: true },
				{ deliverAs: "steer" },
			);
		},
	});

	pi.registerTool({
		name: "user_mail",
		description:
			"Passive mailbox between pi users on one local network (team mail), via the one network server. " +
			"send queues a message for a remote user; inbox syncs unread headers into the local mirror; " +
			"read injects bodies into your current leaf as display-only entries. Nothing ever triggers a turn.",
		promptSnippet: "User mail: run user_mail inbox when starting work and when idle; unread mail waits there.",
		promptGuidelines: [
			"Check user_mail inbox at the start of a work session and whenever you are blocked or idle.",
			"Reading user mail never triggers the sender; reply with user_mail send if an answer is needed.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("send"), Type.Literal("inbox"), Type.Literal("read")], {
				description: "send queues mail; inbox syncs and peeks headers; read injects bodies into your leaf",
			}),
			to: Type.Optional(
				Type.String({ description: "Target user: alias or alias@username (send only)" }),
			),
			message: Type.Optional(Type.String({ description: "Message text (send only)" })),
			limit: Type.Optional(
				Type.Number({
					description: `Max entries for inbox/read (capped at ${MAX_LIST_LIMIT})`,
					minimum: 1,
					maximum: MAX_LIST_LIMIT,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<ToolResult> {
			const agentDir = getAgentDirPath();
			const rootDir = getUserMailDir(agentDir);
			const ok = (text: string, details: Record<string, unknown> = {}): ToolResult => ({
				content: [{ type: "text" as const, text }],
				details,
			});

			const attempt = async (): Promise<ToolResult> => {
				const identity = await getLocalIdentity(agentDir);
				const myId = userMailId(identity);
				const result = await ensureElected();
				if (!result || result.role === "none" || !result.endpoint) {
					return ok(
						`Error: no user-mail server on the network.${result?.claimError ? ` Claim attempt failed: ${result.claimError}` : ""}`,
						{ error: "no_server", claimError: result?.claimError ?? null },
					);
				}
				const endpoint = result.endpoint;

				if (params.action === "send") {
					if (!params.to?.trim() || !params.message?.trim()) {
						return ok("Error: send needs both to and message.", { error: "invalid_request" });
					}
					if (!identity.alias) {
						return ok(
							"Error: register an alias first with /pi-user-mail <alias>.",
							{ error: "no_alias" },
						);
					}
					await registerUser(endpoint, myId);
					const outcome = await performSend(
						endpoint, myId, result.serverId, params.to.trim(), params.message,
					);
					return ok(outcome.text, outcome.details);
				}

				if (params.action === "inbox") {
					const outcome = await performInbox(endpoint, rootDir, myId, params.limit);
					return ok(outcome.text, outcome.details);
				}

				const outcome = await performRead(
					endpoint,
					rootDir,
					myId,
					async (content, details) => {
						await pi.sendMessage(
							{ customType: USER_MAIL_CUSTOM_TYPE, content, display: true, details },
							{ deliverAs: "steer" },
						);
					},
					params.limit,
				);
				return ok(outcome.text, outcome.details);
			};

			const failText = (error: unknown) =>
				`Error: ${error instanceof Error ? error.message : String(error)}`;

			// One retry after a re-election: a stale cached endpoint (the
			// server-owning session exited) heals itself instead of failing.
			try {
				return await attempt();
			} catch (error) {
				if (!cachedElection()) {
					return ok(failText(error), { error: "failed" });
				}
				dropElection();
				try {
					const result = await ensureElected();
					if (!result || result.role === "none" || !result.endpoint) {
						return ok(
							`Error: ${failText(error)} (re-election found no server).`,
							{ error: "failed", reelected: false },
						);
					}
					return await attempt();
				} catch (retryError) {
					return ok(failText(retryError), { error: "failed", reelected: true });
				}
			}
		},
	});
}
