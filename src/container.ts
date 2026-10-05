import { AuditService } from "./application/auditService.js";
import { AuthService, TokenCleanupService } from "./application/authService.js";
import { Pseudonymizer } from "./application/identity.js";
import { PresenceService } from "./application/presenceService.js";
import { BruteForceGuard, FixedWindowLimiter } from "./application/rateLimiter.js";
import { SessionService } from "./application/sessionService.js";
import { StoryService } from "./application/storyService.js";
import { BRUTE_FORCE_CONFIG, RATE_LIMIT_CONFIG, SESSION_TTL_MS } from "./config/constants.js";
import type { AppEnv } from "./config/env.js";
import type { FirebaseHandles } from "./config/firebase.js";
import { FirestoreSessionRepository } from "./infrastructure/firestore/firestoreSessionRepository.js";
import { FirestoreTokenRepository } from "./infrastructure/firestore/firestoreTokenRepository.js";
import { FirestoreUserRepository } from "./infrastructure/firestore/firestoreUserRepository.js";
import { RtdbAuditLogRepository } from "./infrastructure/firestore/rtdbAuditLogRepository.js";

/**
 * Composition root: the only place where concrete adapters are chosen and
 * wired into the services. Everything else depends on interfaces.
 */
export function buildContainer(env: AppEnv, firebase: FirebaseHandles) {
  const pseudonymizer = new Pseudonymizer(env.serverSecret);

  const tokens = new FirestoreTokenRepository(firebase.firestore);
  const users = new FirestoreUserRepository(firebase.firestore);
  const sessionRepo = new FirestoreSessionRepository(firebase.firestore);

  const audit = new AuditService(new RtdbAuditLogRepository(firebase.rtdb), pseudonymizer);
  const sessions = new SessionService(sessionRepo, SESSION_TTL_MS);
  const auth = new AuthService(tokens, users, sessions);
  const tokenCleanup = new TokenCleanupService(tokens, users);

  const presence = new PresenceService();
  const stories = new StoryService();

  const httpLimiter = new FixedWindowLimiter(RATE_LIMIT_CONFIG.maxRequestsPerWindow, RATE_LIMIT_CONFIG.windowMs);
  const bruteForce = new BruteForceGuard(BRUTE_FORCE_CONFIG, (ip, type, attempts) =>
    audit.log("BRUTE_FORCE_BAN", { ip, type, attempts }),
  );

  return { pseudonymizer, users, audit, sessions, auth, tokenCleanup, presence, stories, httpLimiter, bruteForce };
}

export type Container = ReturnType<typeof buildContainer>;
