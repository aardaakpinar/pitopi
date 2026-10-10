import crypto from "node:crypto";

export interface AppEnv {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  port: number;
  /** Number of reverse proxies in front of the app (0 = none). */
  trustProxyHops: number;
  /** Extra browser origins allowed for sockets/POSTs besides same-origin. */
  allowedOrigins: string[];
  firebaseDatabaseUrl: string;
  /** Secret used to derive pseudonymous ids. */
  serverSecret: Buffer;
}

const DEFAULT_DATABASE_URL =
  "https://pitopi-server-default-rtdb.europe-west1.firebasedatabase.app/";

function parseIntStrict(name: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const rawEnv = source.NODE_ENV;
  const nodeEnv = rawEnv === "production" || rawEnv === "test" ? rawEnv : "development";
  const isProduction = nodeEnv === "production";

  const port = source.PORT ? parseIntStrict("PORT", source.PORT, 1, 65535) : 3000;

  const trustProxyHops = source.TRUST_PROXY_HOPS
    ? parseIntStrict("TRUST_PROXY_HOPS", source.TRUST_PROXY_HOPS, 0, 5)
    : isProduction
      ? 1
      : 0;

  const allowedOrigins = (source.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);

  let serverSecret: Buffer;
  if (source.SERVER_SECRET && source.SERVER_SECRET.length >= 32) {
    serverSecret = Buffer.from(source.SERVER_SECRET, "utf8");
  } else if (isProduction) {
    throw new Error("SERVER_SECRET (min 32 chars) is required in production.");
  } else {
    console.warn("SERVER_SECRET not set; using an ephemeral secret (development only).");
    serverSecret = crypto.randomBytes(32);
  }

  return {
    nodeEnv,
    isProduction,
    port,
    trustProxyHops,
    allowedOrigins,
    firebaseDatabaseUrl: source.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL,
    serverSecret,
  };
}
