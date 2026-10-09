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
  async loginWithKeyFile(file: Buffer, device = ""): Promise<LoginResult | null> {
    const parsed = parseKeyFile(file);
    if (!parsed) return null;

    const accountId = await deriveAccountId(parsed.token, parsed.salt);
    const existingUser = await this.users.findById(accountId);
    let user: UserRecord;
    if (existingUser) {
      user = existingUser;
    } else {
      const registration = await this.tokens.find(accountId);
      if (!registration) return null;
      if (this.now() - registration.createdAt >= UNCLAIMED_TOKEN_TTL_MS) {
        await this.tokens.delete(accountId);
        return null;
      }

      const result = await this.users.createIfAbsent({
        id: accountId,
        username: `user_${accountId.slice(0, 8)}`,
        createdAt: this.now(),
        profilePic: null,
        hidden: false,
      });
      user = result.user;
    }

    // Registrations are only needed until the first successful login. The
    // user record is sufficient to recognise accounts on later logins.
    await this.tokens.delete(accountId);

    const sessionToken = await this.sessions.create(accountId, device);
    return { sessionToken, accountId, user: toPublicUser(user) };
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
