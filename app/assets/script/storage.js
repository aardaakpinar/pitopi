/*
 * Shared browser storage layer.
 *
 * All persistent keys live in one namespace (`pitopi.*`) and are read through
 * this module, so the rest of the app never touches localStorage/sessionStorage
 * directly. Legacy keys from older releases are migrated once on startup.
 */

const StorageKeys = Object.freeze({
	session: "pitopi.session",
	deviceId: "pitopi.device-id",
	remotePeer: "pitopi.remote-peer",
	settings: "pitopi.settings",
});

const LegacyStorageKeys = Object.freeze({
	session: "pitopi_session",
	deviceId: "pitopi_device_id",
	remotePeer: "p2p_remote_id",
	language: "p2p_current_lang",
	history: "pp_history",
	receipts: "pp_receipts",
	blur: "pp_blur",
	hiddenFromSearch: "p2p_hidden",
});

// The old preference keys, folded into `pitopi.settings` on first load.
const LegacySettingsKeys = Object.freeze([
	LegacyStorageKeys.history,
	LegacyStorageKeys.receipts,
	LegacyStorageKeys.blur,
	LegacyStorageKeys.hiddenFromSearch,
	LegacyStorageKeys.language,
]);

// Removed in 1.2: an unused bearer id, a write-only profile cache and a flag
// that was never read.
const ObsoleteStorageKeys = Object.freeze(["pitopi_user_id", "p2p_pp_base64", "p2p_connection_status"]);

function createStorageArea(storage) {
	return {
		get(key, fallback = null) {
			const value = storage.getItem(key);
			return value === null ? fallback : value;
		},
		set(key, value) {
			storage.setItem(key, String(value));
		},
		remove(key) {
			storage.removeItem(key);
		},
		getJSON(key, fallback = null) {
			const raw = storage.getItem(key);
			if (raw === null) return fallback;
			try {
				return JSON.parse(raw);
			} catch {
				return fallback;
			}
		},
		setJSON(key, value) {
			storage.setItem(key, JSON.stringify(value));
		},
		clear() {
			storage.clear();
		},
	};
}

const AppStorage = Object.freeze({
	local: createStorageArea(localStorage),
	session: createStorageArea(sessionStorage),
});

/*
 * User preferences are stored as one versioned JSON object instead of a pile of
 * independent boolean keys. New preferences only need a default here.
 */
const SettingsStore = (() => {
	const VERSION = 1;
	const DEFAULTS = Object.freeze({
		version: VERSION,
		history: false,
		receipts: true,
		blur: false,
		hiddenFromSearch: false,
		language: "",
	});

	let cache = null;

	function normalize(value) {
		const source = value && typeof value === "object" ? value : {};
		return {
			version: VERSION,
			history: typeof source.history === "boolean" ? source.history : DEFAULTS.history,
			receipts: typeof source.receipts === "boolean" ? source.receipts : DEFAULTS.receipts,
			blur: typeof source.blur === "boolean" ? source.blur : DEFAULTS.blur,
			hiddenFromSearch: typeof source.hiddenFromSearch === "boolean" ? source.hiddenFromSearch : DEFAULTS.hiddenFromSearch,
			language: typeof source.language === "string" ? source.language : DEFAULTS.language,
		};
	}

	/** Reads the old boolean keys once and folds them into the new JSON record. */
	function migrateLegacySettings() {
		const legacy = {
			history: AppStorage.local.get(LegacyStorageKeys.history),
			receipts: AppStorage.local.get(LegacyStorageKeys.receipts),
			blur: AppStorage.local.get(LegacyStorageKeys.blur),
			hiddenFromSearch: AppStorage.local.get(LegacyStorageKeys.hiddenFromSearch),
			language: AppStorage.local.get(LegacyStorageKeys.language),
		};

		const settings = normalize({
			history: legacy.history === null ? DEFAULTS.history : legacy.history === "true",
			receipts: legacy.receipts === null ? DEFAULTS.receipts : legacy.receipts !== "false",
			blur: legacy.blur === null ? DEFAULTS.blur : legacy.blur === "true",
			hiddenFromSearch: legacy.hiddenFromSearch === null ? DEFAULTS.hiddenFromSearch : legacy.hiddenFromSearch === "true",
			language: legacy.language || DEFAULTS.language,
		});

		AppStorage.local.setJSON(StorageKeys.settings, settings);
		return settings;
	}

	function read() {
		if (cache) return { ...cache };
		const stored = AppStorage.local.getJSON(StorageKeys.settings, null);
		cache = stored ? normalize(stored) : migrateLegacySettings();
		return { ...cache };
	}

	function write(next) {
		cache = normalize(next);
		AppStorage.local.setJSON(StorageKeys.settings, cache);
		return { ...cache };
	}

	function update(patch) {
		return write({ ...read(), ...patch });
	}

	return Object.freeze({ defaults: DEFAULTS, read, write, update });
})();

/** Copies legacy values to their namespaced keys, then removes the old copies. */
function migrateLegacyStorage() {
	const localKeys = [
		[LegacyStorageKeys.session, StorageKeys.session],
		[LegacyStorageKeys.deviceId, StorageKeys.deviceId],
	];
	for (const [legacyKey, newKey] of localKeys) {
		const value = AppStorage.local.get(legacyKey);
		if (value === null) continue;
		if (AppStorage.local.get(newKey) === null) AppStorage.local.set(newKey, value);
		AppStorage.local.remove(legacyKey);
	}

	const remotePeer = AppStorage.session.get(LegacyStorageKeys.remotePeer);
	if (remotePeer !== null) {
		if (AppStorage.session.get(StorageKeys.remotePeer) === null) AppStorage.session.set(StorageKeys.remotePeer, remotePeer);
		AppStorage.session.remove(LegacyStorageKeys.remotePeer);
	}

	ObsoleteStorageKeys.forEach((key) => AppStorage.local.remove(key));
	SettingsStore.read();
	LegacySettingsKeys.forEach((key) => AppStorage.local.remove(key));
}

migrateLegacyStorage();
