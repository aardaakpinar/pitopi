/*
 * Optional, device-local, encrypted chat history (IndexedDB).
 *
 *  - Nothing here ever reaches the server.
 *  - Message bodies are AES-GCM encrypted with a key derived from the key
 *    file (see KeyFile.deriveHistoryKeys). The key is stored as a
 *    non-extractable CryptoKey and removed on sign-out, which locks the data
 *    until the same key file is used to sign in again.
 *  - The per-contact index is an HMAC of the contact's pseudonymous id, so the
 *    raw database does not even reveal who you talked to.
 */
const HistoryStore = (() => {
	const DB_NAME = "pitopi-history";
	const DB_VERSION = 1;
	const MAX_LOAD = 300;
	const enc = new TextEncoder();
	const dec = new TextDecoder();

	let dbPromise = null;
	let keyCache = null;

	function open() {
		if (dbPromise) return dbPromise;
		dbPromise = new Promise((resolve, reject) => {
			if (!globalThis.indexedDB) {
				reject(new Error("indexeddb_unavailable"));
				return;
			}
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				db.createObjectStore("keys");
				db.createObjectStore("messages", { keyPath: "k" }).createIndex("peer", "peer");
				db.createObjectStore("peers", { keyPath: "tag" });
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		dbPromise.catch(() => {
			dbPromise = null;
		});
		return dbPromise;
	}

	function wrap(request) {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async function store(name, mode = "readonly") {
		const db = await open();
		return db.transaction(name, mode).objectStore(name);
	}

	// ---- keys ----
	async function saveKeys(keys) {
		keyCache = keys;
		await wrap((await store("keys", "readwrite")).put(keys, "history"));
	}

	async function loadKeys() {
		if (keyCache) return keyCache;
		try {
			const keys = await wrap((await store("keys")).get("history"));
			keyCache = keys?.aes && keys?.mac ? keys : null;
		} catch {
			keyCache = null;
		}
		return keyCache;
	}

	async function clearKeys() {
		keyCache = null;
		try {
			await wrap((await store("keys", "readwrite")).delete("history"));
		} catch {
			// Nothing to clear.
		}
	}

	async function isUnlocked() {
		return Boolean(await loadKeys());
	}

	// ---- crypto helpers ----
	const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

	async function requireKeys() {
		const keys = await loadKeys();
		if (!keys) throw new Error("history_locked");
		return keys;
	}

	async function peerTag(peerId) {
		const { mac } = await requireKeys();
		return toHex(await crypto.subtle.sign("HMAC", mac, enc.encode(`peer:${peerId}`))).slice(0, 32);
	}

	async function seal(value, aad) {
		const { aes } = await requireKeys();
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, aes, enc.encode(JSON.stringify(value)));
		return { iv, ct };
	}

	async function open_(record, aad) {
		const { aes } = await requireKeys();
		const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: enc.encode(aad) }, aes, record.ct);
		return JSON.parse(dec.decode(plain));
	}

	// ---- messages ----
	// Writes are read-modify-write; run them one after another so two quick
	// updates to the same message (e.g. a reaction then an edit) can't clobber each other.
	let writeChain = Promise.resolve();
	function serial(task) {
		const run = writeChain.then(task, task);
		writeChain = run.catch(() => {});
		return run;
	}

	async function putMessage(peerId, message) {
		const tag = await peerTag(peerId);
		const k = `${tag}:${message.id}`;
		const sealed = await seal(message, k);
		await wrap((await store("messages", "readwrite")).put({ k, peer: tag, ...sealed }));
	}

	function saveMessage(peerId, message, peerName) {
		return serial(async () => {
			await putMessage(peerId, message);
			if (peerName) await savePeer(peerId, peerName, message.ts);
		});
	}

	async function getMessage(peerId, id) {
		const tag = await peerTag(peerId);
		const k = `${tag}:${id}`;
		const record = await wrap((await store("messages")).get(k));
		return record ? open_(record, k) : null;
	}

	function updateMessage(peerId, id, patch) {
		return serial(async () => {
			const current = await getMessage(peerId, id);
			if (!current) return;
			await putMessage(peerId, { ...current, ...patch });
		});
	}

	function deleteMessage(peerId, id) {
		return serial(async () => {
			const tag = await peerTag(peerId);
			await wrap((await store("messages", "readwrite")).delete(`${tag}:${id}`));
		});
	}

	/** Oldest-first, limited to the most recent MAX_LOAD messages. */
	async function loadMessages(peerId) {
		const tag = await peerTag(peerId);
		const records = await wrap((await store("messages")).index("peer").getAll(tag));
		const out = [];
		for (const record of records) {
			try {
				out.push(await open_(record, record.k));
			} catch {
				// Undecryptable (different key file): skip, never crash the chat.
			}
		}
		out.sort((a, b) => a.ts - b.ts);
		return out.slice(-MAX_LOAD);
	}

	// ---- contacts ----
	async function savePeer(peerId, username, ts = Date.now()) {
		const tag = await peerTag(peerId);
		const sealed = await seal({ id: peerId, username, ts }, `peer:${tag}`);
		await wrap((await store("peers", "readwrite")).put({ tag, ...sealed }));
	}

	/** [{ id, username, ts }] most recent first. */
	async function listPeers() {
		const keys = await loadKeys();
		if (!keys) return [];
		const records = await wrap((await store("peers")).getAll());
		const out = [];
		for (const record of records) {
			try {
				out.push(await open_(record, `peer:${record.tag}`));
			} catch {
				// Belongs to another key file.
			}
		}
		return out.sort((a, b) => b.ts - a.ts);
	}

	async function deletePeer(peerId) {
		const tag = await peerTag(peerId);
		const db = await open();
		const tx = db.transaction(["messages", "peers"], "readwrite");
		const messages = tx.objectStore("messages");
		const keys = await wrap(messages.index("peer").getAllKeys(tag));
		keys.forEach((key) => messages.delete(key));
		tx.objectStore("peers").delete(tag);
		await new Promise((resolve, reject) => {
			tx.oncomplete = resolve;
			tx.onerror = () => reject(tx.error);
		});
	}

	/** Deletes everything, including the keys. */
	async function wipe() {
		keyCache = null;
		try {
			(await open()).close();
		} catch {
			// Not opened yet.
		}
		dbPromise = null;
		await new Promise((resolve) => {
			if (!globalThis.indexedDB) return resolve();
			const req = indexedDB.deleteDatabase(DB_NAME);
			req.onsuccess = req.onerror = req.onblocked = () => resolve();
		});
	}

	/** Deletes saved messages and contacts but keeps the keys (history stays unlockable). */
	async function clearData() {
		const db = await open();
		const tx = db.transaction(["messages", "peers"], "readwrite");
		tx.objectStore("messages").clear();
		tx.objectStore("peers").clear();
		await new Promise((resolve, reject) => {
			tx.oncomplete = resolve;
			tx.onerror = () => reject(tx.error);
		});
	}

	return { saveKeys, loadKeys, clearKeys, isUnlocked, saveMessage, updateMessage, deleteMessage, loadMessages, savePeer, listPeers, deletePeer, clearData, wipe };
})();
