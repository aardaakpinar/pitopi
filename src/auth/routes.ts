import express from "express";
import multer from "multer";
import crypto from "crypto";
import { dbf } from "../config/firebase.js";
import { isRateLimited, isBanned, getRemainingBanTime, recordFailedAttempt, recordSuccessfulAttempt } from "./bruteForce.js";
import { logToFirebase } from "../utils/logging.js";

// ==================== AUTHENTICATION SYSTEM ====================
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 } });

// Signup - Generate .key token
export function setupAuthRoutes(app: express.Application) {
  app.get("/signup", async (req, res) => {
    const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

    if (isRateLimited(clientIp)) {
      await logToFirebase("RATE_LIMITED", { ip: clientIp, endpoint: "/signup" });
      return res.status(429).json({ error: "Çok fazla istek." });
    }

    const rawToken = crypto.randomBytes(64);
    const salt = crypto.randomBytes(32);

    const hash = crypto
      .createHash("sha256")
      .update(rawToken)
      .update(salt)
      .digest("hex");

    try {
      await dbf.collection("tokens").doc(hash).create({ createdAt: Date.now() });
    } catch (err: any) {
      if (err.code === 6) {
        console.warn("⚠️ Token hash collision, regenerating...");
        return res.redirect("/signup");
      }
      throw err;
    }

    const buffer = Buffer.concat([rawToken, salt]); // 96 byte
    console.log("Gönderilen buffer boyutu:", buffer.length);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${Date.now()}.key"`);
    res.send(buffer);
  });

  // Login - Verify .key token and authenticate
  app.post("/login", upload.single("file"), async (req, res) => {
    const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

    if (isBanned(clientIp, "login")) {
      const remaining = getRemainingBanTime(clientIp, "login");
      return res.status(429).json({ success: false, error: `${remaining} dakika sonra tekrar dene.` });
    }

    if (isRateLimited(clientIp)) {
      await logToFirebase("RATE_LIMITED", { ip: clientIp, endpoint: "/login" });
      return res.status(429).json({ success: false, error: "Çok fazla istek." });
    }

    // Tam 96 byte değilse reddet — içeriği hiç okuma
    if (!req.file || req.file.size !== 96) {
      recordFailedAttempt(clientIp, "login");
      return res.json({ success: false });
    }

    const rawToken = req.file.buffer.subarray(0, 64);
    const salt = req.file.buffer.subarray(64, 96);

    const hash = crypto
      .createHash("sha256")
      .update(rawToken)
      .update(salt)
      .digest("hex");

    const tokenDoc = await dbf.collection("tokens").doc(hash).get();
    if (!tokenDoc.exists) {
      recordFailedAttempt(clientIp, "login");
      return res.json({ success: false });
    }

    const userRef = dbf.collection("users").doc(hash);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({
        id: hash,
        username: "user_" + hash.slice(0, 4),
        createdAt: Date.now(),
        profilePic: null,
        hidden: false,
      });
    }

    recordSuccessfulAttempt(clientIp, "login");

    const userData = (await userRef.get()).data();

    // Login logunda userId + username birlikte
    await logToFirebase("LOGIN", {
      userId: hash,
      username: userData?.username ?? null,
      ip: clientIp,
    });

    res.json({
      success: true,
      userId: hash,
      user: userData,
    });
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, error: "Dosya çok büyük." });
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, error: "Sunucu hatası." });
  });
}