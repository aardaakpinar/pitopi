import type { Clock } from "./ports.js";

function evictOldest<K, V>(map: Map<K, V>): void {
  const first = map.keys().next();
  if (!first.done) map.delete(first.value);
}

/** Fixed-window counter keyed by an arbitrary string (usually an IP). */
export class FixedWindowLimiter {
  private readonly entries = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
    private readonly now: Clock = Date.now,
  ) {}

  /** Counts one request. `count` lets callers log only the first overflow. */
  consume(key: string): { allowed: boolean; count: number } {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStart > this.windowMs) {
      if (!entry && this.entries.size >= this.maxKeys) evictOldest(this.entries);
      entry = { count: 0, windowStart: now };
    }
    entry.count += 1;
    this.entries.set(key, entry);
    return { allowed: entry.count <= this.max, count: entry.count };
  }

  purge(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStart > this.windowMs) this.entries.delete(key);
    }
  }
}

export interface BruteForceConfig {
  maxAttempts: number;
  windowMs: number;
  banDurationMs: number;
}

interface BruteForceRecord {
  attempts: number;
  firstAttempt: number;
  bannedUntil?: number;
}

/** Counts failed attempts per (ip, type) and bans after too many. */
export class BruteForceGuard {
  private readonly records = new Map<string, BruteForceRecord>();

  constructor(
    private readonly config: BruteForceConfig,
    private readonly onBan?: (ip: string, type: string, attempts: number) => void,
    private readonly maxKeys = 50_000,
    private readonly now: Clock = Date.now,
  ) {}

  private key(ip: string, type: string): string {
    return `${ip}:${type}`;
  }

  isBanned(ip: string, type: string): boolean {
    const key = this.key(ip, type);
    const record = this.records.get(key);
    if (!record?.bannedUntil) return false;
    if (this.now() > record.bannedUntil) {
      this.records.delete(key);
      return false;
    }
    return true;
  }

  remainingMinutes(ip: string, type: string): number {
    const record = this.records.get(this.key(ip, type));
    if (!record?.bannedUntil) return 0;
    return Math.max(1, Math.ceil((record.bannedUntil - this.now()) / 60_000));
  }

  recordFailure(ip: string, type: string): void {
    const key = this.key(ip, type);
    const now = this.now();
    let record = this.records.get(key);
    if (!record || (!record.bannedUntil && now - record.firstAttempt > this.config.windowMs)) {
      if (!record && this.records.size >= this.maxKeys) evictOldest(this.records);
      record = { attempts: 0, firstAttempt: now };
    }
    record.attempts += 1;
    if (record.attempts >= this.config.maxAttempts && !record.bannedUntil) {
      record.bannedUntil = now + this.config.banDurationMs;
      this.onBan?.(ip, type, record.attempts);
    }
    this.records.set(key, record);
  }

  recordSuccess(ip: string, type: string): void {
    this.records.delete(this.key(ip, type));
  }

  purge(): void {
    const now = this.now();
    for (const [key, record] of this.records) {
      const expired = record.bannedUntil
        ? now > record.bannedUntil
        : now - record.firstAttempt > this.config.windowMs;
      if (expired) this.records.delete(key);
    }
  }
}

/** Per-socket event budget: `capacity` burst, refilled continuously. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: Clock = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1): boolean {
    const now = this.now();
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
