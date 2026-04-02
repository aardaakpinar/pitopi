export const STORY_EXPIRY = 12 * 60 * 60 * 1000; // 12 hours
export const USER_ID_EXPIRY = 12 * 60 * 60 * 1000; // 12 hours
export const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
export const STALE_CONNECTION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export const TURKISH_MONTHS = [
  "OCAK","SUBAT","MART","NISAN","MAYIS","HAZIRAN","TEMMUZ","AGUSTOS","EYLUL","EKIM","KASIM","ARALIK"
];

export const RESERVED_NAMES = new Set([
  "nar", "admin", "root", "system", "moderator"
]);

export const AUTHORIZED_IPS = new Set(["localhost"]);

export const BRUTE_FORCE_CONFIG = {
  maxAttempts: 5,
  windowMs: 5 * 60 * 1000,
  banDurationMs: 15 * 60 * 1000,
};

export const RATE_LIMIT_CONFIG = {
  maxRequestsPerWindow: 10,
  windowMs: 60 * 1000,
};

export const SUSPICIOUS_THRESHOLD = 20;

export const PORT = process.env.PORT || 3000;