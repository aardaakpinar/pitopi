import { toPublicUser } from "../../../application/authService.js";
import { ERROR_CODES, LIMITS, RESERVED_NAMES } from "../../../config/constants.js";
import { AUTHED_ROOM } from "../broadcaster.js";
import type { RegisterOn, SocketContext } from "../guard.js";
import { parseSessionToken } from "../validators.js";
import type { HandlerDeps } from "./types.js";

export function registerAuthHandler(ctx: SocketContext, on: RegisterOn, deps: HandlerDeps): void {
  const { socket, ip } = ctx;

  const fail = (code: string, reason: string, countAsFailure = true) => {
    if (countAsFailure) deps.bruteForce.recordFailure(ip, "auth");
    socket.emit("auth_failed", { code });
    deps.audit.log("AUTH_FAILED", { reason, ip, socketId: socket.id });
    socket.disconnect();
  };

  on("auth", { auth: false, bucket: "auth" }, async (payload) => {
    if (ctx.account || ctx.authenticating) return;
    ctx.authenticating = true;

    try {
      if (deps.bruteForce.isBanned(ip, "auth")) {
        socket.emit("auth_failed", {
          code: ERROR_CODES.RATE_LIMITED,
          params: { minutes: deps.bruteForce.remainingMinutes(ip, "auth") },
        });
        socket.disconnect();
        return;
      }

      const token = parseSessionToken(payload);
      if (!token) return fail(ERROR_CODES.INVALID_USER_ID, "invalid_token_format");

      const session = await deps.sessions.resolveDetailed(token);
      if (!session) return fail(ERROR_CODES.SESSION_EXPIRED, "session_not_found");
      const { accountId, tokenHash: sessionHash } = session;

      const user = await deps.users.findById(accountId);
      if (!user) return fail(ERROR_CODES.USER_NOT_FOUND, "user_not_found");

      if (RESERVED_NAMES.has(user.username.toLowerCase())) {
        deps.audit.log("AUTH_FAILED", { reason: "reserved_name", username: user.username, ip });
        socket.emit("nickname-restricted");
        socket.disconnect();
        return;
      }

      if (deps.presence.count() >= LIMITS.maxOnlineUsers) {
        socket.emit("auth_failed", { code: ERROR_CODES.BUSY });
        socket.disconnect();
        return;
      }

      const persistentUserId = deps.pseudonymizer.persistentUserId(accountId);
      const { replacedSocketId, orphanedPartners } = deps.presence.register({
        socketId: socket.id,
        accountId,
        persistentUserId,
        sessionHash,
        username: user.username,
        profilePic: user.profilePic,
        hidden: user.hidden,
      });

      // Last login wins: drop the older socket of the same account.
      if (replacedSocketId) {
        for (const partner of orphanedPartners) {
          deps.io.to(partner).emit("chat-disconnected", { from: replacedSocketId });
        }
        deps.io.sockets.sockets.get(replacedSocketId)?.disconnect(true);
      }

      ctx.account = { accountId, persistentUserId, sessionHash };
      await socket.join(AUTHED_ROOM);
      deps.bruteForce.recordSuccess(ip, "auth");
      deps.audit.log("AUTH_OK", { username: user.username, persistentUserId, ip, socketId: socket.id });

      socket.emit("auth_ok", { user: toPublicUser(user) });
      socket.emit("your-id", {
        socketId: socket.id,
        persistentUserId,
        username: user.username,
        profilePic: user.profilePic,
      });
      socket.emit("online-users", deps.presence.listVisible());
      socket.emit("stories-updated", deps.stories.feed(persistentUserId));
      deps.broadcaster.presenceChanged();
    } finally {
      ctx.authenticating = false;
    }
  });
}
