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
  readonly items = new Map<string, { createdAt: number; claimed: boolean }>();

  async create(id: string, createdAt: number): Promise<boolean> {
    if (this.items.has(id)) return false;
    this.items.set(id, { createdAt, claimed: false });
    return true;
  }
  async exists(id: string): Promise<boolean> {
    return this.items.has(id);
  }
  async markClaimed(id: string): Promise<void> {
    const item = this.items.get(id);
    if (item) item.claimed = true;
  }
  async listUnclaimed(limit: number): Promise<TokenRecord[]> {
    return Array.from(this.items.entries())
      .filter(([, v]) => !v.claimed)
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
}
