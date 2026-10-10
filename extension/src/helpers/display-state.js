/**
 * Display state validation helpers for PLAN9.
 * Display state is one atomic snapshot: date, imageId, final URL, and preloadDataUrl.
 * ADR-0008: Page-owned display state and preview data URL.
 */

/**
 * Validate that a display-state snapshot is internally consistent.
 * All four identity fields (date, imageId, url, preloadDataUrl) must be
 * consistent — an explicitly empty preloadDataUrl is valid.
 *
 * @param {Object} snapshot - Candidate display state snapshot
 * @returns {boolean} True if the snapshot is a valid atomic unit
 */
export function isValidDisplaySnapshot(snapshot) {
  if (!snapshot) {
    return false;
  }

  const { date, imageId, url } = snapshot;

  // date must be a YYYYMMDD string
  if (typeof date !== 'string' || !/^\d{8}$/.test(date)) {
    return false;
  }

  // imageId must be a non-empty OHR identity
  if (typeof imageId !== 'string' || !imageId.startsWith('OHR.')) {
    return false;
  }

  // url must be a non-empty string (canonical or legacy — caller owns canonicality)
  if (typeof url !== 'string' || !url) {
    return false;
  }

  // preloadDataUrl must be present as a key (may be empty string — that is valid)
  if (!('preloadDataUrl' in snapshot)) {
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

  // Non-empty data URL must match the snapshot's own imageId
  return snapshot.imageId === previewImageId;
}
