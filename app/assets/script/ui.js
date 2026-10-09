/*
 * Tiny DOM helpers and a modal dialog. Everything is built with DOM APIs and
 * textContent, never innerHTML, so peer-supplied text can't inject markup.
 */
function ppEl(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined && text !== null) node.textContent = text;
	return node;
}

function ppIcon(name) {
	const i = document.createElement("i");
	i.className = `fas ${name}`;
	i.setAttribute("aria-hidden", "true");
	return i;
}

function ppButton(label, kind = "ghost", icon) {
	const btn = ppEl("button", `pp-btn pp-btn--${kind}`);
	btn.type = "button";
	if (icon) btn.appendChild(ppIcon(icon));
	btn.appendChild(document.createTextNode(label));
	return btn;
}

/**
 * Opens a modal. `actions`: [{ label, kind, icon, onClick(ctl), keepOpen }].
 * onClick may be async; throwing keeps the dialog open. Returns { close, root, setBusy }.
 */
function ppModal({ title, body, actions = [], onClose }) {
	const previouslyFocused = document.activeElement;
	const backdrop = ppEl("div", "pp-modal-backdrop");
	const dialog = ppEl("div", "pp-modal");
	dialog.setAttribute("role", "dialog");
	dialog.setAttribute("aria-modal", "true");

	const head = ppEl("div", "pp-modal-head");
	const heading = ppEl("h2", "pp-modal-title", title);
	const closeBtn = ppEl("button", "pp-icon-btn");
	closeBtn.type = "button";
	closeBtn.setAttribute("aria-label", t("close"));
	closeBtn.appendChild(ppIcon("fa-xmark"));
	head.append(heading, closeBtn);

	const content = ppEl("div", "pp-modal-body");
	if (body) content.append(...(Array.isArray(body) ? body : [body]));

	dialog.append(head, content);

	const buttons = [];
	if (actions.length) {
		const foot = ppEl("div", "pp-modal-foot");
		for (const action of actions) {
			const btn = ppButton(action.label, action.kind || "ghost", action.icon);
			buttons.push(btn);
			btn.addEventListener("click", async () => {
				if (!action.onClick) return close();
				try {
					setBusy(true);
					await action.onClick(ctl);
					if (!action.keepOpen) close();
				} catch (err) {
					console.error(err);
				} finally {
					setBusy(false);
				}
			});
			foot.appendChild(btn);
		}
		dialog.appendChild(foot);
	}

	function setBusy(busy) {
		buttons.forEach((b) => (b.disabled = busy));
	}

	function onKey(e) {
		if (e.key === "Escape") {
			e.stopPropagation();
			close();
		}
	}

	function close() {
		document.removeEventListener("keydown", onKey, true);
		backdrop.remove();
		if (previouslyFocused?.focus) previouslyFocused.focus();
		if (onClose) onClose();
	}

	const ctl = { close, root: dialog, content, setBusy };
	closeBtn.addEventListener("click", close);
	backdrop.addEventListener("mousedown", (e) => {
		if (e.target === backdrop) close();
	});
	document.addEventListener("keydown", onKey, true);

	backdrop.appendChild(dialog);
	document.body.appendChild(backdrop);
	dialog.querySelector("input, button.pp-btn--primary, button")?.focus();
	return ctl;
}

/** Promise-based confirm dialog. */
function ppConfirm({ title, message, confirmLabel, cancelLabel, danger = false }) {
	return new Promise((resolve) => {
		let settled = false;
		const done = (value) => {
			if (!settled) {
				settled = true;
				resolve(value);
			}
		};
		ppModal({
			title,
			body: ppEl("p", "pp-modal-text", message),
			actions: [
				{ label: cancelLabel || t("cancel"), kind: "ghost", onClick: () => done(false) },
				{ label: confirmLabel || t("confirm"), kind: danger ? "danger" : "primary", onClick: () => done(true) },
			],
			onClose: () => done(false),
		});
	});
}

/** Labelled form field helper: returns { wrap, input }. */
function ppField(labelText, { type = "text", placeholder = "", autocomplete = "off" } = {}) {
	const wrap = ppEl("label", "pp-field");
	wrap.appendChild(ppEl("span", "pp-field-label", labelText));
	const input = ppEl("input", "pp-input");
	input.type = type;
	input.placeholder = placeholder;
	input.autocomplete = autocomplete;
	wrap.appendChild(input);
	return { wrap, input };
}
