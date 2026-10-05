import express, { type Express } from "express";
import path from "node:path";
import type { AppEnv } from "../../config/env.js";
import type { Logger } from "../../shared/logger.js";
import { createErrorHandler } from "./middleware/errorHandler.js";
import { securityHeaders } from "./middleware/security.js";
import { createAuthRouter, type AuthRouteDeps } from "./routes/authRoutes.js";

export interface AppDeps {
  env: AppEnv;
  logger: Logger;
  staticDir: string;
  auth: Omit<AuthRouteDeps, "trustProxyHops" | "allowedOrigins">;
}

export function createApp({ env, logger, staticDir, auth }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxyHops);

  app.use(...securityHeaders(env.isProduction));

  app.use(
    createAuthRouter({ ...auth, trustProxyHops: env.trustProxyHops, allowedOrigins: env.allowedOrigins }),
  );

  app.use(
    express.static(staticDir, {
      dotfiles: "ignore",
      index: false,
      setHeaders(res, filePath) {
        // The service worker and HTML must always be revalidated.
        if (filePath.endsWith("sw.js") || filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.get("/", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));

  app.use(createErrorHandler(logger));
  return app;
}
