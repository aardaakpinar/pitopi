import crypto from "node:crypto";
import { AUDIT_LOG_PURGE_BATCH_DAYS, AUDIT_LOG_RETENTION_MS, LIMITS } from "../config/constants.js";
import type { AuditLogRepository, Clock } from "./ports.js";

export type AuditEvent =
  | "LOGIN" | "LOGOUT" | "SIGNUP" | "AUTH_OK" | "AUTH_FAILED" | "DISCONNECT"
  | "CALL_CONNECTED" | "CALL_ENDED" | "STORY_UPLOADED" | "STORY_VIEWED" | "STORY_DELETED"
  | "SESSION_REVOKED" | "SESSIONS_REVOKED_OTHERS"
  | "RATE_LIMITED" | "BRUTE_FORCE_BAN";

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, LIMITS.maxAuditStringChars);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "object" && depth < 2) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([k, v]) => [k.replace(/[.#$\[\]/]/g, "_").slice(0, 50), sanitizeValue(v, depth + 1)]),
    );
  }
  return null;
}

/**
 * Fire-and-forget audit trail. Values are length-bounded and stripped of
 * control characters so unauthenticated input cannot bloat storage or forge
 * log lines, and writes are capped in flight. IP addresses are stored as
 * provided for abuse monitoring.
 */
export class AuditService {
  private inflight = 0;

  constructor(
    private readonly repo: AuditLogRepository,
    private readonly now: Clock = Date.now,
  ) {}

  log(event: AuditEvent, data: Record<string, unknown> = {}): void {
    if (this.inflight >= LIMITS.maxAuditInflight) {
      console.error(`Audit log dropped: maximum in-flight writes reached (${event})`);
      return;
    }

    const prepared = { ...data };

    this.inflight += 1;
    this.repo
      .append({ event, timestamp: this.now(), data: sanitizeValue(prepared) as Record<string, unknown> })
      .catch((err) => console.error("Audit write failed:", err instanceof Error ? err.message : err))
      .finally(() => {
        this.inflight -= 1;
      });
  }

  purgeExpired(): Promise<number> {
    return this.repo.purgeBefore(this.now() - AUDIT_LOG_RETENTION_MS, AUDIT_LOG_PURGE_BATCH_DAYS);
  }

  /** Unique, sortable key for the log tree (avoids same-millisecond clashes). */
  static entryKey(event: string, timestamp: number): string {
    return `${timestamp}_${event}_${crypto.randomBytes(3).toString("hex")}`;
  }
}
