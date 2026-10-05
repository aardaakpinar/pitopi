import crypto from "node:crypto";
import type { Clock, SessionRepository } from "./ports.js";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
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
  ) {}

  async create(accountId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("base64url"); // 43 chars
    await this.repo.save(hashToken(token), { accountId, expiresAt: this.now() + this.ttlMs });
    return token;
  }

  async resolve(token: string): Promise<string | null> {
    const hash = hashToken(token);
    const record = await this.repo.find(hash);
    if (!record) return null;
    if (record.expiresAt <= this.now()) {
      await this.repo.delete(hash);
      return null;
    }
    return record.accountId;
  }

  async revoke(token: string): Promise<void> {
    await this.repo.delete(hashToken(token));
  }

  purgeExpired(limit = 400): Promise<number> {
    return this.repo.deleteExpired(this.now(), limit);
  }
}
