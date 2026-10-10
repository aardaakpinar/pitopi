import express, { type Request, type Router } from "express";
import multer from "multer";
import type { AuditService } from "../../../application/auditService.js";
import type { AuthService } from "../../../application/authService.js";
import type { BruteForceGuard, FixedWindowLimiter } from "../../../application/rateLimiter.js";
import { ERROR_CODES, LIMITS, RATE_LIMIT_CONFIG, SESSION_TOKEN_REGEX } from "../../../config/constants.js";
import { resolveClientIp } from "../../../shared/clientIp.js";
import { deviceLabel } from "../../../shared/device.js";
import { noStore, requireTrustedOrigin } from "../middleware/security.js";

export interface AuthRouteDeps {
  auth: AuthService;
  audit: AuditService;
  limiter: FixedWindowLimiter;
  bruteForce: BruteForceGuard;
  trustProxyHops: number;
  allowedOrigins: readonly string[];
}

// Memory storage + hard size/part limits: the endpoint only ever needs a
// 101-byte key file, so anything bigger is rejected before it is buffered.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.keyFileUploadBytes, files: 1, fields: 1, parts: 2 },
});

export function createAuthRouter(deps: AuthRouteDeps): Router {
  const router = express.Router();
  const trustedOrigin = requireTrustedOrigin(deps.allowedOrigins);

  const ipOf = (req: Request): string =>
    resolveClientIp(req.socket.remoteAddress, req.headers["x-forwarded-for"], deps.trustProxyHops);

  // Creating an account is state-changing, so it is POST (a GET could be
  // triggered by any <img> tag on any website).
  router.post("/signup", noStore, trustedOrigin, async (req, res) => {
    const ip = ipOf(req);
    const hit = deps.limiter.consume(`signup:${ip}`);
    if (!hit.allowed) {
      if (hit.count === RATE_LIMIT_CONFIG.maxRequestsPerWindow + 1) {
        deps.audit.log("RATE_LIMITED", { ip, endpoint: "/signup" });
      }
      res.status(429).json({ error: ERROR_CODES.TOO_MANY_REQUESTS });
      return;
    }

    const keyFile = await deps.auth.createKeyFile();
    deps.audit.log("SIGNUP", { ip });

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${Date.now()}.key"`);
    res.send(keyFile);
  });

  // Ban and rate checks run BEFORE the body is parsed or any scrypt work.
  router.post(
    "/login",
    noStore,
    trustedOrigin,
    (req, res, next) => {
      const ip = ipOf(req);
      if (deps.bruteForce.isBanned(ip, "login")) {
        res.status(429).json({
          success: false,
          error: ERROR_CODES.RATE_LIMITED,
          params: { minutes: deps.bruteForce.remainingMinutes(ip, "login") },
        });
        return;
      }
      const hit = deps.limiter.consume(`login:${ip}`);
      if (!hit.allowed) {
        if (hit.count === RATE_LIMIT_CONFIG.maxRequestsPerWindow + 1) {
          deps.audit.log("RATE_LIMITED", { ip, endpoint: "/login" });
        }
        res.status(429).json({ success: false, error: ERROR_CODES.TOO_MANY_REQUESTS });
        return;
      }
      next();
    },
    upload.single("file"),
    async (req, res) => {
      const ip = ipOf(req);
      const deviceId = typeof req.body?.deviceId === "string" && /^[a-f0-9]{32}$/.test(req.body.deviceId)
        ? req.body.deviceId
        : undefined;
      const result = req.file
        ? await deps.auth.loginWithKeyFile(req.file.buffer, deviceLabel(req.headers["user-agent"]), deviceId)
        : null;

      if (!result) {
        deps.bruteForce.recordFailure(ip, "login");
        res.json({ success: false });
        return;
      }

      deps.bruteForce.recordSuccess(ip, "login");
      deps.audit.log("LOGIN", { ip, username: result.user.username });
      res.json({ success: true, sessionToken: result.sessionToken, user: result.user });
    },
  );

  router.post("/logout", noStore, trustedOrigin, async (req, res) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (SESSION_TOKEN_REGEX.test(token)) {
      await deps.auth.logout(token);
      deps.audit.log("LOGOUT", { ip: ipOf(req) });
    }
    res.status(204).end();
  });

  return router;
}
