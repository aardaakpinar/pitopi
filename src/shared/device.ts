import { LIMITS } from "../config/constants.js";

/**
 * Reduces a User-Agent header to a coarse "Browser on OS" label. Only this
 * label is stored (never the raw header, never the IP), which is enough for a
 * person to recognise their own devices in the session list.
 */
export function deviceLabel(userAgent: unknown): string {
  if (typeof userAgent !== "string" || !userAgent) return "Unknown device";
  const ua = userAgent.slice(0, 400);

  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return (os ? `${browser} on ${os}` : browser).slice(0, LIMITS.maxDeviceLabelChars);
}
