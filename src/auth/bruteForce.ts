import { BRUTE_FORCE_CONFIG, RATE_LIMIT_CONFIG, SUSPICIOUS_THRESHOLD, CLEANUP_INTERVAL } from "../config/constants.js";
import { logToFirebase } from "../utils/logging.js";

// ==================== BRUTE FORCE PROTECTION ====================
export const bruteForceMap = new Map<string, { attempts: number; firstAttempt: number; bannedUntil?: number }>();
export const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

export function getBruteForceKey(ip: string, type: string): string {
  return `${ip}:${type}`;
}

export function isBanned(ip: string, type: string): boolean {
  const key = getBruteForceKey(ip, type);
  const record = bruteForceMap.get(key);
  if (!record?.bannedUntil) return false;

  if (Date.now() > record.bannedUntil) {
    bruteForceMap.delete(key);
    return false;
  }
  return true;
}

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - record.windowStart > RATE_LIMIT_CONFIG.windowMs) {
    record.count = 0;
    record.windowStart = now;
  }

  record.count++;
  rateLimitMap.set(ip, record);

  return record.count > RATE_LIMIT_CONFIG.maxRequestsPerWindow;
}

export function getRemainingBanTime(ip: string, type: string): number {
  const key = getBruteForceKey(ip, type);
  const record = bruteForceMap.get(key);
  if (!record?.bannedUntil) return 0;
  return Math.ceil((record.bannedUntil - Date.now()) / 1000 / 60);
}

export function recordFailedAttempt(ip: string, type: string): void {
  const key = getBruteForceKey(ip, type);
  const now = Date.now();
  const record = bruteForceMap.get(key) || { attempts: 0, firstAttempt: now };

  if (now - record.firstAttempt > BRUTE_FORCE_CONFIG.windowMs) {
    record.attempts = 0;
    record.firstAttempt = now;
    delete record.bannedUntil;
  }

  record.attempts++;

  if (record.attempts >= BRUTE_FORCE_CONFIG.maxAttempts) {
    record.bannedUntil = now + BRUTE_FORCE_CONFIG.banDurationMs;
    console.warn(`🚫 Brute force ban: ${ip} (${type}) — ${BRUTE_FORCE_CONFIG.banDurationMs / 60000} dakika`);
    logToFirebase("BRUTE_FORCE_BAN", { ip, type, attempts: record.attempts });
  }

  bruteForceMap.set(key, record);
  checkSuspiciousActivity(ip, type);
}

export function recordSuccessfulAttempt(ip: string, type: string): void {
  bruteForceMap.delete(getBruteForceKey(ip, type));
}

function checkSuspiciousActivity(ip: string, type: string): void {
  const key = getBruteForceKey(ip, type);
  const record = bruteForceMap.get(key);
  if (record && record.attempts >= SUSPICIOUS_THRESHOLD) {
    logToFirebase("SUSPICIOUS_ACTIVITY", { ip, type, attempts: record.attempts });
  }
}

export function cleanupBruteForceData(): void {
  const now = Date.now();
  for (const [key, record] of bruteForceMap.entries()) {
    const expired = record.bannedUntil
      ? now > record.bannedUntil
      : now - record.firstAttempt > BRUTE_FORCE_CONFIG.windowMs;
    if (expired) bruteForceMap.delete(key);
  }

  for (const [ip, record] of rateLimitMap.entries()) {
    if (Date.now() - record.windowStart > RATE_LIMIT_CONFIG.windowMs) {
      rateLimitMap.delete(ip);
    }
  }
}

// Cleanup interval in main server
setInterval(cleanupBruteForceData, CLEANUP_INTERVAL);