/**
 * Trivia helpers for PLAN9.
 * Trivia ID is the sole work identity; date only locates the catalog entry.
 */

/**
 * Validate and normalize a trivia ID from Archive.
 * Archive trivia IDs use the format HPQuiz_<YYYYMMDD>_<slug>.
 * Only the date segment is rewritten to match the IOTD isoDate.
 *
 * @param {string} triviaId - Raw trivia ID from Archive
 * @param {string} targetIsoDate - Target IOTD isoDate to rewrite to
 * @returns {string|null} Normalized trivia ID or null if invalid
 */
export function normalizeTriviaId(triviaId, targetIsoDate) {
  if (!triviaId || typeof triviaId !== 'string') {
    return null;
  }

  // Match HPQuiz_<YYYYMMDD>_<slug> pattern
  const match = triviaId.match(/^HPQuiz_(\d{8})_(.+)$/);
  if (!match) {
    return null; // Malformed, reject
  }

  const [, originalDate, slug] = match;

  // Rewrite the date segment to targetIsoDate
  return `HPQuiz_${targetIsoDate}_${slug}`;
}

/**
 * Check if trivia state should be reset due to identity change.
 * @param {string} oldTriviaId - Current trivia ID
 * @param {string} newTriviaId - New trivia ID
 * @returns {boolean} True if trivia state should be reset
 */
export function shouldResetTriviaState(oldTriviaId, newTriviaId) {
  // Changed triviaId rejects both success and failure results
  return oldTriviaId !== newTriviaId;
}

/**
 * Check if a trivia result can be admitted to an entry.
 * A changed triviaId rejects both success and failure results.
 * Refresh generation rollover alone does not reject an unchanged triviaId.
 *
 * @param {Object} entry - Catalog entry
 * @param {string} resultTriviaId - Trivia ID from the result
 * @returns {boolean} True if the result can be admitted
 */
export function canAdmitTriviaResult(entry, resultTriviaId) {
  if (!entry || !resultTriviaId) {
    return false;
  }

  // triviaId must match exactly
  return entry.triviaId === resultTriviaId;
}

/**
 * Create initial trivia state for an entry.
 * @returns {{triviaState: string, triviaAttemptedAt: number, triviaNextRetryAt: number, triviaRetryLevel: number}}
 */
export function createInitialTriviaState() {
  return {
    triviaState: 'missing',
    triviaAttemptedAt: 0,
    triviaNextRetryAt: 0,
    triviaRetryLevel: 0
  };
}

/**
 * Validate trivia state value.
 * Trivia state is never persisted as 'pending'.
 * @param {string} state - Trivia state
 * @returns {boolean}
 */
export function isValidTriviaState(state) {
  return state === 'missing' || state === 'complete';
}
