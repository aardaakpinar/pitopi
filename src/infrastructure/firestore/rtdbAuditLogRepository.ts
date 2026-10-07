import type { Database } from "firebase-admin/database";
import { AuditService } from "../../application/auditService.js";
import type { AuditLogRepository } from "../../application/ports.js";
import { TURKISH_MONTHS } from "../../config/constants.js";
import type { AuditEntry } from "../../domain/types.js";

/** Writes to LOG/<year>/<MONTH>/<day>/<key>, keeping the existing log layout. */
export class RtdbAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Database) {}

  async append(entry: AuditEntry): Promise<void> {
    const date = new Date(entry.timestamp);
    const year = String(date.getFullYear());
    const month = TURKISH_MONTHS[date.getMonth()];
    const day = String(date.getDate()).padStart(2, "0");
    const key = AuditService.entryKey(entry.event, entry.timestamp);

    await this.db.ref(`LOG/${year}/${month}/${day}/${key}`).set({
      event: entry.event,
      timestamp: date.toISOString(),
      unixMs: entry.timestamp,
      ...entry.data,
    });
  }
}
