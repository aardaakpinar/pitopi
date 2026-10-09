import type { Database } from "firebase-admin/database";
import { AuditService } from "../../application/auditService.js";
import type { AuditLogRepository } from "../../application/ports.js";
import { TURKISH_MONTHS } from "../../config/constants.js";
import type { AuditEntry } from "../../domain/types.js";

const RETENTION_CURSOR_PATH = "LOG_META/retentionCursor";
const FIRST_LOG_DAY = "1970-01-01";

function localDay(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid audit retention cursor.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid audit retention cursor.");
  }
  return date;
}

function auditPartitionPath(day: Date): string {
  const year = String(day.getUTCFullYear());
  const month = TURKISH_MONTHS[day.getUTCMonth()];
  const date = String(day.getUTCDate()).padStart(2, "0");
  return `LOG/${year}/${month}/${date}`;
}

/** Writes and expires entries in the existing date-partitioned audit layout. */
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

  async purgeBefore(cutoff: number, maxDays: number): Promise<number> {
    const cutoffDay = localDay(new Date(cutoff));
    const cursorSnapshot = await this.db.ref(RETENTION_CURSOR_PATH).get();
    const cursorValue = cursorSnapshot.val();
    const cursor = cursorValue === null ? FIRST_LOG_DAY : String(cursorValue);
    let day = parseDay(cursor);
    const cutoffDate = parseDay(cutoffDay);
    if (day >= cutoffDate) return 0;

    const updates: Record<string, null | string> = {};
    let processed = 0;
    while (day < cutoffDate && processed < maxDays) {
      updates[auditPartitionPath(day)] = null;
      day.setUTCDate(day.getUTCDate() + 1);
      processed += 1;
    }
    updates[RETENTION_CURSOR_PATH] = localDay(new Date(Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
    )));
    await this.db.ref().update(updates);
    return processed;
  }
}
