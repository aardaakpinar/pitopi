import { ERROR_CODES } from "../../../config/constants.js";
import type { RegisterOn, SocketContext } from "../guard.js";
import { parseSessionId } from "../validators.js";
import type { HandlerDeps } from "./types.js";

/**
 * Lets a signed-in user see and revoke their own sessions. Every query is
 * scoped to ctx.account.accountId, so one account can never touch another's.
 */
export function registerSessionHandlers(ctx: SocketContext, on: RegisterOn, deps: HandlerDeps): void {
  const { io, presence, sessions } = deps;

  const dropSockets = (hashes: ReadonlySet<string>) => {
    for (const socketId of presence.socketsBySession(hashes)) {
      const target = io.sockets.sockets.get(socketId);
      target?.emit("auth_failed", { code: ERROR_CODES.SESSION_EXPIRED });
      target?.disconnect(true);
    }
  };

  on("list-sessions", { auth: true, bucket: "misc" }, async (_payload, ack) => {
    if (!ctx.account) return;
    const list = await sessions.list(
      ctx.account.accountId,
      ctx.account.sessionHash,
      presence.onlineSessionHashes(ctx.account.accountId),
    );
    ack?.({ ok: true, sessions: list });
  });

  on("revoke-session", { auth: true, bucket: "misc" }, async (payload, ack) => {
    const id = parseSessionId(payload);
    if (!id || !ctx.account) {
      ack?.({ ok: false });
      return;
    }
    const revoked = await sessions.revokeById(ctx.account.accountId, id);
    if (!revoked) {
      ack?.({ ok: false });
      return;
    }
    deps.audit.log("SESSION_REVOKED", { persistentUserId: ctx.account.persistentUserId });
    // Ack first: when the revoked session is this very socket, it is dropped right after.
    ack?.({ ok: true, self: revoked === ctx.account.sessionHash });
    dropSockets(new Set([revoked]));
  });

  on("revoke-other-sessions", { auth: true, bucket: "misc" }, async (_payload, ack) => {
    if (!ctx.account) return;
    const revoked = await sessions.revokeOthers(ctx.account.accountId, ctx.account.sessionHash);
    deps.audit.log("SESSIONS_REVOKED_OTHERS", { persistentUserId: ctx.account.persistentUserId, count: revoked.length });
    ack?.({ ok: true, count: revoked.length });
    dropSockets(new Set(revoked));
  });
}
