import net from "node:net";

function normalise(ip: string | undefined): string {
  if (!ip) return "unknown";
  const stripped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return net.isIP(stripped) ? stripped : "unknown";
}

/**
 * Resolves the real client address. X-Forwarded-For is attacker-controlled
 * except for the entries appended by proxies we operate, so with N trusted
 * hops the client is the Nth entry from the right. With 0 hops the header is
 * ignored entirely.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedHops: number,
): string {
  const direct = normalise(remoteAddress);
  if (trustedHops <= 0 || !forwardedFor) return direct;

  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  const candidate = parts[parts.length - trustedHops];
  const resolved = normalise(candidate);
  return resolved === "unknown" ? direct : resolved;
}
