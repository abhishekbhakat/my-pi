/**
 * Mailbox for user mail (issue #5): the receiving side.
 *
 * store.ts is the message store shared with the server. sync.ts pulls the
 * local mirror and tracks pending acks. inbox.ts lists headers; read.ts
 * injects bodies through a callback.
 */

export {
	ackMessages,
	hasMessage,
	listUnread,
	unreadChars,
	writeMessage,
} from "./store.ts";
export {
	flushPendingAcks,
	mirrorDir,
	pull,
	queuePendingAcks,
} from "./sync.ts";
export { performInbox, syncPrep, type InboxOutcome } from "./inbox.ts";
export { performRead, type Inject, type ReadOutcome } from "./read.ts";
