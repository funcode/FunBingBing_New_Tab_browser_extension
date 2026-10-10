/**
 * Quote lease helpers for PLAN9.
 * Quote leases last 60 seconds, use crypto.randomUUID(), and reject expired or replaced tokens.
 */

const LEASE_DURATION_MS = 60 * 1000; // 60 seconds

/**
 * Create a new quote lease.
 * @param {Function} uuidGenerator - Function that generates UUIDs (e.g., crypto.randomUUID)
 * @param {number} now - Current timestamp
 * @returns {{token: string, expiresAt: number}}
 */
export function createQuoteLease(uuidGenerator, now) {
  if (typeof uuidGenerator !== 'function') {
    throw new Error('uuidGenerator must be a function');
  }

  const token = uuidGenerator();
  return {
    token,
    expiresAt: now + LEASE_DURATION_MS
  };
}

/**
 * Validate a quote lease token.
 * @param {Object} lease - Current lease state
 * @param {string} submittedToken - Token being submitted
 * @param {number} now - Current timestamp
 * @returns {boolean} True if the token is valid and not expired
 */
export function validateQuoteLease(lease, submittedToken, now) {
  if (!lease || !lease.token || !submittedToken) {
    return false;
  }

  // Token must match
  if (lease.token !== submittedToken) {
    return false;
  }

  // Lease must not be expired
  if (now >= lease.expiresAt) {
    return false;
  }

  return true;
}

/**
 * Clear a quote lease.
 * @returns {null}
 */
export function clearQuoteLease() {
  return null;
}

/**
 * Check if a lease is expired.
 * @param {Object} lease - Lease to check
 * @param {number} now - Current timestamp
 * @returns {boolean}
 */
export function isLeaseExpired(lease, now) {
  if (!lease || !lease.expiresAt) {
    return true;
  }
  return now >= lease.expiresAt;
}
