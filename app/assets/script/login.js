/*
 * Login / signup page logic. Kept in an external file (no inline <script>)
 * so the Content-Security-Policy can forbid inline script execution.
 */
const SESSION_KEY = "pitopi_session";
const LEGACY_KEY = "pitopi_user_id"; // pre-1.1 bearer id, now meaningless

// Must match KEY_FILE_SIZE on the server: 4-byte magic + 1-byte
// version + 64-byte token + 32-byte salt.
const EXPECTED_KEY_FILE_SIZE = 101;

localStorage.removeItem(LEGACY_KEY);
document.getElementById("left-lead").dataset.i18nVars = JSON.stringify({ size: EXPECTED_KEY_FILE_SIZE });

if (localStorage.getItem(SESSION_KEY)) {
	window.location.href = "/";
}

const ICON_ATTRS = 'class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICONS = {
	spin: `<svg ${ICON_ATTRS.replace('class="btn-icon"', 'class="btn-icon spin"')}><path d="M21 12a9 9 0 11-6.2-8.55"/></svg>`,
	check: `<svg ${ICON_ATTRS}><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
	download: `<svg ${ICON_ATTRS}><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>`,
};

// Static trusted icon markup + text node: translated text is never parsed as HTML.
function setButton(btn, icon, text) {
	btn.innerHTML = icon;
	btn.append(document.createTextNode(text));
}

// Maps a server error payload ({ error, params }) to a translated message
function serverErrorText(data) {
	const key = `server_${data?.error}`;
	return hasTranslation(key) ? t(key, data.params) : t("server_invalid_key");
}

function switchTab(tab) {
	const loginPanel = document.getElementById("login-panel");
	const signupPanel = document.getElementById("signup-panel");
	const loginBtn = document.getElementById("tab-login");
	const signupBtn = document.getElementById("tab-signup");

	if (tab === "login") {
		loginPanel.style.display = "block";
		signupPanel.style.display = "none";
		loginBtn.className = "tab-btn active";
		signupBtn.className = "tab-btn inactive";
	} else {
		loginPanel.style.display = "none";
		signupPanel.style.display = "block";
		signupBtn.className = "tab-btn active";
		loginBtn.className = "tab-btn inactive";
	}
}

// Tab buttons (previously inline onclick="switchTab(...)")
document.querySelectorAll("[data-tab]").forEach((el) => el.addEventListener("click", () => switchTab(el.dataset.tab)));

document.getElementById("token-file").addEventListener("change", function () {
	const file = this.files[0];
	const label = document.getElementById("file-label");
	const zone = document.getElementById("upload-zone");
	const btn = document.getElementById("login-btn");
	if (file) {
		label.textContent = file.name;
		label.classList.add("selected");
		zone.classList.add("active");
		btn.disabled = false;
	}
});

document.getElementById("login-btn").addEventListener("click", async () => {
	const fileInput = document.getElementById("token-file");
	const errorEl = document.getElementById("login-error");
	const btnEl = document.getElementById("login-btn");
	const file = fileInput.files[0];
	if (!file) return;

	if (file.size !== EXPECTED_KEY_FILE_SIZE) {
		errorEl.textContent = t("server_invalid_key");
		errorEl.style.display = "block";
		return;
	}

	btnEl.disabled = true;
	btnEl.textContent = t("login_signing_in");
	errorEl.style.display = "none";

	try {
		const formData = new FormData();
		formData.append("file", file);
		const res = await fetch("/login", { method: "POST", body: formData });
		const data = await res.json();

		if (!data.success || typeof data.sessionToken !== "string") {
			errorEl.textContent = serverErrorText(data);
			errorEl.style.display = "block";
			btnEl.disabled = false;
			btnEl.textContent = t("login_button");
			return;
		}

		localStorage.setItem(SESSION_KEY, data.sessionToken);
		window.location.href = "/";
	} catch (err) {
		errorEl.textContent = t("connection_error", { error: err.message });
		errorEl.style.display = "block";
		btnEl.disabled = false;
		btnEl.textContent = t("login_button");
	}
});

document.getElementById("signup-btn").addEventListener("click", async () => {
	const btn = document.getElementById("signup-btn");
	btn.disabled = true;
	setButton(btn, ICONS.spin, t("signup_generating"));
	try {
		const res = await fetch("/signup", { method: "POST" });
		if (!res.ok) throw new Error("Server returned " + res.status);
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const disp = res.headers.get("Content-Disposition") || "";
		const match = disp.match(/filename="([^"]+)"/);
		const filename = match ? match[1] : `${Date.now()}.key`;
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
		setButton(btn, ICONS.check, t("signup_done"));
		setTimeout(() => {
			setButton(btn, ICONS.download, t("signup_download"));
			btn.disabled = false;
			switchTab("login");
		}, 2000);
	} catch (err) {
		setButton(btn, ICONS.download, t("signup_download"));
		btn.disabled = false;
		alert(t("signup_failed", { error: err.message }));
	}
});
