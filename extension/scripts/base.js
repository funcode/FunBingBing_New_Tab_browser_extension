const manifestData = chrome.runtime.getManifest();
const CURRENT_VERSION = manifestData.version;
const CURRENT_LOCALE = chrome.i18n.getMessage('@@ui_locale');
const CURRENT_BROWSER = "chrome";
const confCache = {};

const DEFAULT_SEARCH_ENGINES = Object.freeze([
    Object.freeze({
        name: "Bing",
        icon: "icons/bing.png",
        action: "https://bing.com/search",
        param_name: "q",
        css_style: "height: 50px;  margin: 10px;"
    }),
    Object.freeze({
        name: "Google",
        icon: "icons/google.png",
        action: "https://google.com/search",
        param_name: "q",
        css_style: "height: 40px; margin: 15px 10px;"
    })
]);

if (typeof globalThis !== "undefined") {
  globalThis.DEFAULT_SEARCH_ENGINES = DEFAULT_SEARCH_ENGINES;
}

// ---- helper funcs ----

// get current date string in yyyymmdd format
function getDateString() {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return "" + year + month + day;
}

// Shared product settings live in chrome.storage.sync (ADR-0009). Until the
// worker's migration has written one there, the local value applies, then the
// default: the same precedence the migration uses. Defaults are never written.
const SHARED_SETTING_DEFAULTS = Object.freeze({
    search_engine_list: DEFAULT_SEARCH_ENGINES,
    current_search_engine: "Bing",
    display_search_box: "no",
    show_top_sites: "no",
    show_clock: "yes",
    show_quote: "yes",
    enable_uhd_wallpaper: "yes",
    qotd_url: ""
});

function isSharedSetting(key) {
  return Object.hasOwn(SHARED_SETTING_DEFAULTS, key);
}

// Load everything from chrome.storage.local, and the shared settings from
// chrome.storage.sync, into memory at startup
async function initConfCache() {
  const [localItems, syncItems] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.sync.get(Object.keys(SHARED_SETTING_DEFAULTS))
  ]);
  Object.assign(confCache, localItems);
  for (const [key, defaultValue] of Object.entries(SHARED_SETTING_DEFAULTS)) {
    confCache[key] = syncItems[key] ?? localItems[key] ?? defaultValue;
  }
}

// Write: update memory + storage. Shared settings are written to sync.
async function writeConf(key, value) {
  confCache[key] = value;
  const area = isSharedSetting(key) ? chrome.storage.sync : chrome.storage.local;
  await area.set({ [key]: value });
}

// Read: return from memory (sync-like)
function readConf(key) {
  return confCache[key];
}

// Fresh read: bypass the in-memory cache for cross-context coordination.
async function readStorageKey(key) {
  const result = await chrome.storage.local.get(key);
  return result?.[key];
}

const confReadyPromise = (async () => {
  try {
    await initConfCache();
  } catch (err) {
    console.error("initConfCache failed:", err);
  }
})();

if (typeof window !== "undefined") {
  window.confReadyPromise = confReadyPromise;
}

// Optional: keep cache in sync if other parts of the extension change storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (isSharedSetting(key)) {
        confCache[key] = newValue ?? SHARED_SETTING_DEFAULTS[key];
      }
    }
  }
  if (area === "local") {
    for (const [key, { newValue }] of Object.entries(changes)) {
      // Local copies of shared settings are migration input only.
      if (isSharedSetting(key)) {
        continue;
      }
      if (newValue === undefined) {
        delete confCache[key]; // removed
      } else {
        confCache[key] = newValue; // updated
      }
    }
  }
});
