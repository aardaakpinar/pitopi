import type { AuditEntry, SessionRecord, UserRecord } from "../domain/types.js";

// Ports: the application layer depends on these interfaces only. Firestore,
// RTDB or in-memory implementations live in `infrastructure/`.

export interface TokenRecord {
  id: string;
  createdAt: number;
}

export interface TokenRepository {
  /** Registers a key until its first login or expiration. */
  create(id: string, createdAt: number): Promise<boolean>;
  find(id: string): Promise<TokenRecord | null>;
  listCreatedBefore(cutoff: number, limit: number): Promise<TokenRecord[]>;
  delete(id: string): Promise<void>;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  /** Creates the user unless it already exists; returns the stored record. */
  createIfAbsent(user: UserRecord): Promise<{ user: UserRecord; created: boolean }>;
  exists(id: string): Promise<boolean>;
  updateProfilePic(id: string, profilePic: string | null): Promise<void>;
  updateHidden(id: string, hidden: boolean): Promise<void>;
}

export interface SessionRepository {
  save(tokenHash: string, record: SessionRecord): Promise<void>;
  find(tokenHash: string): Promise<SessionRecord | null>;
  listByAccount(accountId: string): Promise<Array<{ tokenHash: string; record: SessionRecord }>>;
  delete(tokenHash: string): Promise<void>;
  deleteExpired(now: number, limit: number): Promise<number>;
}

export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
  /** Removes complete daily partitions older than the cutoff, up to the limit. */
  purgeBefore(cutoff: number, maxDays: number): Promise<number>;
}

export type Clock = () => number;
