/**
 * Stale work and generation validation helpers for PLAN9.
 * Stale results may supplement the same date+imageId or add non-display history,
 * but cannot replace an existing identity or change the displayed date.
 */

/**
 * Check if a candidate entry conflicts with the displayed identity.
 * A stale candidate conflicting with the displayed identity is rejected in full.
 *
 * @param {Object} candidate - Candidate entry from stale work
 * @param {Object} displayState - Current display state
 * @returns {boolean} True if there's a conflict (should reject)
 */
export function conflictsWithDisplayedIdentity(candidate, displayState) {
  if (!candidate || !displayState) {
    return false;
  }

  // If dates match but imageId differs, it's a conflict
  if (candidate.date === displayState.date && candidate.imageId !== displayState.imageId) {
    return true;
  }

  return false;
}

/**
 * Check if a candidate can be admitted despite being from an old generation.
 * Old generation results can supplement the same date+imageId or add safe non-display history.
 *
 * @param {Object} candidate - Candidate entry
 * @param {Object} currentEntry - Current catalog entry for this date
 * @param {Object} displayState - Current display state
 * @returns {boolean} True if the candidate can be admitted
 */
export function canAdmitStaleCandidate(candidate, currentEntry, displayState) {
  if (!candidate) {
    return false;
  }

  // Check for display identity conflict first
  if (conflictsWithDisplayedIdentity(candidate, displayState)) {
    return false;
  }

  // If no current entry exists, candidate adds new non-display history
  if (!currentEntry) {
    return true;
  }

  // Candidate can supplement if it has the same date and imageId
  if (candidate.date === currentEntry.date && candidate.imageId === currentEntry.imageId) {
    return true;
  }

  // Otherwise, candidate tries to replace an existing identity - reject
  return false;
}

/**
 * Check if an image URL is still in the latest retention set.
 * Used to determine if a stale fetch response should be cached.
 *
 * @param {string} url - Canonical image URL
 * @param {Set<string>} retentionSet - Latest retention set
 * @returns {boolean}
 */
export function isInRetentionSet(url, retentionSet) {
  if (!url || !retentionSet) {
    return false;
  }
  return retentionSet.has(url);
}

/**
 * Validate that generation has not changed for a refresh operation.
 * @param {number} operationGeneration - Generation when operation started
 * @param {number} currentGeneration - Current refresh generation
 * @returns {boolean}
 */
export function isGenerationValid(operationGeneration, currentGeneration) {
  return operationGeneration === currentGeneration;
}
