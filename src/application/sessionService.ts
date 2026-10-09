import crypto from "node:crypto";
import { LIMITS } from "../config/constants.js";
import type { SessionInfo } from "../domain/types.js";
import type { Clock, SessionRepository } from "./ports.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Public handle for a session: a prefix of its hash, useless as a credential. */
const publicId = (tokenHash: string): string => tokenHash.slice(0, 16);

export interface ResolvedSession {
  accountId: string;
  tokenHash: string;
}

/**
 * Opaque, random, expiring session tokens. Only the SHA-256 of a token is
 * stored, so a database leak does not yield usable sessions.
 */
export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now,
    private readonly maxPerAccount: number = LIMITS.maxSessionsPerAccount,
  ) {}

  async create(accountId: string, device = ""): Promise<string> {
    const token = crypto.randomBytes(32).toString("base64url"); // 43 chars
    const created = this.now();
    await this.repo.save(hashToken(token), {
      accountId,
      expiresAt: created + this.ttlMs,
      createdAt: created,
      device: device.slice(0, LIMITS.maxDeviceLabelChars),
    });
    await this.enforceCap(accountId);
    return token;
  }

  /** Keeps at most `maxPerAccount` live sessions by dropping the oldest. */
  private async enforceCap(accountId: string): Promise<void> {
    const live = (await this.repo.listByAccount(accountId))
      .filter((s) => s.record.expiresAt > this.now())
      .sort((a, b) => b.record.createdAt - a.record.createdAt);
    for (const stale of live.slice(this.maxPerAccount)) await this.repo.delete(stale.tokenHash);
  }

  async resolve(token: string): Promise<string | null> {
    return (await this.resolveDetailed(token))?.accountId ?? null;
  }

  async resolveDetailed(token: string): Promise<ResolvedSession | null> {
    const tokenHash = hashToken(token);
    const record = await this.repo.find(tokenHash);
    if (!record) return null;
    if (record.expiresAt <= this.now()) {
      await this.repo.delete(tokenHash);
      return null;
    }
    return { accountId: record.accountId, tokenHash };
  }

  async list(accountId: string, currentHash: string, onlineHashes: ReadonlySet<string>): Promise<SessionInfo[]> {
    return (await this.repo.listByAccount(accountId))
      .filter((s) => s.record.expiresAt > this.now())
      .sort((a, b) => b.record.createdAt - a.record.createdAt)
      .map(({ tokenHash, record }) => ({
        id: publicId(tokenHash),
        device: record.device || "Unknown device",
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        current: tokenHash === currentHash,
        online: onlineHashes.has(tokenHash),
      }));
  }

  /**
   * Revokes one of the account's own sessions by its public id. Returns the
   * revoked token hash (so live sockets can be dropped) or null when the id
   * does not belong to this account.
   */
  async revokeById(accountId: string, id: string): Promise<string | null> {
    const match = (await this.repo.listByAccount(accountId)).find((s) => publicId(s.tokenHash) === id);
    if (!match) return null;
    await this.repo.delete(match.tokenHash);
    return match.tokenHash;
  }

  /** Revokes every session of the account except `keepHash`; returns the revoked hashes. */
  async revokeOthers(accountId: string, keepHash: string): Promise<string[]> {
    const others = (await this.repo.listByAccount(accountId)).filter((s) => s.tokenHash !== keepHash);
    for (const s of others) await this.repo.delete(s.tokenHash);
    return others.map((s) => s.tokenHash);
  }

  async revoke(token: string): Promise<void> {
    await this.repo.delete(hashToken(token));
  }

  purgeExpired(limit = 400): Promise<number> {
    return this.repo.deleteExpired(this.now(), limit);
  }
}
