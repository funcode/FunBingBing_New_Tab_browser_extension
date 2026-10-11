import { addDays } from './date.js';
import { buildCanonicalUrls, isValidImageIdentity } from './image.js';

/**
 * Cache retention and cleanup helpers for PLAN9.
 * Regular context: 30 base keys + at most 2 display protection keys = 32 maximum.
 */

/**
 * Calculate the retention set of canonical URLs that should be kept.
 * Regular context: 30 base keys (15 dates × 2 resolutions) + up to 2 display protection keys.
 * Both display-protection keys are derived from the displayed identity (displayState.imageId),
 * not from the current catalog entry for the same date.
 *
 * @param {Object} catalog - Wallpaper catalog with entries
 * @param {Object} displayState - Current display state {date, imageId, url, preloadDataUrl}
 * @param {boolean} enableUhd - Whether UHD is enabled
 * @returns {Set<string>} Set of canonical URLs to retain
 */
export function calculateRetentionSet(catalog, displayState, enableUhd) {
  const retentionUrls = new Set();

  // Display protection: protect the two responses for the *displayed* identity.
  // Derive both keys from displayState.imageId, not from the catalog entry for that date,
  // so A's preview is protected even if the catalog entry for that date has become B.
  if (displayState && isValidImageIdentity(displayState.imageId)) {
    const urls = buildCanonicalUrls(displayState.imageId);
    retentionUrls.add(urls.preview);
    if (displayState.url === urls.highDef || displayState.url === urls.ultraHighDef) {
      retentionUrls.add(displayState.url);
    }
  }

  if (!catalog || !catalog.entries) {
    return retentionUrls;
  }

  // Navigation eligible: target + up to 7 historical. Future entries count toward base but
  // are not navigation-eligible. All together cap at 15 dates.
  const dates = Object.keys(catalog.entries).sort().reverse();
  const retainedDates = dates.slice(0, 15);

  // Add base keys: preview + configured final resolution for each date
  for (const date of retainedDates) {
    const entry = catalog.entries[date];
    if (!entry || !entry.urls) continue;

    if (entry.urls.preview) {
      retentionUrls.add(entry.urls.preview);
    }

    if (enableUhd && entry.urls.ultraHighDef) {
      retentionUrls.add(entry.urls.ultraHighDef);
    } else if (entry.urls.highDef) {
      retentionUrls.add(entry.urls.highDef);
    }
  }

  return retentionUrls;
}

/**
 * Calculate consecutive cached future depth.
 * Counts consecutive future dates from targetDate + 1 where both preview
 * and configured final resolution are cached.
 * Diagnostic only, ranges 0..7, never suppresses cache checks or prefetch.
 *
 * @param {Object} catalog - Wallpaper catalog
 * @param {string} targetDate - Current target date in YYYYMMDD
 * @param {Set<string>} cachedUrls - Set of cached URLs
 * @param {boolean} enableUhd - Whether UHD is enabled
 * @returns {number} Cached future depth (0-7)
 */
export function calculateCachedFutureDepth(catalog, targetDate, cachedUrls, enableUhd) {
  if (!catalog || !catalog.entries || !targetDate || !cachedUrls) {
    return 0;
  }

  let depth = 0;
  const maxDepth = 7;

  for (let i = 1; i <= maxDepth; i++) {
    const futureDate = addDays(targetDate, i);
    const entry = catalog.entries[futureDate];

    if (!entry || !entry.urls) {
      break;
    }

    const previewCached = entry.urls.preview && cachedUrls.has(entry.urls.preview);
    const finalUrl = enableUhd ? entry.urls.ultraHighDef : entry.urls.highDef;
    const finalCached = finalUrl && cachedUrls.has(finalUrl);

    if (previewCached && finalCached) {
      depth++;
    } else {
      break;
    }
  }

  return depth;
}

/**
 * Get the navigation-eligible dates from the catalog.
 * Navigation is restricted to real current and historical entries (targetDate and earlier).
 * Future preload entries are excluded from navigation.
 *
 * @param {Object} catalog - Wallpaper catalog
 * @param {string} targetDate - Current target date in YYYYMMDD
 * @returns {string[]} Dates eligible for navigation, newest first
 */
export function getNavigableDates(catalog, targetDate) {
  if (!catalog || !catalog.entries || !targetDate) {
    return [];
  }

  return Object.keys(catalog.entries)
    .filter(date => date <= targetDate)
    .sort()
    .reverse();
}

/**
 * Get the navigation index for a date in the catalog.
 * Navigation index is derived from the display date in the current real-time navigable array.
 * Future entries are excluded from navigation.
 *
 * @param {Object} catalog - Wallpaper catalog
 * @param {string} date - Date to find
 * @param {string} targetDate - Current target date in YYYYMMDD
 * @returns {number} Navigation index (0-based) or -1 if not found
 */
export function getNavigationIndex(catalog, date, targetDate) {
  if (!catalog || !catalog.entries || !date) {
    return -1;
  }

  const dates = getNavigableDates(catalog, targetDate || date);
  return dates.indexOf(date);
}

/**
 * Get the date at a navigation index.
 * @param {Object} catalog - Wallpaper catalog
 * @param {number} index - Navigation index (0-based)
 * @param {string} targetDate - Current target date in YYYYMMDD
 * @returns {string|null} Date at index or null
 */
export function getDateAtNavigationIndex(catalog, index, targetDate) {
  if (!catalog || !catalog.entries || index < 0) {
    return null;
  }

  const dates = getNavigableDates(catalog, targetDate || '99999999');
  return dates[index] || null;
}
