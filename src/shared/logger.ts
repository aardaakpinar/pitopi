/** Strips control characters (log injection) and bounds the length. */
export function cleanForLog(value: unknown, max = 200): string {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .slice(0, max);
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (message, meta) => console.log(`[${new Date().toISOString()}] ${cleanForLog(message)}`, meta ?? ""),
  warn: (message, meta) => console.warn(`[${new Date().toISOString()}] ${cleanForLog(message)}`, meta ?? ""),
  error: (message, error) => {
    const detail = error instanceof Error ? error.message : error;
    console.error(`[${new Date().toISOString()}] ${cleanForLog(message)}`, cleanForLog(detail, 500));
  },
};
