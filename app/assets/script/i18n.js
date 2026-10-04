/*
 * Shared i18n module (used by index.html and login.html).
 * All user-facing text lives in assets/config/translations.json.
 *
 * Markup:  data-i18n="key"             -> textContent
 *          data-i18n-placeholder="key" -> placeholder attribute
 *          data-i18n-aria="key"        -> aria-label attribute
 *          data-i18n-alt="key"         -> alt attribute
 *          data-i18n-vars='{"n":1}'    -> interpolation values for data-i18n
 * Code:    t("key", { name: "value" })  /  tList("key")  /  setLanguage("tr")
 */
const LANG_STORAGE_KEY = "p2p_current_lang";
const DEFAULT_LANG = "en";

let translations = {};
let currentLang = DEFAULT_LANG;

function detectLanguage() {
	const stored = localStorage.getItem(LANG_STORAGE_KEY);
	if (stored && translations[stored]) return stored;
	const browser = (navigator.language || "").slice(0, 2).toLowerCase();
	return translations[browser] ? browser : DEFAULT_LANG;
}

function interpolate(text, params) {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));
}

function hasTranslation(key) {
	return typeof translations[currentLang]?.[key] === "string";
}

function t(key, params) {
	const value = translations[currentLang]?.[key] ?? translations[DEFAULT_LANG]?.[key];
	return typeof value === "string" ? interpolate(value, params) : key;
}

function tList(key) {
	const value = translations[currentLang]?.[key] ?? translations[DEFAULT_LANG]?.[key];
	return Array.isArray(value) ? value : [];
}

function availableLanguages() {
	return Object.keys(translations).map((code) => ({ code, name: translations[code].lang_name || code }));
}

function getLanguage() {
	return currentLang;
}

function setLanguage(code) {
	if (!translations[code]) return;
	currentLang = code;
	localStorage.setItem(LANG_STORAGE_KEY, code);
	document.documentElement.lang = code;
	translatePage();
}

function translatePage(root = document) {
	root.querySelectorAll("[data-i18n]").forEach((el) => {
		let params;
		try {
			params = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined;
		} catch {
			params = undefined;
		}
		el.textContent = t(el.dataset.i18n, params);
	});
	root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
		el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
	});
	root.querySelectorAll("[data-i18n-alt]").forEach((el) => {
		el.setAttribute("alt", t(el.dataset.i18nAlt));
	});
	root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
		el.setAttribute("aria-label", t(el.dataset.i18nAria));
	});
}

const i18nReady = fetch("assets/config/translations.json")
	.then((res) => res.json())
	.then((data) => {
		translations = data;
		currentLang = detectLanguage();
		document.documentElement.lang = currentLang;
		translatePage();
	});
