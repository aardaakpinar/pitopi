import crypto from "node:crypto";

/**
 * Derives stable, non-reversible public identifiers from internal ones using
 * a server-side secret, so account ids (credential-adjacent) never leave the
 * server and no in-memory mapping table is needed.
 */
export class Pseudonymizer {
  constructor(private readonly secret: Buffer) {}

  private hmac(namespace: string, value: string): string {
    return crypto.createHmac("sha256", this.secret).update(`${namespace}:${value}`).digest("hex");
  }

  persistentUserId(accountId: string): string {
    return this.hmac("persistent", accountId).slice(0, 32);
  }

  ip(ip: string): string {
    return this.hmac("ip", ip).slice(0, 16);
  }
}
