/**
 * Outbox for user mail (issue #5): the sending side.
 *
 * send.ts resolves the target and posts to the server. A retry queue for
 * unreachable servers lands here later (outbox/queue.ts).
 */

export { performSend, type SendOutcome } from "./send.ts";
