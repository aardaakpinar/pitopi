import type { AuditEntry, SessionRecord, UserRecord } from "../domain/types.js";

// Ports: the application layer depends on these interfaces only. Firestore,
// RTDB or in-memory implementations live in `infrastructure/`.

export interface TokenRecord {
  id: string;
  createdAt: number;
}

export interface TokenRepository {
  /** Registers an unclaimed token. Returns false when the id already exists. */
  create(id: string, createdAt: number): Promise<boolean>;
  exists(id: string): Promise<boolean>;
  /** A token is claimed once someone has logged in with it. */
  markClaimed(id: string): Promise<void>;
  listUnclaimed(limit: number): Promise<TokenRecord[]>;
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
  delete(tokenHash: string): Promise<void>;
  deleteExpired(now: number, limit: number): Promise<number>;
}

export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
}

export type Clock = () => number;
