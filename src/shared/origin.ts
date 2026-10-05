/** True when the browser Origin is same-origin with Host or explicitly allowed. */
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return true; // non-browser clients (and same-origin GETs) send none
  try {
    const parsed = new URL(origin);
    if (allowedOrigins.includes(parsed.origin)) return true;
    return Boolean(host) && parsed.host === host;
  } catch {
    return false;
  }
}
