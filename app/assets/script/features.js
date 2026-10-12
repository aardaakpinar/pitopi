/*
 * Settings, dialogs and the "extra" features: local history, key file
 * protection, session management, story audience, voice messages, panic wipe.
 *
 * Loaded before app.js. Only function declarations live at the top level; they
 * use app.js globals (state, socket, STORAGE_KEYS, ...) at call time.
 */

/* ---------- settings ---------- */
function loadSettings() {
	return {
		history: localStorage.getItem(STORAGE_KEYS.HISTORY) === "true",
		receipts: localStorage.getItem(STORAGE_KEYS.RECEIPTS) !== "false",
		blur: localStorage.getItem(STORAGE_KEYS.BLUR) === "true",
	};
}

function saveSetting(name, key, value) {
	state.settings[name] = value;
	localStorage.setItem(key, String(value));
}

/*
 * Settings are grouped into categories. The left list shows the categories;
 * the one picked opens in the chat panel (see openSettingsCategory).
 */
function settingsLeafItems() {
	return {
		profile: [
			{ iconClass: "fa-camera", label: t("upload_photo"), onClick: () => document.getElementById("uploadAvatarInput")?.click() },
			{ iconClass: "fa-globe", label: t("category_language"), subtitle: availableLanguages().find((l) => l.code === getLanguage())?.name, onClick: () => openLanguagePane() },
		],
		privacy: [
			{ iconClass: "fa-user-secret", label: t("setting_hide_profile"), subtitle: t("setting_hide_profile_desc"), toggle: state.hiddenFromSearch, onClick: () => toggleSearchVisibility() },
			{ iconClass: "fa-clock-rotate-left", label: t("setting_history"), subtitle: t("setting_history_desc"), toggle: state.settings.history, onClick: () => toggleHistory() },
			{ iconClass: "fa-check-double", label: t("setting_receipts"), subtitle: t("setting_receipts_desc"), toggle: state.settings.receipts, onClick: () => toggleReceipts() },
			{ iconClass: "fa-eye-slash", label: t("setting_blur"), subtitle: t("setting_blur_desc"), toggle: state.settings.blur, onClick: () => toggleBlur() },
		],
		account: [
			{ iconClass: "fa-laptop", label: t("active_sessions"), onClick: () => openSessionsPane() },
			{ iconClass: "fa-arrows-rotate", label: t("rotate_key"), onClick: () => showKeyRotation() },
			{ iconClass: "fa-trash", label: t("panic_wipe"), danger: true, onClick: () => confirmPanic() },
		],
	};
}

function getSettingsCategories() {
	return [
		{ id: "profile", iconClass: "fa-user", label: t("category_profile") },
		{ id: "privacy", iconClass: "fa-user-shield", label: t("category_privacy") },
		{ id: "account", iconClass: "fa-user-gear", label: t("category_account") },
	];
}

/** Flat list used by the search box: every single setting. */
function getSettingsItems() {
	const leaves = settingsLeafItems();
	return [...leaves.profile, ...leaves.privacy, ...leaves.account];
}

function toggleReceipts() {
	saveSetting("receipts", STORAGE_KEYS.RECEIPTS, !state.settings.receipts);
	renderSettingsList(true);
}

function applyBlurSetting() {
	const hidden = document.visibilityState !== "visible" || !document.hasFocus();
	Msgs.setBlurred(state.settings.blur && hidden);
}

function toggleBlur() {
	saveSetting("blur", STORAGE_KEYS.BLUR, !state.settings.blur);
	applyBlurSetting();
	renderSettingsList(true);
}

/* ---------- key file reading (shared by several dialogs) ---------- */
async function rawKeyFromFile(file, password) {
	const bytes = await KeyFile.readFile(file);
	const kind = KeyFile.kind(bytes);
	if (kind === "raw") return bytes;
	if (kind === "protected") return KeyFile.unprotect(bytes, password);
	throw new Error("invalid_key_file");
}

function keyErrorText(err) {
	if (err?.message === "wrong_password") return t("key_wrong_password");
	if (err?.message === "secure_context_required") return t("secure_context_required");
	return t("server_invalid_key");
}

/** File picker + (conditional) password field. Returns { body, getRaw(), onFile(cb) }. */
function buildKeyFilePicker() {
	const zone = ppEl("label", "pp-drop");
	const zoneLabel = ppEl("span", "", t("login_choose_file"));
	zone.append(ppIcon("fa-key"), zoneLabel);
	const input = ppEl("input");
	input.type = "file";
	input.accept = ".key";
	input.hidden = true;
	zone.appendChild(input);

	const pw = ppField(t("key_password"), { type: "password", autocomplete: "current-password" });
	pw.wrap.classList.add("hidden");
	const error = ppEl("p", "pp-error hidden");

	let kind = null;
	let listener = () => {};
	input.addEventListener("change", async () => {
		error.classList.add("hidden");
		const file = input.files[0];
		if (!file) return;
		zoneLabel.textContent = file.name;
		try {
			kind = KeyFile.kind(await KeyFile.readFile(file));
		} catch {
			kind = "invalid";
		}
		pw.wrap.classList.toggle("hidden", kind !== "protected");
		if (kind === "invalid") {
			error.textContent = t("server_invalid_key");
			error.classList.remove("hidden");
		}
		listener(kind);
	});

	return {
		body: [zone, pw.wrap, error],
		kind: () => kind,
		hasFile: () => Boolean(input.files[0]),
		onKind: (cb) => (listener = cb),
		showError: (message) => {
			error.textContent = message;
			error.classList.remove("hidden");
		},
		getRaw: () => rawKeyFromFile(input.files[0], pw.input.value),
	};
}

/* ---------- local history ---------- */
async function toggleHistory() {
	if (state.settings.history) {
		const modal = ppModal({
			title: t("setting_history"),
			body: ppEl("p", "pp-modal-text", t("history_disable_text")),
			actions: [
				{ label: t("cancel"), kind: "ghost" },
				{
					label: t("history_off_keep"),
					kind: "ghost",
					onClick: () => {
						saveSetting("history", STORAGE_KEYS.HISTORY, false);
						refreshSavedPeers();
						renderSettingsList(true);
					},
				},
				{
					label: t("history_off_delete"),
					kind: "danger",
					onClick: async () => {
						await HistoryStore.clearData();
						saveSetting("history", STORAGE_KEYS.HISTORY, false);
						refreshSavedPeers();
						renderSettingsList(true);
						showToast(t("history_deleted"));
					},
				},
			],
		});
		return modal;
	}

	if (await HistoryStore.isUnlocked()) {
		saveSetting("history", STORAGE_KEYS.HISTORY, true);
		refreshSavedPeers();
		renderSettingsList(true);
		showToast(t("history_enabled"));
		return;
	}

	// First time on this device (or the keys were removed by signing out): the
	// key file is needed once to derive the history key.
	const picker = buildKeyFilePicker();
	ppModal({
		title: t("setting_history"),
		body: [ppEl("p", "pp-modal-text", t("history_enable_text")), ...picker.body],
		actions: [
			{ label: t("cancel"), kind: "ghost" },
			{
				label: t("history_enable"),
				kind: "primary",
				onClick: async () => {
					if (!picker.hasFile()) {
						picker.showError(t("login_choose_file"));
						throw new Error("no_file");
					}
					try {
						const raw = await picker.getRaw();
						await HistoryStore.saveKeys(await KeyFile.deriveHistoryKeys(raw));
					} catch (err) {
						picker.showError(keyErrorText(err));
						throw err;
					}
					saveSetting("history", STORAGE_KEYS.HISTORY, true);
					refreshSavedPeers();
					renderSettingsList(true);
					showToast(t("history_enabled"));
				},
			},
		],
	});
}

/** Called for every finished chat message while history is on. */
function persistMessage(entry, kind, name) {
	const peer = state.activeChat;
	if (!state.settings.history || !peer?.persistentUserId || state.currentView !== "chat") return;
	// Disappearing messages are, by definition, never written to disk.
	if (entry.ttl > 0 || state.ttl > 0) return;
	const record = {
		id: entry.id,
		ts: entry.ts,
		from: entry.from,
		kind,
		text: kind === "text" ? entry.text : "",
		name: kind === "file" ? name : "",
		replyTo: entry.replyTo,
		reactions: { me: null, them: null },
		edited: false,
	};
	const isNewPeer = !state.savedPeers.some((p) => p.id === peer.persistentUserId);
	HistoryStore.saveMessage(peer.persistentUserId, record, peer.username)
		.then(() => isNewPeer && refreshSavedPeers())
		.catch((err) => console.warn("History save failed:", err));
}

function persistPatch(id, patch) {
	const peer = state.activeChat;
	if (!state.settings.history || !peer?.persistentUserId) return;
	HistoryStore.updateMessage(peer.persistentUserId, id, patch).catch(() => {});
}

function persistRemoval(id) {
	const peer = state.activeChat;
	if (!state.settings.history || !peer?.persistentUserId) return;
	HistoryStore.deleteMessage(peer.persistentUserId, id).catch(() => {});
}

function archivedNode(record) {
	if (record.kind !== "file") return null;
	const wrap = ppEl("div", "pp-file-note");
	wrap.append(ppIcon("fa-paperclip"), document.createTextNode(` ${sanitizeFileName(record.name)}`));
	return wrap;
}

/** Renders saved messages above whatever is already shown. */
async function loadHistoryInto(peer, { scroll = true } = {}) {
	if (!state.settings.history || !peer?.persistentUserId) return false;
	let records;
	try {
		records = await HistoryStore.loadMessages(peer.persistentUserId);
	} catch (err) {
		console.warn("History load failed:", err);
		return false;
	}
	if (!records.length) return false;
	// The user may have switched chats while this was loading.
	if (state.activeChat?.persistentUserId !== peer.persistentUserId) return false;

	const fragment = document.createDocumentFragment();
	for (const r of records) {
		if (!Msgs.isValidId(r.id)) continue;
		Msgs.add({
			id: r.id,
			from: r.from === "me" ? "me" : "them",
			text: typeof r.text === "string" ? r.text : "",
			node: archivedNode(r),
			ts: Number(r.ts) || Date.now(),
			replyTo: r.replyTo,
			reactions: r.reactions,
			edited: Boolean(r.edited),
			archived: true,
			silent: true,
			into: fragment,
		});
	}
	Msgs.divider(t("history_divider"), fragment);
	Msgs.prepend(fragment);
	if (scroll) Msgs.scrollToEnd();
	return true;
}

/** Reloads the contacts that have saved history and redraws the Chats tab. */
async function refreshSavedPeers() {
	let peers = [];
	if (state.settings.history) {
		try {
			peers = await HistoryStore.listPeers();
		} catch {
			peers = [];
		}
	}
	state.savedPeers = peers;
	if (activeTabId === "btnChats" || activeTabId === "mobBtnChats") {
		const q = elements.searchInput?.value?.trim();
		if (q) searchInCurrentTab(q);
		else renderChatsList();
	}
}

/** Saved conversations with people who are not online right now (online ones are listed normally). */
function offlineSavedPeers() {
	if (!state.settings.history) return [];
	const online = new Set(state.allUsers.map((u) => u.persistentUserId));
	return state.savedPeers.filter((p) => p.id !== state.myPersistentId && !online.has(p.id));
}

/** Read-only view of a saved conversation. */
async function openArchive(peer) {
	closeStory();
	if (state.connectionStatus) handleChatDisconnect(false);
	state.activeChat = { persistentUserId: peer.id, username: peer.username, profilePic: null };
	state.selectedUser = null;
	state.currentView = "archive";
	prepareChatUI();
	elements.chatContent.classList.add("pp-readonly");
	elements.chatName.textContent = peer.username;
	setAvatar(elements.chatAvatar, null, peer.username);
	elements.chatStatus.textContent = t("history_readonly");
	const found = await loadHistoryInto(state.activeChat);
	if (!found) Msgs.system(t("saved_chats_empty"));
}

async function deleteCurrentChatHistory() {
	const peer = state.activeChat;
	if (!peer?.persistentUserId) return;
	if (!(await ppConfirm({ title: t("history_delete_this"), message: t("history_delete_chat_confirm", { name: peer.username }), confirmLabel: t("delete"), danger: true }))) return;
	await HistoryStore.deletePeer(peer.persistentUserId).catch(() => {});
	if (state.currentView === "archive") closeChat();
	else showToast(t("history_deleted"));
	refreshSavedPeers();
}

/* ---------- chat menu: safety code, disappearing messages ---------- */
function showSafetyDialog() {
	const code = state.crypto.safetyCode;
	const body = [ppEl("p", "pp-modal-text", t("safety_intro"))];
	if (code) {
		const grid = ppEl("div", "pp-safety");
		code.split(" ").forEach((group) => grid.appendChild(ppEl("span", "", group)));
		body.push(grid, ppEl("p", "pp-modal-text pp-muted", t("safety_warning")));
	} else {
		body.push(ppEl("p", "pp-modal-text pp-muted", t("safety_unavailable")));
	}
	ppModal({
		title: t("safety_title"),
		body,
		actions: [...(code ? [{ label: t("copy"), kind: "ghost", icon: "fa-copy", keepOpen: true, onClick: () => navigator.clipboard?.writeText(code).then(() => showToast(t("copied"))) }] : []), { label: t("close"), kind: "primary" }],
	});
}

function ttlLabel(seconds) {
	const key = { 0: "ttl_off", 30: "ttl_30s", 300: "ttl_5m", 3600: "ttl_1h", 86400: "ttl_24h" }[seconds];
	return t(key || "ttl_off");
}

async function applyTtl(seconds, announce = true) {
	state.ttl = seconds;
	if (announce) Msgs.system(seconds ? t("ttl_set", { time: ttlLabel(seconds) }) : t("ttl_cleared"));
}

function showTtlDialog() {
	if (!state.connectionStatus || !state.crypto.sharedKey) {
		showToast(t("message_send_closed"));
		return;
	}
	const group = ppEl("div", "pp-choice-group");
	const modal = ppModal({ title: t("disappearing_title"), body: [ppEl("p", "pp-modal-text", t("disappearing_text")), group], actions: [{ label: t("close"), kind: "ghost" }] });
	for (const seconds of Msgs.ALLOWED_TTLS) {
		const btn = ppEl("button", `pp-choice${state.ttl === seconds ? " is-selected" : ""}`);
		btn.type = "button";
		btn.append(ppIcon(seconds ? "fa-hourglass-half" : "fa-infinity"), ppEl("span", "pp-choice-title", ttlLabel(seconds)));
		btn.addEventListener("click", async () => {
			modal.close();
			try {
				await sendSecurePayload({ type: "ttl", seconds });
				applyTtl(seconds);
			} catch {
				showToast(t("message_send_failed"));
			}
		});
		group.appendChild(btn);
	}
}

function buildChatMenu() {
	const items = [];
	if (state.currentView === "chat") {
		items.push({ icon: "fa-shield-halved", label: t("menu_safety"), run: showSafetyDialog });
		items.push({ icon: "fa-hourglass-half", label: t("menu_disappearing"), run: showTtlDialog });
	}
	if (state.settings.history && state.activeChat?.persistentUserId) {
		items.push({ icon: "fa-eraser", label: t("history_delete_this"), run: deleteCurrentChatHistory });
	}
	items.push({ icon: "fa-trash", label: t("panic_wipe"), danger: true, run: confirmPanic });
	if (state.currentView === "chat") {
		items.push({ icon: "fa-link-slash", label: t("menu_disconnect"), danger: true, run: () => handleChatDisconnect(false) });
	}
	return items;
}

/* ---------- settings pane ---------- */
// The settings categories stay in the left list; their screens (and the language and
// sessions sub-screens) open in the chat panel, the same place chats and stories use.
let settingsPaneView = null;

function settingsPaneOpen() {
	const pane = document.getElementById("settings-pane");
	return Boolean(pane) && !pane.classList.contains("hidden");
}

function renderSettingsPane() {
	if (!settingsPaneView) return;
	document.getElementById("settings-pane-title").textContent = t(settingsPaneView.titleKey);
	const body = document.getElementById("settings-pane-body");
	body.replaceChildren();
	settingsPaneView.build(body);
}

function openSettingsPane(titleKey, build, parent = null) {
	const pane = document.getElementById("settings-pane");
	if (!pane) return;
	if (!settingsPaneOpen()) {
		closeStory();
		closeChat();
	}
	settingsPaneView = { titleKey, build, parent };
	renderSettingsPane();
	elements.noChatPlaceholder?.classList.add("hidden");
	pane.classList.remove("hidden");
	elements.chatPanel?.classList.remove("mobile-chat-closed");
	elements.chatPanel?.classList.add("mobile-chat-open");
}

function closeSettingsPane() {
	if (!settingsPaneOpen()) return;
	settingsPaneView = null;
	document.getElementById("settings-pane").classList.add("hidden");
	document.getElementById("settings-pane-body").replaceChildren();
	elements.chatPanel?.classList.remove("mobile-chat-open");
	elements.chatPanel?.classList.add("mobile-chat-closed");
	elements.noChatPlaceholder?.classList.remove("hidden");
}

// A sub-screen (language, sessions) goes back to its category; a category goes back to the list.
document.getElementById("settings-pane-back")?.addEventListener("click", () => {
	const parent = settingsPaneView?.parent;
	if (parent) openSettingsCategory(parent);
	else closeSettingsPane();
});

/* ---------- category screens ---------- */
function appendSettingRows(body, items) {
	const box = ppEl("div", "pp-pane-items");
	for (const item of items) box.appendChild(makeSettingItem(item).render());
	body.appendChild(box);
}

function openSettingsCategory(id) {
	if (!getSettingsCategories().some((c) => c.id === id)) return;
	openSettingsPane(`category_${id}`, (body) => appendSettingRows(body, settingsLeafItems()[id]));
}

function openLanguagePane() {
	openSettingsPane("category_language", buildLanguageBody, "profile");
}

function openSessionsPane() {
	openSettingsPane("active_sessions", buildSessionsSection, "account");
}

function buildLanguageBody(body) {
	const group = ppEl("div", "pp-choice-group");
	for (const { code, name } of availableLanguages()) {
		const btn = ppEl("button", `pp-choice${code === getLanguage() ? " is-selected" : ""}`);
		btn.type = "button";
		if (LANGUAGE_ICONS[code]) {
			const flag = ppEl("img", "pp-lang-flag");
			flag.src = LANGUAGE_ICONS[code];
			flag.alt = "";
			btn.appendChild(flag);
		}
		btn.appendChild(ppEl("span", "pp-choice-title", name));
		// Re-rendering the list also rebuilds this screen in the new language.
		btn.addEventListener("click", () => {
			setLanguage(code);
			renderSettingsList(true);
		});
		group.appendChild(btn);
	}
	body.appendChild(group);
}

/** Active sessions, shown at the top of the Account screen. */
function buildSessionsSection(body) {
	const list = ppEl("div", "pp-pane-list");
	const actions = ppEl("div", "pp-pane-actions");
	body.append(ppEl("p", "pp-modal-text pp-muted", t("sessions_intro")), list, actions);
	list.appendChild(ppEl("p", "pp-modal-text pp-muted", t("connecting")));

	const refresh = () =>
		socket.emit("list-sessions", {}, (res) => {
			// The screen may have been closed or rebuilt while this was loading.
			if (!list.isConnected) return;
			if (!res?.ok || !Array.isArray(res.sessions)) {
				list.replaceChildren(ppEl("p", "pp-modal-text pp-muted", t("server_error")));
				return;
			}
			list.replaceChildren(...res.sessions.map(sessionRow));
			actions.replaceChildren();
			if (res.sessions.some((x) => !x.current)) {
				const out = ppButton(t("sessions_sign_out_others"), "danger");
				out.addEventListener("click", () => {
					out.disabled = true;
					socket.emit("revoke-other-sessions", {}, (r) => {
						showToast(r?.ok ? t("sessions_others_done", { n: r.count }) : t("server_error"));
						refresh();
					});
				});
				actions.appendChild(out);
			}
		});

	const sessionRow = (x) => {
		const row = ppEl("div", "pp-list-row");
		const info = ppEl("div", "pp-list-info");
		const title = ppEl("div", "pp-list-title", x.device);
		if (x.current) title.appendChild(ppEl("span", "pp-badge pp-badge--accent", t("session_this")));
		else if (x.online) title.appendChild(ppEl("span", "pp-badge pp-badge--ok", t("session_online")));
		info.append(title, ppEl("div", "pp-list-sub", `${t("session_signed_in")}: ${x.createdAt ? new Date(x.createdAt).toLocaleString() : "—"}`));
		row.appendChild(info);
		if (!x.current) {
			const btn = ppButton(t("session_revoke"), "danger");
			btn.classList.add("pp-btn--sm");
			btn.addEventListener("click", () => {
				btn.disabled = true;
				socket.emit("revoke-session", { id: x.id }, (r) => {
					showToast(r?.ok ? t("session_revoked") : t("server_error"));
					refresh();
				});
			});
			row.appendChild(btn);
		}
		return row;
	};

	refresh();
}

/* ---------- key rotation ---------- */
/** Revokes the current key file: the server issues a new one and the old one stops working. */
function showKeyRotation() {
	const fresh = ppField(t("rotate_key_password"), { type: "password", autocomplete: "new-password" });
	const again = ppField(t("key_repeat_password"), { type: "password", autocomplete: "new-password" });
	const error = ppEl("p", "pp-error hidden");
	const fail = (message) => {
		error.textContent = message;
		error.classList.remove("hidden");
		return new Error("rotate_key_aborted");
	};

	ppModal({
		title: t("rotate_key"),
		body: [ppEl("p", "pp-modal-text", t("rotate_key_intro")), ppEl("p", "pp-modal-text pp-muted", t("rotate_key_warning")), fresh.wrap, again.wrap, error],
		actions: [
			{ label: t("cancel"), kind: "ghost" },
			{
				label: t("rotate_key_do"),
				kind: "danger",
				icon: "fa-arrows-rotate",
				keepOpen: true,
				onClick: async (ctl) => {
					error.classList.add("hidden");
					const password = fresh.input.value;
					if (password && password.length < 8) throw fail(t("key_password_short"));
					if (password !== again.input.value) throw fail(t("key_password_mismatch"));

					// Everything that can fail on this side is checked BEFORE the server swaps
					// the key, so a new key is never issued that cannot be saved.
					const hadHistoryKeys = await HistoryStore.isUnlocked();
					if ((password || hadHistoryKeys) && !globalThis.crypto?.subtle) throw fail(t("secure_context_required"));

					const res = await new Promise((resolve) => socket.timeout(20000).emit("rotate-key", {}, (err, reply) => resolve(err ? null : reply)));
					let raw = null;
					try {
						raw = base64ToBytes(res?.key ?? "");
					} catch {
						raw = null;
					}
					// The current session stays valid either way, so a failed attempt can simply be repeated.
					if (!res?.ok || !raw || KeyFile.kind(raw) !== "raw") throw fail(t("rotate_key_failed"));

					let file = raw;
					let name = `${Date.now()}.key`;
					if (password) {
						try {
							file = await KeyFile.protect(raw, password);
							name = `${Date.now()}-protected.key`;
						} catch {
							showToast(t("rotate_key_not_protected"));
						}
					}
					// Hand over the new key first; nothing below may stand between the user and the file.
					KeyFile.download(file, name);

					if (hadHistoryKeys) {
						try {
							await HistoryStore.rekey(await KeyFile.deriveHistoryKeys(raw));
							refreshSavedPeers();
						} catch (err) {
							console.warn("History re-encryption failed:", err);
							showToast(t("rotate_key_history_failed"));
						}
					}

					ctl.close();
					showKeyRotationDone(file, name);
				},
			},
		],
	});
}

function showKeyRotationDone(file, name) {
	ppModal({
		title: t("rotate_key_done_title"),
		body: [ppEl("p", "pp-modal-text", t("rotate_key_done_text"))],
		actions: [
			{ label: t("rotate_key_download_again"), kind: "ghost", icon: "fa-download", keepOpen: true, onClick: () => KeyFile.download(file, name) },
			{ label: t("close"), kind: "primary" },
		],
	});
}

/* ---------- story audience ---------- */
async function collectKnownPeople() {
	const people = new Map();
	for (const u of state.allUsers) {
		if (u.socketId !== state.myId && u.persistentUserId) people.set(u.persistentUserId, { id: u.persistentUserId, username: u.username });
	}
	try {
		for (const p of await HistoryStore.listPeers()) if (!people.has(p.id)) people.set(p.id, { id: p.id, username: p.username });
	} catch {
		// History unavailable: online users only.
	}
	return Array.from(people.values()).sort((a, b) => a.username.localeCompare(b.username));
}

/** Resolves { visibility, audience } or null when cancelled. */
async function chooseStoryAudience() {
	const people = await collectKnownPeople();
	return new Promise((resolve) => {
		let visibility = "everyone";
		const selected = new Set();

		const group = ppEl("div", "pp-choice-group");
		const peopleBox = ppEl("div", "pp-people hidden");
		const buttons = {};

		const choice = (value, icon, title, desc) => {
			const btn = ppEl("button", "pp-choice");
			btn.type = "button";
			const text = ppEl("span", "pp-choice-text");
			text.append(ppEl("span", "pp-choice-title", title), ppEl("span", "pp-choice-desc", desc));
			btn.append(ppIcon(icon), text);
			btn.addEventListener("click", () => {
				visibility = value;
				Object.entries(buttons).forEach(([key, el]) => el.classList.toggle("is-selected", key === value));
				peopleBox.classList.toggle("hidden", value !== "selected");
			});
			buttons[value] = btn;
			group.appendChild(btn);
		};
		choice("everyone", "fa-globe", t("story_vis_everyone"), t("story_vis_everyone_desc"));
		choice("selected", "fa-user-lock", t("story_vis_selected"), t("story_vis_selected_desc"));
		buttons.everyone.classList.add("is-selected");

		if (!people.length) {
			peopleBox.appendChild(ppEl("p", "pp-modal-text pp-muted", t("story_no_people")));
		}
		for (const person of people) {
			const row = ppEl("label", "pp-check");
			const box = ppEl("input");
			box.type = "checkbox";
			box.addEventListener("change", () => (box.checked ? selected.add(person.id) : selected.delete(person.id)));
			row.append(box, ppEl("span", "", person.username));
			peopleBox.appendChild(row);
		}

		ppModal({
			title: t("story_visibility_title"),
			body: [group, peopleBox],
			actions: [
				{ label: t("cancel"), kind: "ghost", onClick: () => resolve(null) },
				{
					label: t("story_publish"),
					kind: "primary",
					onClick: () => {
						if (visibility === "selected" && !selected.size) {
							showToast(t("story_pick_someone"));
							throw new Error("no_audience");
						}
						resolve({ visibility, audience: visibility === "selected" ? Array.from(selected) : [] });
					},
				},
			],
			onClose: () => resolve(null),
		});
	});
}

/* ---------- voice messages ---------- */
const voice = { recorder: null, stream: null, chunks: [], startedAt: 0, ticker: null, send: false };
const VOICE_MAX_MS = 120_000;

function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

function setVoiceUi(recording) {
	document.getElementById("voice-bar")?.classList.toggle("hidden", !recording);
	document.getElementById("composer-main")?.classList.toggle("hidden", recording);
	document.getElementById("voice-send")?.classList.toggle("hidden", !recording);
	document.getElementById("send-message")?.classList.toggle("hidden", recording);
}

async function startVoice() {
	if (voice.recorder) return;
	if (!state.connectionStatus || !state.crypto.sharedKey) {
		showToast(t("message_send_closed"));
		return;
	}
	if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
		showToast(t("voice_unsupported"));
		return;
	}
	try {
		voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	} catch {
		showToast(t("voice_denied"));
		return;
	}
	const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
	voice.recorder = new MediaRecorder(voice.stream, mime ? { mimeType: mime } : undefined);
	voice.chunks = [];
	voice.send = false;
	voice.recorder.ondataavailable = (e) => e.data.size && voice.chunks.push(e.data);
	voice.recorder.onstop = finishVoice;
	voice.recorder.start();
	voice.startedAt = Date.now();

	const clock = document.getElementById("voice-time");
	setVoiceUi(true);
	voice.ticker = setInterval(() => {
		const elapsed = Date.now() - voice.startedAt;
		const s = Math.floor(elapsed / 1000);
		clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
		if (elapsed >= VOICE_MAX_MS) stopVoice(true);
	}, 250);
	clock.textContent = "0:00";
}

function stopVoice(send) {
	voice.send = send;
	if (voice.recorder && voice.recorder.state !== "inactive") voice.recorder.stop();
}

async function finishVoice() {
	clearInterval(voice.ticker);
	voice.stream?.getTracks().forEach((track) => track.stop());
	const recorder = voice.recorder;
	const send = voice.send;
	const chunks = voice.chunks;
	voice.recorder = null;
	voice.stream = null;
	voice.chunks = [];
	setVoiceUi(false);
	if (!send || !chunks.length) return;

	const type = recorder?.mimeType || "audio/webm";
	const blob = new Blob(chunks, { type });
	if (blob.size > MAX_FILE_BYTES) {
		showToast(t("file_limit"));
		return;
	}
	const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
	const fileMeta = { type: "file", id: Msgs.newId(), name: `voice-${Date.now()}.${ext}`, mimeType: type.split(";")[0], data: await blobToDataUrl(blob) };
	try {
		await sendFileInChunks(fileMeta);
		renderFilePreview(fileMeta, "me", fileMeta.id, { ttl: state.ttl });
	} catch (err) {
		console.error("Voice send error:", err);
		Msgs.system(t("file_send_failed"));
	}
}

/* ---------- panic ---------- */
function confirmPanic() {
	ppConfirm({ title: t("panic_wipe"), message: t("panic_confirm"), confirmLabel: t("panic_do"), danger: true }).then((ok) => ok && panicWipe());
}

/** Wipes everything this browser knows and leaves the app. No undo. */
async function panicWipe() {
	const token = localStorage.getItem(STORAGE_KEYS.SESSION);
	try {
		socket.disconnect();
	} catch {
		// Already closed.
	}
	if (token) {
		fetch("/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
	}
	try {
		await HistoryStore.wipe();
	} catch {
		// Best effort.
	}
	localStorage.clear();
	sessionStorage.clear();
	try {
		await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
	} catch {
		// No Cache API.
	}
	window.location.replace("about:blank");
}
