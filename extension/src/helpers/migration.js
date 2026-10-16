/**
 * Migration helpers for PLAN9.
 * ADR-0004: Migration is regular-context only
 * Shared-setting migration precedence: valid sync > valid local > default
 */

import { EMPTY_DISPLAY_STATE } from './display-state.js';
import { buildCanonicalUrls, canonicalizeImageUrl, extractImageId, isValidImageIdentity } from './image.js';

/**
 * Migrate a shared setting with precedence: sync > local > default.
 * @param {*} syncValue - Value from chrome.storage.sync
 * @param {*} localValue - Value from chrome.storage.local
 * @param {*} defaultValue - Default value
 * @param {Function} validator - Function to validate the value
 * @returns {*} Migrated value
 */
export function migrateSharedSetting(syncValue, localValue, defaultValue, validator) {
  // Valid sync value takes precedence
  if (syncValue !== undefined && syncValue !== null && validator(syncValue)) {
    return syncValue;
  }

  // Valid local value is fallback
  if (localValue !== undefined && localValue !== null && validator(localValue)) {
    return localValue;
  }

  // Default value as last resort
  return defaultValue;
}

/**
 * Validate a visibility or UHD setting, stored as the string "yes" or "no".
 * @param {*} value - Value to validate
 * @returns {boolean}
 */
export function validateYesNoSetting(value) {
  return value === 'yes' || value === 'no';
}

/**
 * Validate URL setting value.
 * Only absolute HTTPS URLs are accepted as qotd_url.
 * @param {*} value - Value to validate
 * @returns {boolean}
 */
export function validateUrlSetting(value) {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

// A non-empty list of engines, each with a name to switch by.
function isSearchEngineList(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every(engine => engine && typeof engine === 'object' && isNonEmptyString(engine.name));
}

/**
 * The shared product settings with their existing defaults, which mirror the
 * page defaults in scripts/base.js.
 */
export const SHARED_SETTINGS = Object.freeze({
  search_engine_list: {
    validate: isSearchEngineList,
    defaultValue: [
      { name: 'Bing', icon: 'icons/bing.png', action: 'https://bing.com/search', param_name: 'q', css_style: 'height: 50px;  margin: 10px;' },
      { name: 'Google', icon: 'icons/google.png', action: 'https://google.com/search', param_name: 'q', css_style: 'height: 40px; margin: 15px 10px;' }
    ]
  },
  current_search_engine: { validate: isNonEmptyString, defaultValue: 'Bing' },
  display_search_box: { validate: validateYesNoSetting, defaultValue: 'no' },
  show_top_sites: { validate: validateYesNoSetting, defaultValue: 'no' },
  show_clock: { validate: validateYesNoSetting, defaultValue: 'yes' },
  show_quote: { validate: validateYesNoSetting, defaultValue: 'yes' },
  enable_uhd_wallpaper: { validate: validateYesNoSetting, defaultValue: 'yes' },
  qotd_url: { validate: validateUrlSetting, defaultValue: '' }
});

/**
 * The value each shared setting should hold in sync storage: a valid sync
 * value, otherwise a valid local value, otherwise the default.
 *
 * @param {Object} syncItems - Shared settings read from chrome.storage.sync
 * @param {Object} localItems - Shared settings read from chrome.storage.local
 * @returns {Object} Setting key to intended sync value
 */
export function resolveSharedSettings(syncItems, localItems) {
  return Object.fromEntries(Object.entries(SHARED_SETTINGS).map(([key, { validate, defaultValue }]) =>
    [key, migrateSharedSetting(syncItems[key], localItems[key], structuredClone(defaultValue), validate)]));
}

/**
 * The v2 display state a migrating page builds from the verified catalog and
 * the retained legacy display inputs. The entry is found by the identity of
 * the legacy `wallpaper_url`; the legacy `wallpaper_date` is used only when
 * that URL has no identity. Without a matching entry the state is the
 * explicit empty one. The preview is left empty for the page to reconstruct.
 * The application time is unknown, so `updatedAt` is 0 and an earlier date
 * moves on to the day's wallpaper like any first new tab of a day (ADR-0016).
 *
 * @param {Object} catalog - Verified v2 catalog
 * @param {{wallpaperUrl?: string, wallpaperDate?: string}} legacy
 * @param {boolean} enableUhd - Final resolution when the legacy URL has none
 * @returns {Object} Display state
 */
export function buildMigratedDisplayState(catalog, { wallpaperUrl, wallpaperDate }, enableUhd) {
  const entries = catalog?.entries ?? {};
  const legacyId = extractImageId(wallpaperUrl);
  const entry = legacyId
    ? Object.values(entries).find(candidate => candidate?.imageId === legacyId)
    : entries[wallpaperDate];
  if (!entry || !isValidImageIdentity(entry.imageId)) {
    return { ...EMPTY_DISPLAY_STATE };
  }
  const urls = buildCanonicalUrls(entry.imageId);
  const legacyUrl = canonicalizeImageUrl(wallpaperUrl);
  const url = legacyUrl === urls.highDef || legacyUrl === urls.ultraHighDef
    ? legacyUrl
    : (enableUhd ? urls.ultraHighDef : urls.highDef);
  return { date: entry.date, imageId: entry.imageId, url, preloadDataUrl: '', updatedAt: 0 };
}
