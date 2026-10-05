import type { Server } from "socket.io";
import type { AuditService } from "../../../application/auditService.js";
import type { Pseudonymizer } from "../../../application/identity.js";
import type { UserRepository } from "../../../application/ports.js";
import type { PresenceService } from "../../../application/presenceService.js";
import type { BruteForceGuard } from "../../../application/rateLimiter.js";
import type { SessionService } from "../../../application/sessionService.js";
import type { StoryService } from "../../../application/storyService.js";
import type { Logger } from "../../../shared/logger.js";
import type { Broadcaster } from "../broadcaster.js";

export interface HandlerDeps {
  io: Server;
  logger: Logger;
  presence: PresenceService;
  stories: StoryService;
  sessions: SessionService;
  users: UserRepository;
  audit: AuditService;
  pseudonymizer: Pseudonymizer;
  bruteForce: BruteForceGuard;
  broadcaster: Broadcaster;
}
