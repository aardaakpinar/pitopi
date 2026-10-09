import type { NextFunction, Request, RequestHandler, Response } from "express";
import helmet from "helmet";
import { ERROR_CODES } from "../../../config/constants.js";
import { isOriginAllowed } from "../../../shared/origin.js";

export function securityHeaders(isProduction: boolean): RequestHandler[] {
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // No inline scripts or inline event handlers anywhere in the app.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://img.icons8.com"],
        mediaSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  });

  const permissions: RequestHandler = (_req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
    next();
  };

  return [helmetMiddleware, permissions];
}

/** Rejects state-changing requests that a foreign website triggered. */
export function requireTrustedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isOriginAllowed(req.headers.origin, req.headers.host, allowedOrigins)) return next();
    res.status(403).json({ success: false, error: ERROR_CODES.FORBIDDEN_ORIGIN });
  };
}

export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
