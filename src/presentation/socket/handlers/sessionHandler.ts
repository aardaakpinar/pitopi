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

  // Key rotation: the account gets a new key file and the current one stops
  // working. The key travels back in the ack (base64) over the same channel the
  // signup download uses; it is never stored or logged on the server.
  let rotating = false;
  on("rotate-key", { auth: true, bucket: "profile" }, async (_payload, ack) => {
    const account = ctx.account;
    if (!account || rotating) {
      ack?.({ ok: false });
      return;
    }
    rotating = true;
    try {
      const keyFile = await deps.auth.rotateKey(account.accountId);

      // The old key may be in someone else's hands, so every other session goes
      // too. A failure here must not hide the new key from its owner.
      let revoked: string[] = [];
      try {
        revoked = await sessions.revokeOthers(account.accountId, account.sessionHash);
      } catch (err) {
        deps.logger.error("Revoking sessions after key rotation failed", err);
      }

      deps.audit.log("KEY_ROTATED", { persistentUserId: account.persistentUserId, revokedSessions: revoked.length });
      ack?.({ ok: true, key: keyFile.toString("base64"), revoked: revoked.length });
      dropSockets(new Set(revoked));
    } catch (err) {
      deps.logger.error("Key rotation failed", err);
      ack?.({ ok: false });
    } finally {
      rotating = false;
    }
  });

  on("revoke-other-sessions", { auth: true, bucket: "misc" }, async (_payload, ack) => {
    if (!ctx.account) return;
    const revoked = await sessions.revokeOthers(ctx.account.accountId, ctx.account.sessionHash);
    deps.audit.log("SESSIONS_REVOKED_OTHERS", { persistentUserId: ctx.account.persistentUserId, count: revoked.length });
    ack?.({ ok: true, count: revoked.length });
    dropSockets(new Set(revoked));
  });
}
