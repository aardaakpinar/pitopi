import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startScheduler } from "./application/scheduler.js";
import { CLEANUP_INTERVAL, ERROR_CODES, PENDING_SWEEP_INTERVAL, TOKEN_CLEANUP_INTERVAL } from "./config/constants.js";
import { loadEnv } from "./config/env.js";
import { initFirebase } from "./config/firebase.js";
import { buildContainer } from "./container.js";
import { createApp } from "./presentation/http/createApp.js";
import { createSocketServer } from "./presentation/socket/createSocketServer.js";
import { consoleLogger as logger } from "./shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==================== COMPOSITION ====================
const env = loadEnv();
const firebase = initFirebase(env);
const c = buildContainer(env, firebase);

const app = createApp({
  env,
  logger,
  staticDir: path.join(__dirname, "..", "app"),
  auth: { auth: c.auth, audit: c.audit, limiter: c.httpLimiter, bruteForce: c.bruteForce },
});

const server = http.createServer(app);
const { io, broadcaster } = createSocketServer(server, {
  env,
  logger,
  presence: c.presence,
  stories: c.stories,
  sessions: c.sessions,
  users: c.users,
  audit: c.audit,
  pseudonymizer: c.pseudonymizer,
  bruteForce: c.bruteForce,
});

// ==================== BACKGROUND JOBS ====================
const runAuditRetention = () => c.audit.purgeExpired();
void runAuditRetention().catch((err) => logger.error("Scheduled task failed: audit-log-retention", err));
const runTokenCleanup = () => c.tokenCleanup.run();
void runTokenCleanup().catch((err) => logger.error("Scheduled task failed: unclaimed-token-cleanup", err));

const stopScheduler = startScheduler(
  [
    {
      name: "audit-log-retention",
      intervalMs: CLEANUP_INTERVAL,
      run: runAuditRetention,
    },
    {
      name: "expire-pending-calls",
      intervalMs: PENDING_SWEEP_INTERVAL,
      run: () => {
        const expired = c.presence.expirePending();
        for (const call of expired) io.to(call.callerId).emit("call-rejected", { reason: ERROR_CODES.UNAVAILABLE });
        if (expired.length) broadcaster.presenceChanged();
      },
    },
    {
      name: "unclaimed-token-cleanup",
      intervalMs: TOKEN_CLEANUP_INTERVAL,
      run: runTokenCleanup,
    },
    {
      name: "housekeeping",
      intervalMs: CLEANUP_INTERVAL,
      run: async () => {
        if (c.stories.purgeExpired()) broadcaster.storiesChanged();
        c.httpLimiter.purge();
        c.bruteForce.purge();
        await c.sessions.purgeExpired();
      },
    },
  ],
  (name, err) => logger.error(`Scheduled task failed: ${name}`, err),
);

// ==================== PROCESS SAFETY ====================
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection", reason));
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception, shutting down", err);
  process.exit(1);
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down`);
  stopScheduler();
  broadcaster.stop();
  void io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ==================== START ====================
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(`Port ${env.port} is already in use. Stop the other process or set PORT.`);
    process.exit(1);
  }
  throw error;
});

server.listen(env.port, () => logger.info(`Pitopi server listening on port ${env.port}`));
