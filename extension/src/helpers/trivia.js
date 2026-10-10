/**
 * Trivia helpers for PLAN9.
 * Trivia ID is the sole work identity; date only locates the catalog entry.
 */

/**
 * Validate that a YYYYMMDD string is a real calendar date.
 * @param {string} dateStr
 * @returns {boolean}
 */
function isValidCalendarDate(dateStr) {
  if (typeof dateStr !== 'string' || dateStr.length !== 8 || !/^\d{8}$/.test(dateStr)) {
    return false;
  }
  const year  = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10);
  const day   = parseInt(dateStr.slice(6, 8), 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Use UTC construction to avoid DST surprises
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  );
}

/**
 * Validate and normalize a trivia ID from Archive.
 * Archive trivia IDs must match exactly HPQuiz_<YYYYMMDD>_<slug> where the
 * date segment is a valid calendar date and the slug is non-empty.
 * Only the date segment is rewritten to match the IOTD isoDate.
 * Malformed, invalid-date, or ambiguous identifiers are rejected (null).
 *
 * @param {string} triviaId - Raw trivia ID from Archive
 * @param {string} targetIsoDate - Target IOTD isoDate (YYYYMMDD) to rewrite to
 * @returns {string|null} Normalized trivia ID or null if invalid
 */
export function normalizeTriviaId(triviaId, targetIsoDate) {
  if (!triviaId || typeof triviaId !== 'string') {
    return null;
  }

  // Must be exactly HPQuiz_<8digits>_<non-empty slug> with no extra digit groups
  // that could make the date segment ambiguous.
  const match = triviaId.match(/^HPQuiz_(\d{8})_([^_].*)$/);
  if (!match) {
    return null;
  }

  const [, originalDate, slug] = match;

  // Reject invalid calendar dates in the original ID
  if (!isValidCalendarDate(originalDate)) {
    return null;
  }

  // Reject invalid target dates too
  if (!isValidCalendarDate(targetIsoDate)) {
    return null;
  }

  return `HPQuiz_${targetIsoDate}_${slug}`;
}

/**
 * Check if trivia state should be reset due to identity change.
 * @param {string} oldTriviaId - Current trivia ID
 * @param {string} newTriviaId - New trivia ID
 * @returns {boolean} True if trivia state should be reset
 */
export function shouldResetTriviaState(oldTriviaId, newTriviaId) {
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
