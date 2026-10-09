import type { Socket } from "socket.io";
import { SOCKET_BUCKETS, type BucketName } from "../../config/constants.js";
import { TokenBucket } from "../../application/rateLimiter.js";
import type { Logger } from "../../shared/logger.js";

export interface AuthedAccount {
  accountId: string;
  persistentUserId: string;
  sessionHash: string;
}

export interface SocketContext {
  socket: Socket;
  ip: string;
  account: AuthedAccount | null;
  authenticating: boolean;
}

export type Ack = (response: unknown) => void;

type Handler = (payload: unknown, ack: Ack | undefined) => void | Promise<void>;

/**
 * Wraps every socket event with the same defences:
 *  - per-socket token bucket (flooding / amplification)
 *  - authentication requirement
 *  - errors can never escape as uncaught exceptions / unhandled rejections
 *    (a malformed payload must not be able to crash the whole process)
 */
export function createEventRegistrar(ctx: SocketContext, logger: Logger) {
  const buckets = new Map<BucketName, TokenBucket>();
  let violations = 0;

  const bucketFor = (name: BucketName): TokenBucket => {
    let bucket = buckets.get(name);
    if (!bucket) {
      const cfg = SOCKET_BUCKETS[name];
      bucket = new TokenBucket(cfg.capacity, cfg.refillPerSec);
      buckets.set(name, bucket);
    }
    return bucket;
  };

  return function on(event: string, opts: { auth: boolean; bucket: BucketName }, handler: Handler): void {
    ctx.socket.on(event, (payload: unknown, maybeAck?: unknown) => {
      const ack = typeof maybeAck === "function" ? (maybeAck as Ack) : undefined;

      if (!bucketFor(opts.bucket).take()) {
        violations += 1;
        if (violations > 100) ctx.socket.disconnect(true);
        return;
      }
      if (opts.auth && !ctx.account) return;

      Promise.resolve()
        .then(() => handler(payload, ack))
        .catch((err) => logger.error(`Socket handler failed: ${event}`, err));
    });
  };
}

export type RegisterOn = ReturnType<typeof createEventRegistrar>;
