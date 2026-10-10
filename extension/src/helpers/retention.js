/**
 * Cache retention and cleanup helpers for PLAN9.
 * Regular context: 30 base keys + at most 2 display protection keys = 32 maximum.
 */

/**
 * Calculate the retention set of canonical URLs that should be kept.
 * Regular context: 30 base keys (15 dates × 2 resolutions) + up to 2 display protection keys.
 *
 * @param {Object} catalog - Wallpaper catalog with entries
 * @param {Object} displayState - Current display state
 * @param {boolean} enableUhd - Whether UHD is enabled
 * @returns {Set<string>} Set of canonical URLs to retain
 */
export function calculateRetentionSet(catalog, displayState, enableUhd) {
  const retentionUrls = new Set();

  if (!catalog || !catalog.entries) {
    return retentionUrls;
  }

  // Get all dates sorted newest to oldest
  const dates = Object.keys(catalog.entries).sort().reverse();

  // Base retention: up to 15 dates (target + 7 historical + 7 future)
  const retainedDates = dates.slice(0, 15);

  // Add base keys: preview + configured final resolution for each date
  for (const date of retainedDates) {
    const entry = catalog.entries[date];
    if (!entry || !entry.urls) continue;

    // Always retain preview
    if (entry.urls.preview) {
      retentionUrls.add(entry.urls.preview);
    }

    // Retain configured final resolution
    if (enableUhd && entry.urls.ultraHighDef) {
      retentionUrls.add(entry.urls.ultraHighDef);
    } else if (entry.urls.highDef) {
      retentionUrls.add(entry.urls.highDef);
    }
  }

  // Display protection: add up to 2 additional keys from display state
  // if they're not already in the base retention set
  if (displayState && displayState.url) {
    retentionUrls.add(displayState.url);

    // If display state has a matching preview, protect it too
    const displayEntry = catalog.entries[displayState.date];
    if (displayEntry && displayEntry.urls && displayEntry.urls.preview) {
      retentionUrls.add(displayEntry.urls.preview);
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
      break; // Gap stops the count
    }

    // Check if both preview and configured final resolution are cached
    const previewCached = entry.urls.preview && cachedUrls.has(entry.urls.preview);
    const finalUrl = enableUhd ? entry.urls.ultraHighDef : entry.urls.highDef;
    const finalCached = finalUrl && cachedUrls.has(finalUrl);

    if (previewCached && finalCached) {
      depth++;
    } else {
      break; // Gap stops the count
    }
  }

  return depth;
}

/**
 * Get the navigation index for a date in the catalog.
 * Navigation index is derived from the display date in the current real-time array.
 *
 * @param {Object} catalog - Wallpaper catalog
 * @param {string} date - Date to find
 * @returns {number} Navigation index (0-based) or -1 if not found
 */
export function getNavigationIndex(catalog, date) {
  if (!catalog || !catalog.entries || !date) {
    return -1;
  }

  // Get all dates sorted newest to oldest (display order)
  const dates = Object.keys(catalog.entries).sort().reverse();
  return dates.indexOf(date);
}

/**
 * Get the date at a navigation index.
 * @param {Object} catalog - Wallpaper catalog
 * @param {number} index - Navigation index (0-based)
 * @returns {string|null} Date at index or null
 */
export function getDateAtNavigationIndex(catalog, index) {
  if (!catalog || !catalog.entries || index < 0) {
    return null;
  }

  const dates = Object.keys(catalog.entries).sort().reverse();
  return dates[index] || null;
}

/**
 * Add days to a YYYYMMDD date (helper for future depth calculation).
 * @param {string} dateStr - Date in YYYYMMDD format
 * @param {number} days - Number of days to add
 * @returns {string}
 */
function addDays(dateStr, days) {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);

  const date = new Date(Date.UTC(year, month, day));
  date.setUTCDate(date.getUTCDate() + days);

  const newYear = date.getUTCFullYear();
  const newMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const newDay = String(date.getUTCDate()).padStart(2, '0');

  return `${newYear}${newMonth}${newDay}`;
}

/**
 * Parse a YYYYMMDD date string to get year, month (0-11), and day.
 * @param {string} dateStr - Date in YYYYMMDD format
 * @returns {{year: number, month: number, day: number}}
 */
function parseDate(dateStr) {
  return {
    year: parseInt(dateStr.slice(0, 4), 10),
    month: parseInt(dateStr.slice(4, 6), 10) - 1,
    day: parseInt(dateStr.slice(6, 8), 10)
  };
}
