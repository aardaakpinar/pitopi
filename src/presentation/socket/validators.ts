import {
  ACCOUNT_ID_REGEX,
  LIMITS,
  PERSISTENT_ID_REGEX,
  SESSION_TOKEN_REGEX,
  SOCKET_ID_REGEX,
  STORY_ID_REGEX,
} from "../../config/constants.js";

// Socket payloads are untrusted JSON of any shape. Every handler passes its
// payload through one of these parsers and ignores the event on null.

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseSessionToken(value: unknown): string | null {
  return typeof value === "string" && SESSION_TOKEN_REGEX.test(value) ? value : null;
}

export function isAccountId(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_ID_REGEX.test(value);
}

export function parseSocketId(value: unknown): string | null {
  return typeof value === "string" && SOCKET_ID_REGEX.test(value) ? value : null;
}

/** An uncompressed P-256 point: 65 bytes starting with 0x04. */
export function parsePublicKey(value: unknown): string | null {
  if (typeof value !== "string" || value.length > LIMITS.maxPublicKeyChars) return null;
  if (!BASE64_REGEX.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 65 && bytes[0] === 0x04 ? value : null;
}

export function parseCall(payload: unknown): { targetId: string; cryptoPublicKey: string } | null {
  if (!isDict(payload)) return null;
  const targetId = parseSocketId(payload.targetId);
  const cryptoPublicKey = parsePublicKey(payload.cryptoPublicKey);
  return targetId && cryptoPublicKey ? { targetId, cryptoPublicKey } : null;
}

export function parseTarget(payload: unknown): { targetId: string } | null {
  if (!isDict(payload)) return null;
  const targetId = parseSocketId(payload.targetId);
  return targetId ? { targetId } : null;
}

const REJECT_REASONS = new Set(["busy", "rejected"]);

export function parseReject(payload: unknown): { targetId: string; reason: string } | null {
  const target = parseTarget(payload);
  if (!target) return null;
  const reason = (payload as Dict).reason;
  return { targetId: target.targetId, reason: typeof reason === "string" && REJECT_REASONS.has(reason) ? reason : "rejected" };
}

export interface Envelope {
  type: "encrypted";
  version: 1;
  iv: string;
  ciphertext: string;
}

export function parseRelay(payload: unknown): { targetId: string; envelope: Envelope } | null {
  const target = parseTarget(payload);
  if (!target) return null;
  const envelope = (payload as Dict).envelope;
  if (!isDict(envelope) || envelope.type !== "encrypted") return null;
  const { iv, ciphertext } = envelope;
  if (typeof iv !== "string" || typeof ciphertext !== "string") return null;
  if (iv.length === 0 || iv.length > LIMITS.maxIvChars || !BASE64_REGEX.test(iv)) return null;
  if (ciphertext.length === 0 || ciphertext.length > LIMITS.maxCiphertextChars) return null;
  if (!BASE64_REGEX.test(ciphertext)) return null;
  // Rebuilt from validated fields only, so unknown properties never travel on.
  return { targetId: target.targetId, envelope: { type: "encrypted", version: 1, iv, ciphertext } };
}

export function parseHidden(payload: unknown): boolean | null {
  return isDict(payload) && typeof payload.hidden === "boolean" ? payload.hidden : null;
}

const IMAGE_PREFIX = /^data:(image\/(?:png|jpeg|webp|gif));base64,/;

/** Magic-number check on the first decoded bytes, so the declared MIME can't lie. */
function matchesImageSignature(mime: string, base64Body: string): boolean {
  const head = Buffer.from(base64Body.slice(0, 24), "base64");
  switch (mime) {
    case "image/png":
      return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/gif":
      return head.subarray(0, 4).toString("ascii") === "GIF8";
    case "image/webp":
      return head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
    default:
      return false;
  }
}

export function parseImageDataUrl(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string" || value.length > maxChars) return null;
  const match = IMAGE_PREFIX.exec(value);
  if (!match) return null;
  const body = value.slice(match[0].length);
  if (!BASE64_REGEX.test(body) || body.length % 4 !== 0) return null;
  return matchesImageSignature(match[1], body) ? value : null;
}

export function parseStoryUpload(payload: unknown): { data: string; caption: string } | null {
  if (!isDict(payload) || payload.type !== "image") return null;
  const data = parseImageDataUrl(payload.data, LIMITS.maxStoryDataChars);
  if (!data) return null;
  const caption = typeof payload.caption === "string" ? payload.caption.slice(0, LIMITS.maxCaptionChars) : "";
  return { data, caption };
}

export function parseStoryRef(payload: unknown): { persistentUserId: string; storyId: string } | null {
  if (!isDict(payload)) return null;
  const { persistentUserId, storyId } = payload;
  if (typeof persistentUserId !== "string" || !PERSISTENT_ID_REGEX.test(persistentUserId)) return null;
  if (typeof storyId !== "string" || !STORY_ID_REGEX.test(storyId)) return null;
  return { persistentUserId, storyId };
}

export function parseStoryDelete(payload: unknown): { storyId: string } | null {
  if (!isDict(payload)) return null;
  return typeof payload.storyId === "string" && STORY_ID_REGEX.test(payload.storyId)
    ? { storyId: payload.storyId }
    : null;
}

export function parseProfilePic(payload: unknown): string | null {
  return parseImageDataUrl(payload, LIMITS.maxProfilePicChars);
}
