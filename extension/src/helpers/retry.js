/**
 * Bounded escalating retry backoff helpers for PLAN9.
 * ADR-0010: Bounded escalating retry backoff
 *
 * Consecutive failures use 1, 3, 5, 5 minutes.
 * Success resets the retry level and timestamp.
 */

// Retry delays in milliseconds
const RETRY_DELAYS = [
  60 * 1000,      // Level 0: 1 minute
  3 * 60 * 1000,  // Level 1: 3 minutes
  5 * 60 * 1000,  // Level 2: 5 minutes
  5 * 60 * 1000   // Level 3+: 5 minutes (saturated)
];

const MAX_RETRY_LEVEL = 3;

/**
 * Create a fresh retry object.
 * @returns {{attemptedAt: number, nextRetryAt: number, retryLevel: number, lastReconnectBypassAt: number}}
 */
export function createRetryObject() {
  return {
    attemptedAt: 0,
    nextRetryAt: 0,
    retryLevel: 0,
    lastReconnectBypassAt: 0
  };
}

/**
 * Record a failure and advance the retry level.
 * @param {Object} retryObj - Current retry object
 * @param {number} now - Current timestamp
 * @returns {Object} Updated retry object
 */
export function recordFailure(retryObj, now) {
  const newLevel = Math.min((retryObj.retryLevel || 0) + 1, MAX_RETRY_LEVEL);
  const delay = RETRY_DELAYS[newLevel - 1] || RETRY_DELAYS[MAX_RETRY_LEVEL - 1];

  return {
    attemptedAt: now,
    nextRetryAt: now + delay,
    retryLevel: newLevel,
    lastReconnectBypassAt: retryObj.lastReconnectBypassAt || 0
  };
}

/**
 * Reset retry state after success.
 * @returns {Object} Reset retry object
 */
export function resetRetry() {
  return {
    attemptedAt: 0,
    nextRetryAt: 0,
    retryLevel: 0,
    lastReconnectBypassAt: 0
  };
}

/**
 * Check if a retry is eligible (backoff has expired).
 * @param {Object} retryObj - Retry object
 * @param {number} now - Current timestamp
 * @returns {boolean}
 */
export function isRetryEligible(retryObj, now) {
  if (!retryObj || retryObj.nextRetryAt === 0) {
    return true;
  }
  return now >= retryObj.nextRetryAt;
}

/**
 * Check if reconnect bypass is available for this retry object.
 * A reconnect event can bypass one active backoff window per retry object.
 *
 * @param {Object} retryObj - Retry object
 * @param {number} now - Current timestamp
 * @param {number} reconnectTime - Time of the reconnect event
 * @returns {boolean} True if bypass is allowed
 */
export function canBypassWithReconnect(retryObj, now, reconnectTime) {
  if (!retryObj || isRetryEligible(retryObj, now)) {
    // Already eligible, no bypass needed
    return false;
  }

  // Check if this reconnect event hasn't been used for this retry object yet
  const lastBypass = retryObj.lastReconnectBypassAt || 0;
  return reconnectTime > lastBypass;
}

/**
 * Mark that a reconnect bypass was used.
 * @param {Object} retryObj - Retry object
 * @param {number} reconnectTime - Time of the reconnect event
 * @returns {Object} Updated retry object with bypass recorded
 */
export function recordReconnectBypass(retryObj, reconnectTime) {
  return {
    ...retryObj,
    lastReconnectBypassAt: reconnectTime
  };
}

/**
 * Get the next retry delay for the current level.
 * @param {number} level - Retry level (0-3)
 * @returns {number} Delay in milliseconds
 */
export function getRetryDelay(level) {
  const clampedLevel = Math.min(Math.max(0, level), MAX_RETRY_LEVEL);
  return RETRY_DELAYS[clampedLevel] || RETRY_DELAYS[MAX_RETRY_LEVEL - 1];
}
