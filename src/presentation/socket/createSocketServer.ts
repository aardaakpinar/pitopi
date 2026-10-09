import type http from "node:http";
import { Server } from "socket.io";
import type { AuditService } from "../../application/auditService.js";
import type { Pseudonymizer } from "../../application/identity.js";
import type { UserRepository } from "../../application/ports.js";
import type { PresenceService } from "../../application/presenceService.js";
import type { BruteForceGuard } from "../../application/rateLimiter.js";
import type { SessionService } from "../../application/sessionService.js";
import type { StoryService } from "../../application/storyService.js";
import { AUTH_TIMEOUT_MS, LIMITS } from "../../config/constants.js";
import type { AppEnv } from "../../config/env.js";
import { resolveClientIp } from "../../shared/clientIp.js";
import { isOriginAllowed } from "../../shared/origin.js";
import type { Logger } from "../../shared/logger.js";
import { AUTHED_ROOM, Broadcaster } from "./broadcaster.js";
import { createEventRegistrar, type SocketContext } from "./guard.js";
import { registerAuthHandler } from "./handlers/authHandler.js";
import { registerCallHandlers } from "./handlers/callHandler.js";
import { registerProfileHandlers } from "./handlers/profileHandler.js";
import { registerSessionHandlers } from "./handlers/sessionHandler.js";
import { registerStoryHandlers } from "./handlers/storyHandler.js";
import type { HandlerDeps } from "./handlers/types.js";

export interface SocketServerDeps {
  env: AppEnv;
  logger: Logger;
  presence: PresenceService;
  stories: StoryService;
  sessions: SessionService;
  users: UserRepository;
  audit: AuditService;
  pseudonymizer: Pseudonymizer;
  bruteForce: BruteForceGuard;
}

export interface SocketServerHandle {
  io: Server;
  broadcaster: Broadcaster;
}

export function createSocketServer(httpServer: http.Server, deps: SocketServerDeps): SocketServerHandle {
  const { env, logger } = deps;

  const io = new Server(httpServer, {
    // No `cors` option: cross-origin browser access is denied by default.
    transports: ["websocket"],
    maxHttpBufferSize: LIMITS.socketMaxBufferBytes,
    // Blocks cross-site WebSocket hijacking from pages on foreign origins.
    allowRequest: (req, callback) => {
      callback(null, isOriginAllowed(req.headers.origin, req.headers.host, env.allowedOrigins));
    },
  });

  const broadcaster = new Broadcaster(io, deps.presence, deps.stories);
  const handlerDeps: HandlerDeps = { ...deps, io, broadcaster };
  const socketsPerIp = new Map<string, number>();

  io.on("connection", (socket) => {
    const ip = resolveClientIp(socket.handshake.address, socket.handshake.headers["x-forwarded-for"], env.trustProxyHops);

    const open = (socketsPerIp.get(ip) ?? 0) + 1;
    if (open > LIMITS.maxSocketsPerIp) {
      socket.disconnect(true);
      return;
    }
    socketsPerIp.set(ip, open);

    const ctx: SocketContext = { socket, ip, account: null, authenticating: false };
    const on = createEventRegistrar(ctx, logger);

    // Sockets that never authenticate must not hold a connection open forever.
    const authTimer = setTimeout(() => {
      if (!ctx.account) socket.disconnect(true);
    }, AUTH_TIMEOUT_MS);

    registerAuthHandler(ctx, on, handlerDeps);
    registerCallHandlers(ctx, on, handlerDeps);
    registerStoryHandlers(ctx, on, handlerDeps);
    registerProfileHandlers(ctx, on, handlerDeps);
    registerSessionHandlers(ctx, on, handlerDeps);

    socket.on("error", (err) => logger.error("Socket error", err));

    socket.on("disconnect", () => {
      clearTimeout(authTimer);
      const remaining = (socketsPerIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) socketsPerIp.delete(ip);
      else socketsPerIp.set(ip, remaining);

      const user = deps.presence.get(socket.id);
      const partners = deps.presence.remove(socket.id);
      for (const partner of partners) io.to(partner).emit("chat-disconnected", { from: socket.id });

      if (user) {
        io.to(AUTHED_ROOM).emit("user-disconnected", socket.id);
        deps.audit.log("DISCONNECT", { persistentUserId: user.persistentUserId, socketId: socket.id });
        broadcaster.presenceChanged();
      }
    });
  });

  return { io, broadcaster };
}
