import crypto from "node:crypto";
import { promisify } from "node:util";

// .key file layout: [ MAGIC (4B) | VERSION (1B) | TOKEN (64B) | SALT (32B) ]
export const KEY_MAGIC = Buffer.from("AUTH", "ascii");
export const KEY_VERSION = 0x01;
export const TOKEN_SIZE = 64;
export const SALT_SIZE = 32;
export const HEADER_SIZE = KEY_MAGIC.length + 1;
export const KEY_FILE_SIZE = HEADER_SIZE + TOKEN_SIZE + SALT_SIZE;

const TOKEN_OFFSET = HEADER_SIZE;
const SALT_OFFSET = TOKEN_OFFSET + TOKEN_SIZE;

// Parameters are part of the stored account ids: changing them would orphan
// every existing account. The token is 512 random bits, so the KDF is only a
// one-way mapping here, not a password-stretching defence.
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 };
const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

export interface ParsedKeyFile {
  token: Buffer;
  salt: Buffer;
}

export function buildKeyFile(token: Buffer, salt: Buffer): Buffer {
  return Buffer.concat([KEY_MAGIC, Buffer.from([KEY_VERSION]), token, salt]);
}

/** Returns null unless the buffer is exactly a well-formed key file. */
export function parseKeyFile(buffer: Buffer): ParsedKeyFile | null {
  if (buffer.length !== KEY_FILE_SIZE) return null;
  const magic = buffer.subarray(0, KEY_MAGIC.length);
  if (!crypto.timingSafeEqual(magic, KEY_MAGIC)) return null;
  if (buffer[KEY_MAGIC.length] !== KEY_VERSION) return null;
  return {
    token: buffer.subarray(TOKEN_OFFSET, TOKEN_OFFSET + TOKEN_SIZE),
    salt: buffer.subarray(SALT_OFFSET, SALT_OFFSET + SALT_SIZE),
  };
}

export async function deriveAccountId(token: Buffer, salt: Buffer): Promise<string> {
  const derived = await scryptAsync(token, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  return derived.toString("hex");
}

export function generateKeyMaterial(): ParsedKeyFile {
  return { token: crypto.randomBytes(TOKEN_SIZE), salt: crypto.randomBytes(SALT_SIZE) };
}
