import { UNCLAIMED_TOKEN_TTL_MS } from "../config/constants.js";
import {
  buildKeyFile,
  deriveAccountId,
  generateKeyMaterial,
  parseKeyFile,
} from "../domain/keyFile.js";
import type { PublicUser, UserRecord } from "../domain/types.js";
import type { Clock, TokenRepository, UserRepository } from "./ports.js";
import type { SessionService } from "./sessionService.js";

export interface LoginResult {
  sessionToken: string;
  accountId: string;
  user: PublicUser;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { username: user.username, profilePic: user.profilePic ?? null, hidden: Boolean(user.hidden) };
}

export class AuthService {
  constructor(
    private readonly tokens: TokenRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
    private readonly now: Clock = Date.now,
  ) {}

  /** Mints a new key file and registers its hash. */
  async createKeyFile(): Promise<Buffer> {
    // A collision of 256-bit hashes is practically impossible; the loop only
    // exists so a freak collision cannot hand out an already-claimed key.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { token, salt } = generateKeyMaterial();
      const accountId = await deriveAccountId(token, salt);
      if (await this.tokens.create(accountId, this.now())) return buildKeyFile(token, salt);
    }
    throw new Error("Could not allocate a unique key");
  }

  /** Returns null for any invalid or unknown key (callers must not distinguish). */
  async loginWithKeyFile(file: Buffer, device = "", deviceId?: string): Promise<LoginResult | null> {
    const parsed = parseKeyFile(file);
    if (!parsed) return null;

    // Hash of the presented key. For an account that never rotated its key this
    // is also the account id; after a rotation the two differ.
    const keyHash = await deriveAccountId(parsed.token, parsed.salt);
    const direct = await this.users.findById(keyHash);
    // The account's original key is revoked once a different key took over.
    if (direct?.keyId && direct.keyId !== keyHash) return null;

    let user: UserRecord;
    const existingUser = direct ?? (await this.users.findByKeyId(keyHash));
    if (existingUser) {
      user = existingUser;
    } else {
      const registration = await this.tokens.find(keyHash);
      if (!registration) return null;
      if (this.now() - registration.createdAt >= UNCLAIMED_TOKEN_TTL_MS) {
        await this.tokens.delete(keyHash);
        return null;
      }

      const result = await this.users.createIfAbsent({
        id: keyHash,
        username: `user_${keyHash.slice(0, 8)}`,
        createdAt: this.now(),
        profilePic: null,
        hidden: false,
      });
      user = result.user;
    }

    // Registrations are only needed until the first successful login. The
    // user record is sufficient to recognise accounts on later logins.
    await this.tokens.delete(keyHash);

    const sessionToken = await this.sessions.create(user.id, device, deviceId);
    return { sessionToken, accountId: user.id, user: toPublicUser(user) };
  }

  /**
   * Replaces the account's key and returns the new key file. The old key stops
   * working immediately. The account id stays the same, so the username, the
   * public id other people know and everything derived from it are unchanged.
   */
  async rotateKey(accountId: string): Promise<Buffer> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { token, salt } = generateKeyMaterial();
      const keyHash = await deriveAccountId(token, salt);
      // Practically impossible; only guards against handing out a key that is already in use.
      if ((await this.users.exists(keyHash)) || (await this.users.findByKeyId(keyHash))) continue;
      await this.users.updateKeyId(accountId, keyHash);
      return buildKeyFile(token, salt);
    }
    throw new Error("Could not allocate a unique key");
  }

  logout(sessionToken: string): Promise<void> {
    return this.sessions.revoke(sessionToken);
  }
}

/**
 * Removes key registrations that were issued but never used to log in.
 * Account records remain valid after their one-time registration is removed.
 */
export class TokenCleanupService {
  constructor(private readonly tokens: TokenRepository, private readonly now: Clock = Date.now) {}

  async run(limit = 400): Promise<number> {
    const cutoff = this.now() - UNCLAIMED_TOKEN_TTL_MS;
    let removed = 0;
    for (const { id } of await this.tokens.listCreatedBefore(cutoff, limit)) {
      await this.tokens.delete(id);
      removed += 1;
    }
    return removed;
  }
}
