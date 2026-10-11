/**
 * Display state validation helpers for PLAN9.
 * Display state is one atomic snapshot: date, imageId, final URL, and preloadDataUrl.
 * ADR-0008: Page-owned display state and preview data URL.
 */

import { isValidCalendarDate } from './date.js';
import { buildCanonicalUrls, isValidImageIdentity } from './image.js';

// Callers must validate imageId first; buildCanonicalUrls throws on invalid identities.
function isValidFinalUrl(url, imageId) {
  const canonical = buildCanonicalUrls(imageId);
  return url === canonical.highDef || url === canonical.ultraHighDef;
}

function isValidPreviewDataUrl(value) {
  return value === '' || (
    typeof value === 'string' &&
    /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value)
  );
}

/**
 * Validate that a display-state snapshot is internally consistent.
 * The identity fields (date, imageId, url, preloadDataUrl) and numeric
 * application timestamp must form one snapshot; an explicitly empty
 * preloadDataUrl is valid.
 *
 * @param {Object} snapshot - Candidate display state snapshot
 * @returns {boolean} True if the snapshot is a valid atomic unit
 */
export function isValidDisplaySnapshot(snapshot) {
  if (!snapshot) {
    return false;
  }

  const { date, imageId, url, preloadDataUrl, updatedAt } = snapshot;

  if (!isValidCalendarDate(date)) {
    return false;
  }

  if (!isValidImageIdentity(imageId)) {
    return false;
  }

  if (!isValidFinalUrl(url, imageId)) {
    return false;
  }

  if (!isValidPreviewDataUrl(preloadDataUrl)) {
    return false;
  }

  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
    return false;
  }

  return true;
}

/**
 * Check whether a display snapshot matches a given identity.
 * Used by page callbacks to reject stale notifications.
 *
 * @param {Object} snapshot - Current display state
 * @param {string} date - Expected date
 * @param {string} imageId - Expected imageId
 * @returns {boolean}
 */
export function snapshotMatchesIdentity(snapshot, date, imageId) {
  if (!snapshot || !date || !imageId) {
    return false;
  }
  return snapshot.date === date && snapshot.imageId === imageId;
}

/**
 * Check whether a preloadDataUrl is consistent with the snapshot identity.
 * A non-empty data URL is only valid when it was derived from the same imageId.
 * An empty string is always consistent (explicitly cleared).
 *
 * @param {Object} snapshot - Display state snapshot
 * @param {string} previewImageId - imageId the data URL was derived from
 * @returns {boolean}
 */
export function isPreloadDataUrlConsistent(snapshot, previewImageId) {
  if (!snapshot) {
    return false;
  }

  // Empty string is always valid — the page explicitly cleared it
  if (snapshot.preloadDataUrl === '') {
    return true;
  }

  if (!isValidPreviewDataUrl(snapshot.preloadDataUrl)) {
    return false;
  }

  // Non-empty data URL must match the snapshot's own imageId
  return snapshot.imageId === previewImageId;
}
