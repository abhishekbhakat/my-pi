/**
 * UDP discovery for user mail (issue #5).
 *
 * query.ts serves clients; responder.ts serves the machine that owns the
 * server role. peer.ts holds the shared datagram parsing.
 */

export { broadcastQuery } from "./query.ts";
export { startResponder, type DiscoveryHandle, type ResponderOptions } from "./responder.ts";
export type { PeerHello } from "./peer.ts";
