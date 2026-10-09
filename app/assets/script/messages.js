/*
 * Message list: bubbles, replies, reactions, edit/delete, delivery ticks and
 * disappearing messages. This module only draws and tracks messages; sending
 * (encryption, relay, history) is wired in by app.js through `hooks`.
 *
 * Everything that came from the peer is rendered with textContent only.
 */
const Msgs = (() => {
	const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
	const ALLOWED_TTLS = [0, 30, 300, 3600, 86400];
	const ID_REGEX = /^[a-f0-9]{16}$/;
	const STATUS_ORDER = { sent: 0, delivered: 1, read: 2 };
	const MAX_REPLY_PREVIEW = 100;

	const entries = new Map();
	let container = null;
	let hooks = {};
	let openActions = null;

	function init(containerEl, hookMap) {
		container = containerEl;
		hooks = hookMap || {};
		container.addEventListener("click", (e) => {
			if (!e.target.closest(".pp-row")) closeActions();
		});
	}

	function newId() {
		return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
	}

	const isValidId = (value) => typeof value === "string" && ID_REGEX.test(value);
	const isValidTtl = (value) => ALLOWED_TTLS.includes(value);
	const isValidReaction = (value) => value === null || REACTIONS.includes(value);

	function reset() {
		for (const entry of entries.values()) clearTimeout(entry.timer);
		entries.clear();
		openActions = null;
		container?.replaceChildren();
	}

	function scrollToEnd() {
		if (container) container.scrollTop = container.scrollHeight;
	}

	function preview(text) {
		return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_REPLY_PREVIEW);
	}

	function sanitizeReplyTo(replyTo) {
		if (!replyTo || typeof replyTo !== "object") return null;
		if (!isValidId(replyTo.id) || typeof replyTo.text !== "string") return null;
		return { id: replyTo.id, text: preview(replyTo.text) };
	}

	function linkify(parent, text) {
		for (const part of text.split(/(https?:\/\/[^\s]+)/g)) {
			if (/^https?:\/\/[^\s]+$/.test(part)) {
				try {
					const url = new URL(part);
					const a = ppEl("a", "pp-link", part);
					a.href = url.href;
					a.target = "_blank";
					a.rel = "noopener noreferrer";
					parent.appendChild(a);
					continue;
				} catch {
					// Not a valid URL: fall through to plain text.
				}
			}
			parent.appendChild(document.createTextNode(part));
		}
	}

	function formatTime(ts) {
		return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
	}

	// ---- rendering ----
	function renderBody(entry) {
		const body = entry.body;
		body.replaceChildren();
		if (entry.deleted) {
			body.classList.add("pp-body--deleted");
			body.append(ppIcon("fa-ban"), document.createTextNode(` ${t("message_deleted")}`));
			return;
		}
		body.classList.remove("pp-body--deleted");
		if (entry.node) body.appendChild(entry.node);
		else linkify(body, entry.text);
	}

	function renderFoot(entry) {
		const foot = entry.foot;
		foot.replaceChildren();
		if (entry.ttl > 0 && !entry.archived) {
			const timer = ppIcon("fa-hourglass-half");
			timer.title = t("disappearing_title");
			foot.appendChild(timer);
		}
		if (entry.edited && !entry.deleted) foot.appendChild(ppEl("span", "pp-edited", t("edited")));
		foot.appendChild(ppEl("span", "pp-time", formatTime(entry.ts)));
		if (entry.from === "me" && !entry.archived && !entry.deleted) {
			const ticks = ppIcon(entry.status === "sent" ? "fa-check" : "fa-check-double");
			ticks.classList.add("pp-tick", `pp-tick--${entry.status}`);
			foot.appendChild(ticks);
		}
	}

	function renderReactions(entry) {
		const box = entry.reactionsEl;
		box.replaceChildren();
		if (entry.deleted) return;
		for (const who of ["me", "them"]) {
			const emoji = entry.reactions[who];
			if (!emoji) continue;
			const chip = ppEl("button", `pp-chip${who === "me" ? " pp-chip--mine" : ""}`, emoji);
			chip.type = "button";
			chip.setAttribute("aria-label", t(who === "me" ? "reaction_yours" : "reaction_theirs"));
			if (who === "me" && !entry.archived) chip.addEventListener("click", () => hooks.onReact?.(entry.id, null));
			box.appendChild(chip);
		}
	}

	function renderQuote(entry) {
		if (!entry.replyTo) return null;
		const quote = ppEl("button", "pp-quote");
		quote.type = "button";
		quote.appendChild(ppEl("span", "pp-quote-text", entry.replyTo.text || "…"));
		quote.addEventListener("click", () => jumpTo(entry.replyTo.id));
		return quote;
	}

	function jumpTo(id) {
		const target = entries.get(id);
		if (!target) return;
		target.row.scrollIntoView({ block: "center", behavior: "smooth" });
		target.row.classList.add("pp-row--flash");
		setTimeout(() => target.row.classList.remove("pp-row--flash"), 1200);
	}

	function closeActions() {
		openActions?.remove();
		openActions = null;
	}

	function buildActions(entry) {
		const bar = ppEl("div", "pp-actions");
		const emojis = ppEl("div", "pp-actions-emojis");
		for (const emoji of REACTIONS) {
			const btn = ppEl("button", "pp-emoji", emoji);
			btn.type = "button";
			btn.addEventListener("click", () => {
				hooks.onReact?.(entry.id, entry.reactions.me === emoji ? null : emoji);
				closeActions();
			});
			emojis.appendChild(btn);
		}
		bar.appendChild(emojis);

		const row = ppEl("div", "pp-actions-row");
		const add = (icon, label, handler) => {
			const btn = ppButton(label, "ghost", icon);
			btn.classList.add("pp-btn--sm");
			btn.addEventListener("click", () => {
				closeActions();
				handler();
			});
			row.appendChild(btn);
		};
		add("fa-reply", t("reply"), () => hooks.onReply?.(entry.id));
		if (!entry.node) add("fa-copy", t("copy"), () => navigator.clipboard?.writeText(entry.text).catch(() => {}));
		if (entry.from === "me" && !entry.node) add("fa-pen", t("edit"), () => hooks.onEdit?.(entry.id));
		if (entry.from === "me") add("fa-trash-can", t("delete"), () => hooks.onDelete?.(entry.id));
		bar.appendChild(row);
		return bar;
	}

	function toggleActions(entry) {
		const wasOpen = openActions && entry.row.contains(openActions);
		closeActions();
		if (wasOpen || entry.archived || entry.deleted || !hooks.canAct?.()) return;
		openActions = buildActions(entry);
		entry.row.appendChild(openActions);
	}

	/**
	 * Adds a message. `text` (string) or `node` (DOM, for files/voice) is the content.
	 * Returns the entry, or null when the id is already shown.
	 */
	function add({ id, from, text = "", node = null, ts = Date.now(), replyTo = null, ttl = 0, archived = false, status = "sent", reactions = null, edited = false, silent = false, into = null }) {
		if (!container || !isValidId(id) || entries.has(id)) return null;

		const entry = {
			id,
			from,
			text: String(text),
			node,
			ts,
			replyTo: sanitizeReplyTo(replyTo),
			ttl: isValidTtl(ttl) ? ttl : 0,
			archived,
			status: status in STATUS_ORDER ? status : "sent",
			reactions: { me: null, them: null, ...(reactions || {}) },
			edited,
			deleted: false,
			timer: null,
		};

		const row = ppEl("div", `pp-row pp-row--${from}${archived ? " pp-row--archived" : ""}`);
		row.dataset.id = id;
		const bubble = ppEl("div", "pp-bubble");
		const quote = renderQuote(entry);
		if (quote) bubble.appendChild(quote);
		entry.body = ppEl("div", "pp-body");
		entry.foot = ppEl("div", "pp-foot");
		bubble.append(entry.body, entry.foot);
		entry.reactionsEl = ppEl("div", "pp-reactions");
		row.append(bubble, entry.reactionsEl);
		entry.row = row;
		entry.bubble = bubble;

		bubble.addEventListener("click", (e) => {
			if (e.target.closest("a, audio, button, video")) return;
			toggleActions(entry);
		});

		renderBody(entry);
		renderFoot(entry);
		renderReactions(entry);
		(into || container).appendChild(row);
		entries.set(id, entry);

		if (entry.ttl > 0 && !archived) {
			entry.timer = setTimeout(() => expire(id), entry.ttl * 1000);
		}
		if (!silent) scrollToEnd();
		return entry;
	}

	function expire(id) {
		const entry = entries.get(id);
		if (!entry) return;
		entry.row.remove();
		entries.delete(id);
		hooks.onExpire?.(id);
	}

	const get = (id) => entries.get(id) || null;

	function edit(id, text) {
		const entry = entries.get(id);
		if (!entry || entry.node || entry.deleted) return false;
		entry.text = String(text);
		entry.edited = true;
		renderBody(entry);
		renderFoot(entry);
		return true;
	}

	function markDeleted(id) {
		const entry = entries.get(id);
		if (!entry) return false;
		clearTimeout(entry.timer);
		entry.deleted = true;
		entry.node = null;
		entry.text = "";
		entry.reactions = { me: null, them: null };
		entry.bubble.querySelector(".pp-quote")?.remove();
		renderBody(entry);
		renderFoot(entry);
		renderReactions(entry);
		closeActions();
		return true;
	}

	function setReaction(id, who, emoji) {
		const entry = entries.get(id);
		if (!entry || entry.deleted || !isValidReaction(emoji)) return false;
		entry.reactions[who] = emoji;
		renderReactions(entry);
		return true;
	}

	/** Statuses only ever move forward: sent -> delivered -> read. */
	function setStatus(id, status) {
		const entry = entries.get(id);
		if (!entry || entry.from !== "me" || !(status in STATUS_ORDER)) return false;
		if (STATUS_ORDER[status] <= STATUS_ORDER[entry.status]) return false;
		entry.status = status;
		renderFoot(entry);
		return true;
	}

	function system(message) {
		if (!container) return;
		const wrap = ppEl("div", "pp-system");
		wrap.appendChild(ppEl("span", "pp-system-pill", message));
		container.appendChild(wrap);
		scrollToEnd();
	}

	function divider(label, into = null) {
		if (!container) return;
		const wrap = ppEl("div", "pp-divider");
		wrap.appendChild(ppEl("span", "", label));
		(into || container).appendChild(wrap);
	}

	/** Inserts already-built rows above everything currently shown. */
	function prepend(fragment) {
		container?.prepend(fragment);
	}

	function setBlurred(on) {
		container?.classList.toggle("pp-blur", Boolean(on));
	}

	return {
		REACTIONS, ALLOWED_TTLS, init, reset, newId, isValidId, isValidTtl, isValidReaction,
		preview, add, prepend, get, edit, markDeleted, setReaction, setStatus, system, divider, scrollToEnd, setBlurred, closeActions,
	};
})();
