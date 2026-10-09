// ==================== TIME ====================
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const STORY_EXPIRY = 12 * HOUR;
export const SESSION_TTL_MS = 7 * 24 * HOUR;
export const UNCLAIMED_TOKEN_TTL_MS = 7 * 24 * HOUR;
export const CLEANUP_INTERVAL = HOUR;
export const PENDING_CALL_TTL_MS = 2 * MINUTE;
export const PENDING_SWEEP_INTERVAL = 30 * SECOND;
export const AUTH_TIMEOUT_MS = 10 * SECOND;

export const TURKISH_MONTHS = [
  "OCAK", "SUBAT", "MART", "NISAN", "MAYIS", "HAZIRAN",
  "TEMMUZ", "AGUSTOS", "EYLUL", "EKIM", "KASIM", "ARALIK",
] as const;

export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "nar", "admin", "root", "system", "moderator",
]);

// ==================== ABUSE PROTECTION ====================
export const BRUTE_FORCE_CONFIG = {
  maxAttempts: 5,
  windowMs: 5 * MINUTE,
  banDurationMs: 15 * MINUTE,
} as const;

export const RATE_LIMIT_CONFIG = {
  maxRequestsPerWindow: 10,
  windowMs: MINUTE,
} as const;

// ==================== INPUT LIMITS ====================
export const LIMITS = {
  /** Socket.IO frame cap. Story uploads are the largest legitimate payload. */
  socketMaxBufferBytes: 8_000_000,
  maxSocketsPerIp: 50,
  maxOnlineUsers: 5_000,
  /** Encrypted envelope: 16k-char file chunk + AES-GCM tag, base64 encoded. */
  maxCiphertextChars: 32_768,
  maxIvChars: 24,
  maxPublicKeyChars: 128,
  /** ~5 MB of image bytes once base64 encoded. */
  maxStoryDataChars: 7_000_000,
  maxStoriesPerUser: 5,
  /** Recipients a "selected people" story may name. */
  maxStoryAudience: 100,
  maxSessionsPerAccount: 10,
  maxDeviceLabelChars: 60,
  maxCaptionChars: 200,
  maxProfilePicChars: 150_000,
  keyFileUploadBytes: 256,
  maxAuditStringChars: 200,
  maxAuditInflight: 100,
} as const;

// ==================== SOCKET EVENT BUDGETS (token buckets) ====================
export const SOCKET_BUCKETS = {
  auth: { capacity: 5, refillPerSec: 0.2 },
  signal: { capacity: 10, refillPerSec: 1 },
  // A 10 MB file is ~900 relayed chunks, so this has to be generous.
  relay: { capacity: 400, refillPerSec: 200 },
  story: { capacity: 3, refillPerSec: 0.1 },
  storyRead: { capacity: 30, refillPerSec: 3 },
  profile: { capacity: 3, refillPerSec: 0.2 },
  misc: { capacity: 20, refillPerSec: 5 },
} as const;
export type BucketName = keyof typeof SOCKET_BUCKETS;

// ==================== IDENTIFIERS ====================
export const ACCOUNT_ID_REGEX = /^[a-f0-9]{64}$/;
export const SESSION_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const SOCKET_ID_REGEX = /^[A-Za-z0-9_-]{8,40}$/;
export const STORY_ID_REGEX = /^[a-f0-9-]{36}$/;
export const PERSISTENT_ID_REGEX = /^[a-f0-9]{32}$/;

// Machine-readable error codes sent to clients. The client owns all
// user-facing text (app/assets/config/translations.json, "server_<code>" keys).
export const ERROR_CODES = {
  INVALID_USER_ID: "invalid_user_id",
  USER_NOT_FOUND: "user_not_found",
  SESSION_EXPIRED: "session_expired",
  TOO_MANY_REQUESTS: "too_many_requests",
  RATE_LIMITED: "rate_limited",
  AUTH_ERROR: "auth_error",
  FILE_TOO_LARGE: "file_too_large",
  SERVER_ERROR: "server_error",
  BUSY: "busy",
  UNAVAILABLE: "unavailable",
  FORBIDDEN_ORIGIN: "forbidden_origin",
} as const;
