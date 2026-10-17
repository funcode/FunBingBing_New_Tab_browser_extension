/**
 * Quote scrape lease helpers for PLAN9.
 *
 * One persisted lease state per context: `{date, token, leaseUntil}` plus the
 * retry object of `date` (`retryLevel`, `nextRetryAt`, `attemptedAt`,
 * `lastReconnectBypassAt`); a new date starts a fresh sequence. Tokens are
 * opaque: the worker's runtime adapter generates them, so this module needs no
 * crypto access and runs under Node tests.
 */

import {
  canBypassWithReconnect,
  hasUnusedReconnectBypass,
  isRetryEligible,
  recordFailure,
  recordReconnectBypass,
  resetRetry
} from './retry.js';

export const QUOTE_SCRAPE_LEASE_MS = 60 * 1000;

function createLeaseState(date) {
  return { date, token: '', leaseUntil: 0, ...resetRetry() };
}

function hasActiveLease(state, now) {
  return Boolean(state?.token) && now < state.leaseUntil;
}

/**
 * Grant a 60-second lease for `date` when no lease is active and the date's
 * backoff window has expired. A reconnect may bypass one active window; the
 * bypass keeps the retry level and stays usable until its attempt records a
 * result. generateToken is called only for a grant.
 *
 * @param {Object|null} stored - Persisted lease state
 * @param {string} date - Latest committed current/historical catalog date
 * @param {number} now
 * @param {() => string} generateToken
 * @param {number} [reconnectTime] - Time of the reconnect event, or 0
 * @returns {{granted: boolean, state: Object}}
 */
export function grantQuoteLease(stored, date, now, generateToken, reconnectTime = 0) {
  if (hasActiveLease(stored, now)) {
    return { granted: false, state: stored };
  }
  let state = stored?.date === date ? stored : createLeaseState(date);
  if (!isRetryEligible(state, now) && !hasUnusedReconnectBypass(state)) {
    if (!reconnectTime || !canBypassWithReconnect(state, now, reconnectTime)) {
      return { granted: false, state };
    }
    state = recordReconnectBypass(state, reconnectTime);
  }
  return {
    granted: true,
    state: { ...state, token: generateToken(), leaseUntil: now + QUOTE_SCRAPE_LEASE_MS }
  };
}

/**
 * A submission is valid only for the stored date and exact token, before the
 * stored leaseUntil. Expired or replaced tokens are rejected.
 */
export function isValidQuoteSubmission(state, { date, token }, now) {
  return hasActiveLease(state, now) && state.date === date && state.token === token;
}

/**
 * Clear the lease after a submission. A successful one resets the retry
 * sequence; otherwise it advances 1, 3, 5, 5 minutes.
 *
 * @param {Object} state - Persisted lease state
 * @param {boolean} complete - Whether the submission filled the lease date's
 *   quote, or every quote date now has a quote
 * @param {number} now
 */
export function releaseQuoteLease(state, complete, now) {
  const released = { ...state, token: '', leaseUntil: 0 };
  return { ...released, ...(complete ? resetRetry() : recordFailure(state, now)) };
}
