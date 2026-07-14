import express from "express";
import multer from "multer";
import crypto from "crypto";
import { promisify } from "util";
import { dbf } from "../config/firebase.js";
import { isRateLimited, isBanned, getRemainingBanTime, recordFailedAttempt, recordSuccessfulAttempt } from "./bruteForce.js";
import { logToFirebase } from "../utils/logging.js";

// ==================== AUTHENTICATION SYSTEM ====================

// ---- .key file format constants ----
// [ MAGIC (4B) | VERSION (1B) | TOKEN (64B) | SALT (32B) ]
const KEY_MAGIC = Buffer.from("AUTH", "ascii"); // 4 bytes
const KEY_VERSION = 0x01; // 1 byte
const TOKEN_SIZE = 64; // bytes
const SALT_SIZE = 32; // bytes
const HEADER_SIZE = KEY_MAGIC.length + 1; // magic + version
const KEY_FILE_SIZE = HEADER_SIZE + TOKEN_SIZE + SALT_SIZE; // total file size

// Offsets derived from the constants above (no hardcoded numbers)
const MAGIC_OFFSET = 0;
const VERSION_OFFSET = KEY_MAGIC.length;
const TOKEN_OFFSET = HEADER_SIZE;
const SALT_OFFSET = TOKEN_OFFSET + TOKEN_SIZE;

// ---- scrypt parameters ----
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 };
const scryptAsync = promisify(crypto.scrypt) as (
	password: crypto.BinaryLike,
	salt: crypto.BinaryLike,
	keylen: number,
	options: crypto.ScryptOptions
) => Promise<Buffer>;

// Multer's fileSize limit only bounds the raw upload; exact structural
// validation still happens in isValidKeyFile(). A little headroom here
// avoids false rejections from client-side multipart quirks.
const UPLOAD_SIZE_LIMIT = 256;

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: UPLOAD_SIZE_LIMIT },
});

/**
 * Derives the token hash used as the Firestore document id, using scrypt.
 * Runs off the main thread via the async scrypt API so it doesn't block
 * the event loop under load.
 */
async function deriveTokenHash(rawToken: Buffer, salt: Buffer): Promise<string> {
	const derived = await scryptAsync(rawToken, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
	return derived.toString("hex");
}

/**
 * Validates the structure of an uploaded .key file buffer:
 * exact size, magic bytes, and version byte.
 */
function isValidKeyFile(buffer: Buffer): boolean {
	if (buffer.length !== KEY_FILE_SIZE) return false;
	if (!crypto.timingSafeEqual(buffer.subarray(MAGIC_OFFSET, MAGIC_OFFSET + KEY_MAGIC.length), KEY_MAGIC)) return false;
	if (buffer[VERSION_OFFSET] !== KEY_VERSION) return false;
	return true;
}

// Signup - Generate .key token
export function setupAuthRoutes(app: express.Application) {
	app.get("/signup", async (req, res) => {
		const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

		if (isRateLimited(clientIp)) {
			await logToFirebase("RATE_LIMITED", {
				ip: clientIp,
				endpoint: "/signup",
			});
			return res.status(429).json({ error: "Çok fazla istek." });
		}

		let rawToken: Buffer;
		let salt: Buffer;
		let hash: string;

		// Regenerate token/salt in-place on the (astronomically rare) hash
		// collision, instead of round-tripping through a redirect.
		while (true) {
			rawToken = crypto.randomBytes(TOKEN_SIZE);
			salt = crypto.randomBytes(SALT_SIZE);
			hash = await deriveTokenHash(rawToken, salt);

			try {
				await dbf.collection("tokens").doc(hash).create({ createdAt: Date.now() });
				break;
			} catch (err: any) {
				if (err.code === 6) {
					console.warn("⚠️ Token hash collision, regenerating...");
					continue;
				}
				throw err;
			}
		}

		const version = Buffer.from([KEY_VERSION]);
		const buffer = Buffer.concat([KEY_MAGIC, version, rawToken, salt]); // KEY_FILE_SIZE bytes
		console.log("The buffer size sent:", buffer.length);

		res.setHeader("Content-Type", "application/octet-stream");
		res.setHeader("Content-Disposition", `attachment; filename="${Date.now()}.key"`);
		res.send(buffer);
	});

	// Login - Verify .key token and authenticate
	app.post("/login", upload.single("file"), async (req, res) => {
		const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

		if (isBanned(clientIp, "login")) {
			const remaining = getRemainingBanTime(clientIp, "login");
			return res.status(429).json({
				success: false,
				error: `${remaining} dakika sonra tekrar dene.`,
			});
		}

		if (isRateLimited(clientIp)) {
			await logToFirebase("RATE_LIMITED", { ip: clientIp, endpoint: "/login" });
			return res.status(429).json({ success: false, error: "Çok fazla istek." });
		}

		// Dosya tam olarak beklenen formatta değilse reddet — içeriği hiç işleme
		if (!req.file || !isValidKeyFile(req.file.buffer)) {
			recordFailedAttempt(clientIp, "login");
			return res.json({ success: false });
		}

		const rawToken = req.file.buffer.subarray(TOKEN_OFFSET, TOKEN_OFFSET + TOKEN_SIZE);
		const salt = req.file.buffer.subarray(SALT_OFFSET, SALT_OFFSET + SALT_SIZE);

		const hash = await deriveTokenHash(rawToken, salt);

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