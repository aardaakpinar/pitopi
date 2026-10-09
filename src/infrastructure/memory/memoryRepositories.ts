import type {
  AuditLogRepository,
  SessionRepository,
  TokenRecord,
  TokenRepository,
  UserRepository,
} from "../../application/ports.js";
import type { AuditEntry, SessionRecord, UserRecord } from "../../domain/types.js";

/** In-memory adapters, used by the unit tests and handy for local experiments. */
export class MemoryTokenRepository implements TokenRepository {
  readonly items = new Map<string, { createdAt: number }>();

  async create(id: string, createdAt: number): Promise<boolean> {
    if (this.items.has(id)) return false;
    this.items.set(id, { createdAt });
    return true;
  }
  async find(id: string): Promise<TokenRecord | null> {
    const item = this.items.get(id);
    return item ? { id, createdAt: item.createdAt } : null;
  }
  async listCreatedBefore(cutoff: number, limit: number): Promise<TokenRecord[]> {
    return Array.from(this.items.entries())
      .filter(([, v]) => v.createdAt <= cutoff)
      .sort(([, a], [, b]) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map(([id, v]) => ({ id, createdAt: v.createdAt }));
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class MemoryUserRepository implements UserRepository {
  readonly items = new Map<string, UserRecord>();

  async findById(id: string): Promise<UserRecord | null> {
    return this.items.get(id) ?? null;
  }
  async createIfAbsent(user: UserRecord): Promise<{ user: UserRecord; created: boolean }> {
    const existing = this.items.get(user.id);
    if (existing) return { user: existing, created: false };
    this.items.set(user.id, user);
    return { user, created: true };
  }
  async exists(id: string): Promise<boolean> {
    return this.items.has(id);
  }
  async updateProfilePic(id: string, profilePic: string | null): Promise<void> {
    const user = this.items.get(id);
    if (user) user.profilePic = profilePic;
  }
  async updateHidden(id: string, hidden: boolean): Promise<void> {
    const user = this.items.get(id);
    if (user) user.hidden = hidden;
  }
}

export class MemorySessionRepository implements SessionRepository {
  readonly items = new Map<string, SessionRecord>();

  async save(tokenHash: string, record: SessionRecord): Promise<void> {
    this.items.set(tokenHash, record);
  }
  async find(tokenHash: string): Promise<SessionRecord | null> {
    return this.items.get(tokenHash) ?? null;
  }
  async listByAccount(accountId: string): Promise<Array<{ tokenHash: string; record: SessionRecord }>> {
    return Array.from(this.items.entries())
      .filter(([, record]) => record.accountId === accountId)
      .map(([tokenHash, record]) => ({ tokenHash, record }));
  }
  async delete(tokenHash: string): Promise<void> {
    this.items.delete(tokenHash);
  }
  async deleteExpired(now: number, limit: number): Promise<number> {
    let removed = 0;
    for (const [hash, rec] of this.items) {
      if (removed >= limit) break;
      if (rec.expiresAt < now) {
        this.items.delete(hash);
        removed += 1;
      }
    }
    return removed;
  }
}

export class MemoryAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async purgeBefore(cutoff: number, maxDays: number): Promise<number> {
    const days = new Set<string>();
    const expired = new Set<AuditEntry>();
    for (const entry of this.entries) {
      if (entry.timestamp >= cutoff) continue;
      const day = new Date(entry.timestamp).toISOString().slice(0, 10);
      if (!days.has(day) && days.size >= maxDays) continue;
      days.add(day);
      expired.add(entry);
    }
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (expired.has(this.entries[i])) this.entries.splice(i, 1);
    }
    return days.size;
  }
}
