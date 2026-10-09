/*
 * Key file helpers shared by login.html and index.html.
 *
 *  - Optional password protection of the .key file. This happens entirely in
 *    the browser: the server only ever receives the plain 101-byte key file,
 *    so nothing on the server changes and the password never leaves the device.
 *  - Derivation of the local history keys (see historyStore.js).
 *
 * Protected file layout (150 bytes):
 *   MAGIC "AUTP" (4) | VERSION (1) | SALT (16) | IV (12) | AES-GCM(raw key file + 16-byte tag)
 */
const KeyFile = (() => {
	const RAW_SIZE = 101;
	const RAW_MAGIC = "AUTH";
	const PROTECTED_MAGIC = "AUTP";
	const VERSION = 1;
	const SALT_SIZE = 16;
	const IV_SIZE = 12;
	const HEADER_SIZE = 5;
	const PROTECTED_SIZE = HEADER_SIZE + SALT_SIZE + IV_SIZE + RAW_SIZE + 16;
	// OWASP 2023 guidance for PBKDF2-HMAC-SHA256.
	const PBKDF2_ITERATIONS = 600_000;

	const enc = new TextEncoder();

	function subtle() {
		const s = globalThis.crypto?.subtle;
		if (!s) throw new Error("secure_context_required");
		return s;
	}

	function magicOf(bytes) {
		return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
	}

	/** "raw" | "protected" | "invalid" */
	function kind(bytes) {
		if (bytes.length === RAW_SIZE && magicOf(bytes) === RAW_MAGIC) return "raw";
		if (bytes.length === PROTECTED_SIZE && magicOf(bytes) === PROTECTED_MAGIC) return "protected";
		return "invalid";
	}

	async function passwordKey(password, salt) {
		const base = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
		return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
	}

	async function protect(rawBytes, password) {
		if (kind(rawBytes) !== "raw") throw new Error("invalid_key_file");
		const header = new Uint8Array([...enc.encode(PROTECTED_MAGIC), VERSION]);
		const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
		const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
		const key = await passwordKey(password, salt);
		// The header is authenticated, so it cannot be swapped without detection.
		const body = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: header }, key, rawBytes));
		const out = new Uint8Array(PROTECTED_SIZE);
		out.set(header, 0);
		out.set(salt, HEADER_SIZE);
		out.set(iv, HEADER_SIZE + SALT_SIZE);
		out.set(body, HEADER_SIZE + SALT_SIZE + IV_SIZE);
		return out;
	}

	/** Throws "wrong_password" for a bad password or a tampered file. */
	async function unprotect(protectedBytes, password) {
		if (kind(protectedBytes) !== "protected") throw new Error("invalid_key_file");
		if (protectedBytes[4] !== VERSION) throw new Error("invalid_key_file");
		const header = protectedBytes.slice(0, HEADER_SIZE);
		const salt = protectedBytes.slice(HEADER_SIZE, HEADER_SIZE + SALT_SIZE);
		const iv = protectedBytes.slice(HEADER_SIZE + SALT_SIZE, HEADER_SIZE + SALT_SIZE + IV_SIZE);
		const body = protectedBytes.slice(HEADER_SIZE + SALT_SIZE + IV_SIZE);
		try {
			const key = await passwordKey(password, salt);
			return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv, additionalData: header }, key, body));
		} catch {
			throw new Error("wrong_password");
		}
	}

	/**
	 * Local history keys, derived from the plain key file with HKDF. They are
	 * non-extractable CryptoKeys, so even the page's own scripts cannot read the
	 * raw key bytes back. Two independent keys: one encrypts messages, one
	 * pseudonymises the per-contact index.
	 */
	async function deriveHistoryKeys(rawBytes) {
		if (kind(rawBytes) !== "raw") throw new Error("invalid_key_file");
		const base = await subtle().importKey("raw", rawBytes, "HKDF", false, ["deriveKey"]);
		const salt = enc.encode("pitopi-history-v1");
		const aes = await subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("messages") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
		const mac = await subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("contact-index") }, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
		return { aes, mac };
	}

	async function readFile(file) {
		return new Uint8Array(await file.arrayBuffer());
	}

	function download(bytes, filename) {
		const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	return { RAW_SIZE, PROTECTED_SIZE, kind, protect, unprotect, deriveHistoryKeys, readFile, download };
})();
