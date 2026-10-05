import type { ErrorRequestHandler } from "express";
import { ERROR_CODES } from "../../../config/constants.js";
import type { Logger } from "../../../shared/logger.js";

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) return next(err);

    const code = (err as { code?: string })?.code;
    if (code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ success: false, error: ERROR_CODES.FILE_TOO_LARGE });
      return;
    }
    if ((err as { name?: string })?.name === "MulterError") {
      res.status(400).json({ success: false });
      return;
    }

    // Never leak stack traces or internals to the client.
    logger.error("Unhandled HTTP error", err);
    res.status(500).json({ success: false, error: ERROR_CODES.SERVER_ERROR });
  };
}
