/*
 * 1. Configuration Constants
 */
const STORAGE_KEYS = {
	SESSION: "pitopi_session",
	LEGACY_USER_ID: "pitopi_user_id",
	PROFILE_PIC: "p2p_pp_base64",
	HIDDEN: "p2p_hidden",
	REMOTE_ID: "p2p_remote_id",
	CONNECTION_STATUS: "p2p_connection_status",
	HISTORY: "pp_history",
	RECEIPTS: "pp_receipts",
	BLUR: "pp_blur",
};

const CONNECTION_STATES = {
	CONNECTED: "connected",
	CONNECTING: "connecting",
	DISCONNECTED: "disconnected",
	FALLBACK: "socket-fallback",
	ANSWERING: "answering",
	REJECTED: "rejected",
};

const DEFAULT_PROFILE_PIC = "assets/img/boringavatar.svg";
const STORY_DURATION = {
	IMAGE: 4000,
};

// Keep in sync with the server limits (src/config/constants.ts).
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_STORY_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 4000;
const FILE_CHUNK_SIZE = 16000;
const MAX_FILE_CHUNKS = Math.ceil(((MAX_FILE_BYTES * 4) / 3 + 512) / FILE_CHUNK_SIZE);
const ALLOWED_UPLOAD_IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/*
 * 2. Session Setup and Socket Init
 */
localStorage.removeItem(STORAGE_KEYS.LEGACY_USER_ID);
const sessionToken = localStorage.getItem(STORAGE_KEYS.SESSION);
if (!sessionToken) window.location.href = "login.html";

// Same-origin connection; the client script itself is served by the server
// (/socket.io/socket.io.js) so its version always matches.
const socket = io({ transports: ["websocket"] });

/*
 * 3. Global State
 */
const state = {
	isDisconnecting: false,
	connectionStatus: false,
	remoteId: sessionStorage.getItem(STORAGE_KEYS.REMOTE_ID) || null,
	myId: null,
	myPersistentId: null,
	myUsername: null,
	myProfilePic: null,
	allUsers: [],
	hiddenFromSearch: localStorage.getItem(STORAGE_KEYS.HIDDEN) === "true",
	currentStories: {},
	currentStoryIndex: 0,
	currentUserStories: [],
	storyTimer: null,
	currentView: "home",
	selectedUser: null,
	activeChat: null,
	activeFilter: "all",
	chats: [],
	messages: {},
	isConnected: null,
	socketChatTimer: null,
	settings: loadSettings(),
	// Contacts with saved (encrypted, local) history; refreshed from HistoryStore.
	savedPeers: [],
	// Composer context: { id, text } for a reply, or the message being edited.
	replyTo: null,
	editing: null,
	// Disappearing-message lifetime in seconds (0 = off), shared with the peer.
	ttl: 0,
	// Incoming message ids whose delivery/read receipts are still owed: id -> "new" | "delivered".
	receiptQueue: new Map(),
	crypto: {
		localKeyPair: null,
		localPublicKey: null,
		remotePublicKey: null,
		sharedKey: null,
		safetyShown: false,
		safetyCode: null,
	},
};

const receivingFile = {
	meta: null,
	chunks: [],
	received: 0,
};

/*
 * 4. DOM Elements
 */
const elements = {
	get TabChat() {
		return document.getElementById("TabChat");
	},
	get TabStory() {
		return document.getElementById("TabStory");
	},
	get TabSetting() {
		return document.getElementById("TabSetting");
	},
	get chatsList() {
		return document.getElementById("chats-list");
	},
	get chatPanel() {
		return document.getElementById("chat-panel");
	},
	get noChatPlaceholder() {
		return document.getElementById("no-chat-placeholder");
	},
	get chatContent() {
		return document.getElementById("chat-content");
	},
	get chatName() {
		return document.getElementById("chat-name");
	},
	get chatAvatar() {
		return document.getElementById("chat-avatar");
	},
	get chatStatus() {
		return document.getElementById("chat-status");
	},
	get messagesContainer() {
		return document.getElementById("messages-container");
	},
	get messageInput() {
		return document.getElementById("message-input");
	},
	get sendMessageBtn() {
		return document.getElementById("send-message");
	},
	get backToChatBtn() {
		return document.getElementById("back-to-chats");
	},
	get searchInput() {
		return document.getElementById("searchId");
	},
	get storyInput() {
		return document.getElementById("storyInput");
	},
	get uploadAvatarInput() {
		return document.getElementById("uploadAvatarInput");
	},
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/*
 * 5. Initialization
 */
let appInitialized = false;
function initApp() {
	if (appInitialized) return;
	appInitialized = true;
	setupEventListeners();
	initUIEventListeners();
	initFileUpload();
	initMessaging();
}

function initFileUpload() {
	const fileInput = document.getElementById("fileInput");
	if (!fileInput) return;

	fileInput.addEventListener("change", async () => {
		let file = fileInput.files[0];
		if (!file) return;

		if (file.size > MAX_FILE_BYTES) {
			showToast(t("file_limit"));
			fileInput.value = "";
			return;
		}

		// Resim ise metadata temizle (only raster formats the canvas can re-encode)
		if (SAFE_IMAGE_TYPES.includes(file.type)) {
			try {
				file = await removeImageMetadata(file);
			} catch (err) {
				console.error("Metadata temizlenemedi:", err);
			}
		}

		const reader = new FileReader();

		reader.onload = async () => {
			const base64Data = reader.result;

			const fileMeta = {
				type: "file",
				id: Msgs.newId(),
				name: file.name,
				size: file.size,
				mimeType: file.type,
				data: base64Data,
			};

			try {
				await sendFileInChunks(fileMeta);
				renderFilePreview(fileMeta, "me", fileMeta.id, { ttl: state.ttl });
				fileInput.value = "";
			} catch (error) {
				console.error("File send error:", error);
				showSystemMessage(t("file_send_failed"));
			}
		};

		reader.readAsDataURL(file);
	});
}

async function removeImageMetadata(file) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);

		img.onload = () => {
			URL.revokeObjectURL(url);

			const canvas = document.createElement("canvas");
			canvas.width = img.width;
			canvas.height = img.height;

			const ctx = canvas.getContext("2d");
			ctx.drawImage(img, 0, 0);

			canvas.toBlob(
				(blob) => {
					if (!blob) {
						reject(new Error("Canvas context unavailable"));
						return;
					}

					resolve(
						new File([blob], file.name, {
							type: file.type,
							lastModified: Date.now(),
						}),
					);
				},
				file.type,
				0.95,
			);
		};

		img.onerror = (err) => {
			URL.revokeObjectURL(url);
			reject(err);
		};

		img.src = url;
	});
}

async function sendFileInChunks(fileMeta) {
	const chunkSize = FILE_CHUNK_SIZE;
	const { name, mimeType, data } = fileMeta;
	const totalChunks = Math.ceil(data.length / chunkSize);

	await sendSecurePayload({ type: "file-meta", id: fileMeta.id, name, mimeType, totalChunks, ttl: state.ttl });

	for (let i = 0; i < totalChunks; i++) {
		const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
		await sendSecurePayload({ type: "file-chunk", index: i, chunk });
		// Stay under the server's relay budget (~200 chunks/s) so no chunk is dropped.
		if (i % 50 === 49) await new Promise((resolve) => setTimeout(resolve, 300));
	}
}

function setupEventListeners() {
	if (elements.sendMessageBtn) {
		elements.sendMessageBtn.addEventListener("click", sendMessage);
	}

	if (elements.messageInput) {
		elements.messageInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});
	}

	if (elements.backToChatBtn) {
		elements.backToChatBtn.addEventListener("click", () => {
			elements.chatPanel.classList.remove("mobile-chat-open");
			elements.chatPanel.classList.add("mobile-chat-closed");
		});
	}

	if (elements.searchInput) {
		elements.searchInput.addEventListener("input", (e) => {
			searchInCurrentTab(e.target.value.trim().toLowerCase());
		});
	}
}

function initUIEventListeners() {
	let typingTimeout;
	if (elements.messageInput) {
		elements.messageInput.addEventListener("input", () => {
			if (state.connectionStatus) {
				sendSecurePayload({ type: "typing" }).catch(() => {});
			}
			clearTimeout(typingTimeout);
			typingTimeout = setTimeout(() => {
				if (state.connectionStatus) {
					sendSecurePayload({ type: "stop-typing" }).catch(() => {});
				}
			}, 2000);
		});
	}
}

function initStoryFunctionality() {
	if (elements.storyInput) elements.storyInput.addEventListener("change", handleStoryUpload);
}

function initProfilePictureUpload() {
	if (elements.uploadAvatarInput) elements.uploadAvatarInput.addEventListener("change", handleProfilePictureUpload);
}

/*
 * 6. UI Render Functions
 */
function getRandomMessage(key) {
	const arr = tList(key);
	return arr.length ? arr[Math.floor(Math.random() * arr.length)] : key;
}

function getFileIconClass(fileName = "", mimeType = "") {
	const ext = fileName.split(".").pop().toLowerCase();
	const map = {
		pdf: "fa-file-pdf",
		doc: "fa-file-word",
		docx: "fa-file-word",
		xls: "fa-file-excel",
		xlsx: "fa-file-excel",
		csv: "fa-file-csv",
		ppt: "fa-file-powerpoint",
		pptx: "fa-file-powerpoint",
		zip: "fa-file-zipper",
		rar: "fa-file-zipper",
		txt: "fa-file-lines",
		js: "fa-file-code",
		html: "fa-file-code",
		css: "fa-file-code",
		json: "fa-file-code",
	};
	return map[ext] || "fa-file";
}

const SAFE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"];

const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

// Only same-origin assets or raster data: URLs may ever reach an <img src>.
// Anything else (remote URLs, javascript:, svg) falls back to the default.
function safeImageSrc(value) {
	return typeof value === "string" && AVATAR_DATA_URL.test(value) ? value : DEFAULT_PROFILE_PIC;
}

function dataUrlMime(value) {
	const match = /^data:([^;,]+)[;,]/i.exec(value);
	return match ? match[1].toLowerCase() : "";
}

function isDataUrl(value) {
	return typeof value === "string" && /^data:[\w.+-]+\/[\w.+-]+(;[\w=.+-]+)*(;base64)?,/i.test(value);
}

function sanitizeFileName(name) {
	return String(name || "file").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 128) || "file";
}

function renderFilePreview(fileMeta, from, id = Msgs.newId(), extra = {}) {
	const name = sanitizeFileName(fileMeta.name);
	const data = fileMeta.data;
	// The data URL's own MIME type is authoritative; the peer-claimed one is ignored.
	const mimeType = isDataUrl(data) ? dataUrlMime(data) : "";

	// Peer-supplied data is never interpolated into HTML; only DOM APIs are used.
	if (!isDataUrl(data)) {
		addMessageContent(name, from, id, extra, name);
		return;
	}

	let node;
	if (SAFE_IMAGE_TYPES.includes(mimeType)) {
		node = document.createElement("img");
		node.src = data;
		node.alt = name;
		node.className = "pp-image";
	} else if (mimeType.startsWith("audio/")) {
		node = document.createElement("audio");
		node.controls = true;
		node.src = data;
		node.className = "pp-audio";
	} else {
		node = document.createElement("div");
		node.className = "pp-file";

		const iconWrap = ppEl("div", "pp-file-icon");
		iconWrap.appendChild(ppIcon(getFileIconClass(name, mimeType)));

		const info = ppEl("div", "pp-file-info");
		const title = ppEl("p", "pp-file-name", name);
		const link = ppEl("a", "pp-link", t("download_file"));
		link.href = data;
		link.download = name;
		link.rel = "noopener noreferrer";
		info.append(title, link);

		node.append(iconWrap, info);
	}
	addMessageContent(node, from, id, extra, name);
}

// Shows a message and, when local history is on, stores it (encrypted).
function addMessageContent(content, from, id, extra = {}, fileName) {
	const isNode = content instanceof Node;
	const entry = Msgs.add({
		id,
		from,
		text: isNode ? "" : content,
		node: isNode ? content : null,
		ttl: extra.ttl || 0,
		replyTo: extra.replyTo || null,
	});
	if (!entry) return null;
	persistMessage(entry, isNode || fileName ? "file" : "text", fileName);
	return entry;
}

function setAvatar(container, src, alt) {
	if (!container) return;
	const img = document.createElement("img");
	img.src = safeImageSrc(src);
	img.alt = alt || "";
	container.replaceChildren(img);
}

function bytesToBase64(bytes) {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

function base64ToBytes(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function resetSessionCrypto() {
	state.crypto.localKeyPair = null;
	state.crypto.localPublicKey = null;
	state.crypto.remotePublicKey = null;
	state.crypto.sharedKey = null;
	state.crypto.safetyShown = false;
	state.crypto.safetyCode = null;
}

// Safety number: a short code derived from BOTH public keys. If a server (or
// anyone in the middle) swapped keys, the two users would see different codes
// when they compare them over another channel (in person, phone call, ...).
async function computeSafetyNumber() {
	const { localPublicKey, remotePublicKey } = state.crypto;
	if (!localPublicKey || !remotePublicKey) return null;

	// Sorted, so both sides hash the same input regardless of who called whom.
	const [a, b] = [localPublicKey, remotePublicKey].sort();
	const input = new Uint8Array([...base64ToBytes(a), ...base64ToBytes(b)]);
	const digest = new Uint8Array(await getWebCrypto().subtle.digest("SHA-256", input));

	const groups = [];
	for (let i = 0; i < 6; i++) {
		const n = ((digest[i * 4] << 24) | (digest[i * 4 + 1] << 16) | (digest[i * 4 + 2] << 8) | digest[i * 4 + 3]) >>> 0;
		groups.push(String(n % 100000).padStart(5, "0"));
	}
	return groups.join(" ");
}

// The code is no longer dumped into the conversation; it lives in the chat menu.
async function showSafetyNumber() {
	if (state.crypto.safetyShown) return;
	state.crypto.safetyShown = true;
	try {
		state.crypto.safetyCode = await computeSafetyNumber();
	} catch (error) {
		console.error("Safety number error:", error);
	}
}

function getWebCrypto() {
	const webCrypto = globalThis.crypto;
	if (!webCrypto?.subtle) {
		throw new Error("E2E encryption requires HTTPS or localhost. Open Pitopi over HTTPS, or use http://localhost during development.");
	}
	return webCrypto;
}

async function prepareLocalCrypto() {
	const webCrypto = getWebCrypto();
	state.crypto.localKeyPair = await webCrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
	const publicKey = await webCrypto.subtle.exportKey("raw", state.crypto.localKeyPair.publicKey);
	state.crypto.localPublicKey = bytesToBase64(new Uint8Array(publicKey));
	return state.crypto.localPublicKey;
}

async function deriveSharedKey(remotePublicKey) {
	const webCrypto = getWebCrypto();
	if (!state.crypto.localKeyPair) await prepareLocalCrypto();
	state.crypto.remotePublicKey = remotePublicKey;
	const importedRemoteKey = await webCrypto.subtle.importKey("raw", base64ToBytes(remotePublicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
	state.crypto.sharedKey = await webCrypto.subtle.deriveKey({ name: "ECDH", public: importedRemoteKey }, state.crypto.localKeyPair.privateKey, { name: "AES-GCM", length: 256 }, false, [
		"encrypt",
		"decrypt",
	]);
	if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = false;
}

async function encryptPayload(payload) {
	const webCrypto = getWebCrypto();
	if (!state.crypto.sharedKey) throw new Error("Encryption key is not ready");
	const iv = webCrypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await webCrypto.subtle.encrypt({ name: "AES-GCM", iv }, state.crypto.sharedKey, textEncoder.encode(JSON.stringify(payload)));
	return {
		type: "encrypted",
		version: 1,
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
	};
}

async function decryptEnvelope(envelope) {
	const webCrypto = getWebCrypto();
	if (!state.crypto.sharedKey) throw new Error("Encryption key is not ready");
	const plaintext = await webCrypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv) }, state.crypto.sharedKey, base64ToBytes(envelope.ciphertext));
	return JSON.parse(textDecoder.decode(plaintext));
}

async function sendSecurePayload(payload) {
	const envelope = await encryptPayload(payload);

	if (state.remoteId && socket.connected) {
		socket.emit("relay-message", { targetId: state.remoteId, envelope });
		return;
	}

	throw new Error("No active message channel");
}

function clearSocketChatTimer() {
	if (!state.socketChatTimer) return;
	clearTimeout(state.socketChatTimer);
	state.socketChatTimer = null;
}

function activateEncryptedRelay() {
	clearSocketChatTimer();
	updateStatus(CONNECTION_STATES.FALLBACK);
	state.connectionStatus = true;
	if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = false;
	if (elements.chatStatus) elements.chatStatus.textContent = t("status_encrypted");
	showSafetyNumber();
}

/*
 * 7. Navigation and Button Logic
 */
let activeTabId = "btnChats";

const sidebarButtons = [
	{ id: "btnChats", action: renderChats },
	{ id: "btnStorys", action: renderStorys },
	{ id: "btnSettings", action: renderSettings },
];

function activateButton(buttonList, activeId) {
	buttonList.forEach(({ id }) => {
		document.getElementById(id)?.classList.toggle("is-active", id === activeId);
	});
}

sidebarButtons.forEach(({ id, action }) => {
	document.getElementById(id)?.addEventListener("click", () => {
		activeTabId = id;
		activateButton(sidebarButtons, id);
		action();
	});
});

const mobileButtons = [
	{ id: "mobBtnChats", action: renderChats },
	{ id: "mobBtnStorys", action: renderStorys },
	{ id: "mobBtnSettings", action: renderSettings },
];

mobileButtons.forEach(({ id, action }) => {
	document.getElementById(id)?.addEventListener("click", () => {
		activeTabId = id;
		activateButton(mobileButtons, id);
		action();
	});
});

/*
 * 8. Media Upload Handlers
 */
function handleProfilePictureUpload() {
	const file = elements.uploadAvatarInput.files[0];
	if (!file || !ALLOWED_UPLOAD_IMAGES.includes(file.type)) {
		showToast(t("image_file_valid"));
		return;
	}

	const img = new Image();
	const objectUrl = URL.createObjectURL(file);
	img.onload = () => {
		const MAX = 256;
		let { width, height } = img;
		if (width > height) {
			height = Math.round((height * MAX) / width);
			width = MAX;
		} else {
			width = Math.round((width * MAX) / height);
			height = MAX;
		}

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		canvas.getContext("2d").drawImage(img, 0, 0, width, height);

		const base64Image = canvas.toDataURL("image/jpeg", 0.7);
		URL.revokeObjectURL(objectUrl);

		localStorage.setItem(STORAGE_KEYS.PROFILE_PIC, base64Image);
		document.querySelector("#btnSettings img").src = base64Image;
		document.querySelector("#mobBtnSettings img").src = base64Image;
		showToast(t("pp_update"));
		socket.emit("update-profile-pic", base64Image);
	};
	img.src = objectUrl;
}

async function handleStoryUpload() {
	const file = elements.storyInput.files[0];
	if (!file) return;
	if (!ALLOWED_UPLOAD_IMAGES.includes(file.type)) {
		showToast(t("image_file_valid"));
		elements.storyInput.value = "";
		return;
	}
	if (file.size > MAX_STORY_BYTES) {
		showToast(t("story_file_limit"));
		elements.storyInput.value = "";
		return;
	}

	// Ask who may see it before anything leaves the device.
	const audience = await chooseStoryAudience();
	if (!audience) {
		elements.storyInput.value = "";
		return;
	}

	const reader = new FileReader();
	reader.onload = () => {
		socket.emit("upload-story", { data: reader.result, type: "image", caption: "", visibility: audience.visibility, audience: audience.audience }, (res) => {
			showToast(res?.ok ? t("story_upload") : t(res?.reason === "limit" ? "story_limit" : "story_upload_failed"));
		});
		elements.storyInput.value = "";
	};
	reader.readAsDataURL(file);
}

/*
 * 9. View Logic
 */
function renderChats() {
	renderChatsList();
	showOnlyTab(TabChat);
}
function renderStorys() {
	renderStoriesList();
	showOnlyTab(TabStory);
}
function renderSettings() {
	renderSettingsList();
	showOnlyTab(TabSetting);
}

function showOnlyTab(tab) {
	TabChat.classList.add("hidden");
	TabStory.classList.add("hidden");
	TabSetting.classList.add("hidden");
	tab.classList.remove("hidden");
}

/*
 * 10. Messaging
 */
async function sendMessage() {
	const text = elements.messageInput?.value.trim().slice(0, MAX_TEXT_LENGTH);
	if (!text) return;

	if (!state.remoteId || !state.crypto.sharedKey) {
		showSystemMessage(t("message_send_closed"));
		return;
	}

	try {
		if (state.editing) {
			await submitEdit(text);
			return;
		}

		const id = Msgs.newId();
		const replyTo = state.replyTo ? { id: state.replyTo.id, text: state.replyTo.text } : null;
		const ttl = state.ttl;
		await sendSecurePayload({ type: "text", id, message: text, replyTo, ttl });
		addMessageContent(text, "me", id, { replyTo, ttl });
		elements.messageInput.value = "";
		resetComposerState();
	} catch (error) {
		console.error("Error sending message:", error);
		showSystemMessage(t("message_send_failed"));
	}
}

/* ----- composer context (reply / edit) ----- */
function showComposeContext(icon, label, text) {
	const bar = document.getElementById("compose-context");
	if (!bar) return;
	bar.querySelector(".pp-context-icon").replaceChildren(ppIcon(icon));
	bar.querySelector(".pp-context-label").textContent = label;
	bar.querySelector(".pp-context-text").textContent = text;
	bar.classList.remove("hidden");
	elements.messageInput?.focus();
}

function resetComposerState() {
	if (state.editing && elements.messageInput) elements.messageInput.value = "";
	state.replyTo = null;
	state.editing = null;
	document.getElementById("compose-context")?.classList.add("hidden");
}

function startReply(id) {
	const entry = Msgs.get(id);
	if (!entry || entry.deleted) return;
	state.editing = null;
	state.replyTo = { id, text: entry.node ? t("attachment") : Msgs.preview(entry.text) };
	showComposeContext("fa-reply", t("replying_to"), state.replyTo.text);
}

function startEdit(id) {
	const entry = Msgs.get(id);
	if (!entry || entry.from !== "me" || entry.node || entry.deleted) return;
	state.replyTo = null;
	state.editing = { id };
	elements.messageInput.value = entry.text;
	showComposeContext("fa-pen", t("editing_message"), Msgs.preview(entry.text));
}

async function submitEdit(text) {
	const { id } = state.editing;
	const entry = Msgs.get(id);
	if (entry && entry.from === "me" && !entry.node) {
		await sendSecurePayload({ type: "edit", target: id, message: text });
		Msgs.edit(id, text);
		persistPatch(id, { text, edited: true });
	}
	state.editing = null;
	elements.messageInput.value = "";
	resetComposerState();
}

async function deleteMessage(id) {
	const entry = Msgs.get(id);
	if (!entry || entry.from !== "me") return;
	if (!(await ppConfirm({ title: t("delete_message_title"), message: t("delete_message_text"), confirmLabel: t("delete"), danger: true }))) return;
	try {
		await sendSecurePayload({ type: "delete", target: id });
		Msgs.markDeleted(id);
		persistRemoval(id);
	} catch {
		showToast(t("message_send_failed"));
	}
}

async function reactToMessage(id, emoji) {
	const entry = Msgs.get(id);
	if (!entry || entry.deleted) return;
	try {
		await sendSecurePayload({ type: "reaction", target: id, emoji });
		Msgs.setReaction(id, "me", emoji);
		persistPatch(id, { reactions: { me: entry.reactions.me, them: entry.reactions.them } });
	} catch {
		showToast(t("message_send_failed"));
	}
}

/* ----- delivery / read receipts ----- */
function onIncomingMessage(id) {
	state.receiptQueue.set(id, "new");
	flushReceipts();
}

function flushReceipts() {
	if (!state.connectionStatus || !state.crypto.sharedKey || !state.receiptQueue.size) return;
	const visible = document.visibilityState === "visible" && document.hasFocus();
	const read = [];
	const delivered = [];
	for (const [id, status] of state.receiptQueue) {
		if (state.settings.receipts && visible) {
			read.push(id);
			state.receiptQueue.delete(id);
		} else if (status === "new") {
			delivered.push(id);
			if (state.settings.receipts) state.receiptQueue.set(id, "delivered");
			else state.receiptQueue.delete(id);
		}
	}
	const send = async (ids, status) => {
		for (let i = 0; i < ids.length; i += 50) {
			await sendSecurePayload({ type: "receipt", status, ids: ids.slice(i, i + 50) }).catch(() => {});
		}
	};
	if (delivered.length) send(delivered, "delivered");
	if (read.length) send(read, "read");
}

function resetReceivingFile() {
	receivingFile.meta = null;
	receivingFile.chunks = [];
	receivingFile.received = 0;
}

function clearPeerTyping() {
	if (!elements.chatStatus) return;
	elements.chatStatus.textContent = t("status_encrypted");
	elements.chatStatus.classList.remove("is-typing");
}

// Everything a peer sends is untrusted, even though it decrypted fine:
// the peer may be malicious. Validate shape and bounds before using it.
function handlePlainMessage(msg) {
	if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

	switch (msg.type) {
		case "file-meta": {
			const total = msg.totalChunks;
			if (!Number.isInteger(total) || total < 1 || total > MAX_FILE_CHUNKS) {
				resetReceivingFile();
				return;
			}
			receivingFile.meta = {
				name: sanitizeFileName(msg.name),
				totalChunks: total,
				id: Msgs.isValidId(msg.id) ? msg.id : Msgs.newId(),
				ttl: Msgs.isValidTtl(msg.ttl) ? msg.ttl : 0,
			};
			receivingFile.chunks = new Array(total);
			receivingFile.received = 0;
			return;
		}
		case "file-chunk": {
			const meta = receivingFile.meta;
			if (!meta) return;
			const { index, chunk } = msg;
			if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) return;
			if (typeof chunk !== "string" || chunk.length > FILE_CHUNK_SIZE) return;
			if (receivingFile.chunks[index] !== undefined) return;

			receivingFile.chunks[index] = chunk;
			receivingFile.received += 1;
			if (receivingFile.received < meta.totalChunks) return;

			const data = receivingFile.chunks.join("");
			const { name, id, ttl } = meta;
			resetReceivingFile();
			renderFilePreview({ type: "file", name, data }, "them", id, { ttl });
			clearPeerTyping();
			onIncomingMessage(id);
			playNotificationSound();
			return;
		}
		case "text": {
			if (typeof msg.message !== "string" || msg.message.length > MAX_TEXT_LENGTH) return;
			const id = Msgs.isValidId(msg.id) ? msg.id : Msgs.newId();
			const entry = addMessageContent(msg.message, "them", id, { replyTo: msg.replyTo, ttl: Msgs.isValidTtl(msg.ttl) ? msg.ttl : 0 });
			if (!entry) return;
			clearPeerTyping();
			onIncomingMessage(id);
			playNotificationSound();
			return;
		}
		case "receipt": {
			if (!Array.isArray(msg.ids) || msg.ids.length > 50) return;
			if (msg.status !== "delivered" && msg.status !== "read") return;
			for (const id of msg.ids) if (Msgs.isValidId(id)) Msgs.setStatus(id, msg.status);
			return;
		}
		case "reaction": {
			const emoji = msg.emoji ?? null;
			if (!Msgs.isValidId(msg.target) || !Msgs.isValidReaction(emoji)) return;
			const entry = Msgs.get(msg.target);
			if (entry && Msgs.setReaction(msg.target, "them", emoji)) {
				persistPatch(msg.target, { reactions: { me: entry.reactions.me, them: entry.reactions.them } });
			}
			return;
		}
		case "edit": {
			if (!Msgs.isValidId(msg.target) || typeof msg.message !== "string" || msg.message.length > MAX_TEXT_LENGTH) return;
			const entry = Msgs.get(msg.target);
			// A peer may only change its own messages.
			if (entry && entry.from === "them" && Msgs.edit(msg.target, msg.message)) {
				persistPatch(msg.target, { text: msg.message, edited: true });
			}
			return;
		}
		case "delete": {
			if (!Msgs.isValidId(msg.target)) return;
			const entry = Msgs.get(msg.target);
			if (entry && entry.from === "them" && Msgs.markDeleted(msg.target)) persistRemoval(msg.target);
			return;
		}
		case "ttl":
			if (Msgs.isValidTtl(msg.seconds)) applyTtl(msg.seconds);
			return;
		case "typing":
			if (elements.chatStatus) {
				elements.chatStatus.textContent = t("typing");
				elements.chatStatus.classList.add("is-typing");
			}
			return;
		case "stop-typing":
			clearPeerTyping();
			return;
	}
}

function initMessaging() {
	Msgs.init(elements.messagesContainer, {
		canAct: () => state.currentView === "chat" && state.connectionStatus,
		onReply: startReply,
		onEdit: startEdit,
		onDelete: deleteMessage,
		onReact: reactToMessage,
	});

	document.getElementById("compose-cancel")?.addEventListener("click", resetComposerState);
	document.getElementById("voice-btn")?.addEventListener("click", startVoice);
	document.getElementById("voice-cancel")?.addEventListener("click", () => stopVoice(false));
	document.getElementById("voice-send")?.addEventListener("click", () => stopVoice(true));

	const onVisibility = () => {
		applyBlurSetting();
		flushReceipts();
	};
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("focus", onVisibility);
	window.addEventListener("blur", applyBlurSetting);
	applyBlurSetting();
}

function showSystemMessage(message) {
	Msgs.system(message);
}

async function startCall(id) {
	if (!id) {
		showToast(t("select_chat_title"));
		return;
	}

	// openChat() has already dealt with an existing connection.
	if (state.connectionStatus) return;

	resetSessionCrypto();

	try {
		state.remoteId = id;
		sessionStorage.setItem(STORAGE_KEYS.REMOTE_ID, id);

		const cryptoPublicKey = await prepareLocalCrypto();
		updateStatus(CONNECTION_STATES.CONNECTING);

		socket.emit("call-user", { targetId: state.remoteId, cryptoPublicKey });
	} catch (error) {
		console.error("Socket chat request error:", error);
		handleChatDisconnect(false);
	}
}

function handleChatDisconnect(useRelayFallback = true) {
	if (state.isDisconnecting) return;
	state.isDisconnecting = true;

	console.log("Socket chat disconnected, cleaning up...");
	const canUseEncryptedRelay = Boolean(useRelayFallback && state.remoteId && state.crypto.sharedKey && socket.connected);
	if (canUseEncryptedRelay) {
		activateEncryptedRelay();
		state.isDisconnecting = false;
		return;
	}

	updateStatus(CONNECTION_STATES.DISCONNECTED);

	if (state.connectionStatus) {
		showSystemMessage(t("peer_disconnected"));
	}

	if (state.remoteId) {
		socket.emit("connection-ended", { targetId: state.remoteId });
	}

	closeChat();

	state.connectionStatus = false;
	state.remoteId = null;
	state.activeChat = null;
	state.selectedUser = null;
	resetSessionCrypto();

	sessionStorage.removeItem(STORAGE_KEYS.REMOTE_ID);
	localStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS);
	clearSocketChatTimer();

	if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = true;
	renderChatsList();

	state.isDisconnecting = false;
}

/*
 * 13. Story Screen
 */
let isStoryPlaying = false;
let storyTimeout = null;

function openStory(user) {
	if (isStoryPlaying) return;
	if (!user?.persistentUserId) return;

	closeChat();

	const storyData = state.currentStories[user.persistentUserId];
	const stories = storyData?.stories?.filter((s) => s.type === "image") || [];
	if (!stories.length) return;

	isStoryPlaying = true;

	const panel = document.getElementById("story-panel");
	const img = document.getElementById("story-image");
	const progressContainer = document.getElementById("story-progress-container");
	const usernameLabel = document.getElementById("story-username");
	const avatar = document.getElementById("story-avatar");
	const viewersCountDiv = document.getElementById("story-viewersCount");

	elements.noChatPlaceholder?.classList.add("hidden");
	panel.classList.remove("hidden");
	document.getElementById("chat-panel")?.classList.remove("mobile-chat-closed");
	document.getElementById("chat-panel")?.classList.add("mobile-chat-open");

	usernameLabel.textContent = user.username;
	avatar.src = safeImageSrc(user.profilePic);

	progressContainer.replaceChildren();
	stories.forEach((_, i) => {
		const bar = document.createElement("div");
		bar.className = "pp-bar";
		const fill = document.createElement("div");
		fill.id = `progress-fill-${i}`;
		fill.className = "pp-bar-fill";
		bar.appendChild(fill);
		progressContainer.appendChild(bar);
	});

	let index = 0;

	function showNextStory() {
		if (!isStoryPlaying) return;
		if (index >= stories.length) {
			closeStory();
			return;
		}

		const story = stories[index];
		const ref = { persistentUserId: user.persistentUserId, storyId: story.id };

		// Image bytes are not broadcast with the feed; fetch this one on demand.
		img.removeAttribute("src");
		socket.emit("get-story", ref, (res) => {
			if (!isStoryPlaying || stories[index] !== story) return;
			if (res?.ok && AVATAR_DATA_URL.test(res.data)) img.src = res.data;
		});
		socket.emit("story-viewed", ref);

		const eye = document.createElement("i");
		eye.className = "fas fa-eye";
		viewersCountDiv.replaceChildren(eye, document.createTextNode(` ${Number(story.viewersCount) || 0}`));

		const visibilityEl = document.getElementById("story-visibility");
		if (visibilityEl) {
			const restricted = user.persistentUserId === state.myPersistentId && story.visibility === "selected";
			visibilityEl.classList.toggle("hidden", !restricted);
			if (restricted) visibilityEl.replaceChildren(ppIcon("fa-user-lock"), document.createTextNode(` ${Number(story.audienceCount) || 0}`));
		}

		if (user.persistentUserId === state.myPersistentId) {
			const deleteBtn = document.getElementById("delete-story-btn");
			if (deleteBtn) {
				deleteBtn.classList.remove("hidden");
				deleteBtn.onclick = async () => {
					if (await ppConfirm({ title: t("aria_delete_story"), message: t("story_delete_confirm"), confirmLabel: t("delete"), danger: true })) {
						socket.emit("delete-story", { storyId: story.id });
						closeStory();
					}
				};
			}
		}

		img.draggable = false;
		img.ontouchstart = (e) => e.preventDefault();
		img.onmousedown = (e) => e.preventDefault();
		img.classList.remove("hidden");

		const fill = document.getElementById(`progress-fill-${index}`);
		fill.style.width = "0%";
		fill.style.transition = "none";
		requestAnimationFrame(() => {
			fill.style.transition = `width ${STORY_DURATION.IMAGE}ms linear`;
			fill.style.width = "100%";
		});

		storyTimeout = setTimeout(() => {
			index++;
			showNextStory();
		}, STORY_DURATION.IMAGE);
	}

	showNextStory();
}

function closeStory() {
	if (storyTimeout) {
		clearTimeout(storyTimeout);
		storyTimeout = null;
	}
	isStoryPlaying = false;

	const deleteBtn = document.getElementById("delete-story-btn");
	if (deleteBtn) deleteBtn.classList.add("hidden");
	document.getElementById("story-visibility")?.classList.add("hidden");

	const img = document.getElementById("story-image");
	if (img) img.removeAttribute("src");

	document.getElementById("story-panel")?.classList.add("hidden");
	document.getElementById("story-progress-container").replaceChildren();

	const chatPanel = document.getElementById("chat-panel");
	chatPanel?.classList.add("mobile-chat-closed");
	chatPanel?.classList.remove("mobile-chat-open");

	elements.noChatPlaceholder?.classList.remove("hidden");
}

/*
 * 14. User Chat Screen
 */
function prepareChatUI() {
	if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = true;
	elements.noChatPlaceholder?.classList.add("hidden");

	if (elements.chatContent) {
		elements.chatContent.classList.remove("hidden");
		elements.chatContent.classList.add("flex");
	}

	if (elements.chatPanel) {
		elements.chatPanel.classList.remove("hidden");
		elements.chatPanel.classList.add("mobile-chat-open");
		elements.chatPanel.classList.remove("mobile-chat-closed");
	}

	Msgs.reset();
	resetComposerState();
	state.ttl = 0;
	state.receiptQueue.clear();
	elements.chatContent?.classList.remove("pp-readonly");
	setTimeout(() => elements.messageInput?.focus(), 0);
}

async function openChat(user) {
	// Decide about an existing connection BEFORE touching the UI, otherwise
	// closing the old chat would also hide the one we are about to open.
	if (state.connectionStatus) {
		if (!(await ppConfirm({ title: t("chats_tab_label"), message: t("already_connected_confirm"), confirmLabel: t("confirm") }))) return;
		handleChatDisconnect(false);
	}

	closeStory();
	state.activeChat = user;
	state.selectedUser = user;
	state.currentView = "chat";

	prepareChatUI();

	if (elements.chatName) elements.chatName.textContent = user.username;
	if (elements.chatAvatar) {
		setAvatar(elements.chatAvatar, user.profilePic, user.username);
	}
	if (elements.chatStatus) elements.chatStatus.textContent = t("text-available");

	loadHistoryInto(user);
	startCall(user.socketId);
}

function closeChat() {
	state.activeChat = null;
	state.selectedUser = null;
	state.currentView = null;

	if (elements.chatContent) {
		elements.chatContent.classList.add("hidden");
		elements.chatContent.classList.remove("flex");
	}

	if (elements.chatPanel) {
		elements.chatPanel.classList.remove("mobile-chat-open");
		elements.chatPanel.classList.add("mobile-chat-closed");
	}

	elements.noChatPlaceholder?.classList.remove("hidden");
	Msgs.reset();
	resetComposerState();
	elements.chatContent?.classList.remove("pp-readonly");
}

function toggleFloatingMenu() {
	const menu = document.getElementById("floating-menu");
	if (!menu.classList.contains("hidden")) {
		menu.classList.add("hidden");
		return;
	}

	menu.replaceChildren();
	for (const item of buildChatMenu()) {
		const btn = ppEl("button", `pp-menu-item${item.danger ? " pp-menu-item--danger" : ""}`);
		btn.type = "button";
		btn.append(ppIcon(item.icon), document.createTextNode(item.label));
		btn.addEventListener("click", () => {
			menu.classList.add("hidden");
			item.run();
		});
		menu.appendChild(btn);
	}
	menu.classList.remove("hidden");
}

/*
 * 15. Utilities
 */
function updateStatus(text) {
	console.log("Status:", text);
	if (text === CONNECTION_STATES.CONNECTED) {
		state.connectionStatus = true;
	} else if (text === CONNECTION_STATES.DISCONNECTED) {
		state.connectionStatus = false;
	}
}

function timeAgo(timestamp) {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (seconds < 60) return t("time_seconds_ago", { n: seconds });
	if (minutes < 60) return t("time_minutes_ago", { n: minutes });
	if (hours < 24) return t("time_hours_ago", { n: hours });
	return t("time_days_ago", { n: days });
}

function playNotificationSound() {
	let audio = document.getElementById("notification-sound");
	if (!audio) {
		audio = document.createElement("audio");
		audio.id = "notification-sound";
		audio.src = "assets/sounds/notification.mp3";
		document.body.appendChild(audio);
	}
	audio.play().catch((e) => console.log("Audio play error:", e));
}

function searchInCurrentTab(query) {
	if (!state.isConnected) {
		const msg = document.createElement("div");
		msg.className = "pp-empty";
		msg.textContent = t("connecting");
		elements.chatsList.replaceChildren(msg);
		return;
	}

	const q = query.trim().toLowerCase();
	const settings = getSettingsItems();

	if (activeTabId === "btnChats" || activeTabId === "mobBtnChats") {
		renderChatSearchResults(
			state.allUsers.filter((u) => u.socketId !== state.myId && !u.hidden && u.username.toLowerCase().includes(q)),
			offlineSavedPeers().filter((p) => p.username.toLowerCase().includes(q)),
		);
	} else if (activeTabId === "btnStorys" || activeTabId === "mobBtnStorys") {
		renderStorySearchResults(Object.values(state.currentStories).filter((s) => s?.user?.username.toLowerCase().includes(q)));
	} else if (activeTabId === "btnSettings" || activeTabId === "mobBtnSettings") {
		renderSettingsSearchResults(settings.filter((s) => s.label.toLowerCase().includes(query.toLowerCase())));
	}
}

function showToast(message) {
	document.querySelector(".pp-toast")?.remove();

	const toast = ppEl("div", "pp-toast", message);
	toast.setAttribute("role", "status");
	document.body.appendChild(toast);

	requestAnimationFrame(() => toast.classList.add("is-in"));
	setTimeout(() => {
		toast.classList.remove("is-in");
		setTimeout(() => toast.remove(), 250);
	}, 3000);
}

/*
 * 16. Socket Events
 */
socket.on("connect", () => {
	state.isConnected = true;
	initApp();
	socket.emit("auth", sessionToken);
});

socket.on("your-id", ({ socketId, persistentUserId, username, profilePic }) => {
	state.myId = socketId;
	state.myPersistentId = persistentUserId;
	state.myUsername = username;
	state.myProfilePic = safeImageSrc(profilePic);
	document.querySelector("#btnSettings img").src = state.myProfilePic;
	document.querySelector("#mobBtnSettings img").src = state.myProfilePic;
	console.log(`Connected: socketId=${socketId}, persistentId=${persistentUserId}`);
});

socket.on("auth_ok", ({ user }) => {
	console.log("Auth successful:", user);
	refreshSavedPeers();
});

function serverMessage(code, params) {
	const key = `server_${code}`;
	return hasTranslation(key) ? t(key, params) : t("server_error");
}

socket.on("auth_failed", (payload) => {
	const { code, params } = typeof payload === "object" && payload ? payload : { code: payload };
	console.error("Auth failed:", code);
	alert(t("auth_failed", { reason: serverMessage(code, params) }));
	// Only a rejected/expired credential should force a new login; a transient
	// condition (rate limit, server busy) must not destroy a valid session.
	if (code !== "rate_limited" && code !== "busy" && code !== "auth_error") {
		localStorage.removeItem(STORAGE_KEYS.SESSION);
	}
	window.location.href = "login.html";
});

socket.on("nickname-restricted", () => {
	alert(t("nickname_restricted"));
	localStorage.removeItem(STORAGE_KEYS.SESSION);
	window.location.href = "login.html";
});

socket.on("nickname-taken", () => {
	alert(t("nickname_taken"));
	localStorage.removeItem(STORAGE_KEYS.SESSION);
	window.location.href = "login.html";
});

socket.on("online-users", (users) => {
	state.allUsers = users;
	if (activeTabId === "btnChats" || activeTabId === "mobBtnChats") renderChatsList();
});

socket.on("chat-disconnected", ({ from }) => {
	if (state.remoteId === from) {
		handleChatDisconnect(false);
		renderChatsList();
	}
});

socket.on("user-disconnected", (userId) => {
	if (state.connectionStatus && state.remoteId === userId) handleChatDisconnect(false);
	renderChatsList();
});

socket.on("stories-updated", (stories) => {
	state.currentStories = stories;
	if (activeTabId === "btnStorys" || activeTabId === "mobBtnStorys") renderStoriesList(stories);
});

socket.on("incoming-call", async ({ from, cryptoPublicKey }) => {
	const caller = state.allUsers.find((u) => u.socketId === from);
	if (!caller || typeof cryptoPublicKey !== "string") return;

	if (state.connectionStatus) {
		socket.emit("call-rejected", { targetId: from, reason: "busy" });
		return;
	}

	const confirmConnect = await ppConfirm({
		title: t("incoming_title"),
		message: `${caller.username} ${t("confirm_connect")}`,
		confirmLabel: t("accept"),
		cancelLabel: t("decline"),
	});
	if (!confirmConnect) {
		socket.emit("call-rejected", { targetId: from, reason: "rejected" });
		return;
	}

	state.remoteId = from;
	try {
		resetSessionCrypto();
		const answerCryptoPublicKey = await prepareLocalCrypto();
		if (cryptoPublicKey) await deriveSharedKey(cryptoPublicKey);
		updateStatus(CONNECTION_STATES.ANSWERING);

		closeStory();
		state.activeChat = caller;
		state.selectedUser = caller;
		state.currentView = "chat";
		prepareChatUI();

		if (elements.chatName) elements.chatName.textContent = caller.username;
		if (elements.chatAvatar) {
			setAvatar(elements.chatAvatar, caller.profilePic, caller.username);
		}
		if (elements.chatStatus) elements.chatStatus.textContent = t("text-available");
		loadHistoryInto(caller);

		socket.emit("send-answer", {
			targetId: state.remoteId,
			cryptoPublicKey: answerCryptoPublicKey,
		});

		state.connectionStatus = true;
		sessionStorage.setItem(STORAGE_KEYS.REMOTE_ID, from);
		activateEncryptedRelay();
	} catch (error) {
		console.error("Error handling incoming call:", error);
		handleChatDisconnect(false);
	}
});

socket.on("call-answered", async ({ from, cryptoPublicKey }) => {
	if (from !== state.remoteId || typeof cryptoPublicKey !== "string") return;
	try {
		await deriveSharedKey(cryptoPublicKey);

		state.connectionStatus = true;
		activateEncryptedRelay();
		showToast(t("call_answered"));
	} catch (error) {
		console.error("Error handling call answer:", error);
		handleChatDisconnect(false);
	}
});

socket.on("relay-message", async ({ from, envelope }) => {
	if (from !== state.remoteId || !envelope) return;

	try {
		handlePlainMessage(await decryptEnvelope(envelope));
	} catch (error) {
		console.error("Relay message decrypt error:", error);
	}
});

socket.on("call-rejected", ({ reason } = {}) => {
	updateStatus(CONNECTION_STATES.REJECTED);
	showToast(t("busy"));
	sessionStorage.removeItem(STORAGE_KEYS.REMOTE_ID);
	clearSocketChatTimer();
	resetSessionCrypto();
	state.connectionStatus = false;
	state.remoteId = null;
	closeChat();
});

/*
 * 17. Settings Functions
 */
async function logoutUser() {
	const token = localStorage.getItem(STORAGE_KEYS.SESSION);
	localStorage.removeItem(STORAGE_KEYS.SESSION);
	// Removing the keys locks the saved history until the key file is used again.
	await HistoryStore.clearKeys();
	try {
		if (token) await fetch("/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
	} catch {
		// The session still expires on its own; the local copy is already gone.
	}
	window.location.href = "login.html";
}

function toggleSearchVisibility() {
	state.hiddenFromSearch = !state.hiddenFromSearch;
	localStorage.setItem(STORAGE_KEYS.HIDDEN, state.hiddenFromSearch);
	showToast(state.hiddenFromSearch ? t("hidden_from_search") : t("visible_in_search"));
	socket.emit("update-visibility", { hidden: state.hiddenFromSearch });
	renderSettingsList(true);
}

/*
 * 18. App Ready
 */
document.addEventListener("DOMContentLoaded", () => {
	initStoryFunctionality();
	initProfilePictureUpload();
	sessionStorage.removeItem(STORAGE_KEYS.REMOTE_ID);
	localStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS);
	if (elements.noChatPlaceholder) elements.noChatPlaceholder.classList.remove("hidden");
	if (elements.chatContent) elements.chatContent.classList.add("hidden");
});

document.addEventListener("click", (e) => {
	const menu = document.getElementById("floating-menu");
	if (!menu.contains(e.target) && !e.target.closest("#chat-menu-btn")) {
		menu.classList.add("hidden");
	}
});

document.getElementById("add-story-btn")?.addEventListener("click", () => elements.storyInput.click());
document.getElementById("chat-menu-btn")?.addEventListener("click", toggleFloatingMenu);

/*
 * 19. Translations (see i18n.js)
 */
i18nReady.then(() => {
	const chatListEl = document.getElementById("chats-list");
	window._vcl = new VirtualizedChatList(chatListEl, {
		itemHeight: 73,
		overscan: 5,
	});
	renderChats();
});
