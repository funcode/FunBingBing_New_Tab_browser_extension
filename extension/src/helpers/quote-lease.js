/**
 * Quote scrape lease helpers for PLAN9.
 *
 * One persisted lease state per context: `{date, token, leaseUntil}` plus
 * `retries`, an independent retry object (`retryLevel`, `nextRetryAt`,
 * `attemptedAt`, `lastReconnectBypassAt`) for each quote date still missing a
 * quote. A date that gains its quote or leaves the quote dates drops its
 * sequence, which resets it. Tokens are opaque: the worker's runtime adapter
 * generates them, so this module needs no crypto access and runs under Node
 * tests.
 */

import {
  canBypassWithReconnect,
  hasUnusedReconnectBypass,
  isRetryEligible,
  recordFailure,
  recordReconnectBypass
} from './retry.js';

export const QUOTE_SCRAPE_LEASE_MS = 60 * 1000;

export function hasActiveLease(state, now) {
  return Boolean(state?.token) && now < state.leaseUntil;
}

// The stored retry objects of the dates still missing a quote.
function retriesOf(state, missingDates) {
  const stored = state?.retries && typeof state.retries === 'object' ? state.retries : {};
  return Object.fromEntries(missingDates.filter(date => stored[date]).map(date => [date, stored[date]]));
}

// An expired window, or a reconnect bypass whose attempt has no result yet.
function isDue(retry, now) {
  return isRetryEligible(retry, now) || hasUnusedReconnectBypass(retry);
}

/**
 * Grant a 60-second lease for `date`, the latest quote date, when no lease is
 * active and the backoff window of at least one missing date has expired. A
 * reconnect may bypass one active window of each missing date; the bypass
 * keeps the level and stays usable until its attempt records a result.
 * generateToken is called only for a grant.
 *
 * @param {Object|null} stored - Persisted lease state
 * @param {string} date - Latest committed current/historical catalog date
 * @param {string[]} missingDates - Quote dates still missing a quote
 * @param {number} now
 * @param {() => string} generateToken
 * @param {number} [reconnectTime] - Time of the reconnect event, or 0
 * @returns {{granted: boolean, state: Object, dueDates?: string[]}} dueDates
 *   are the missing dates the granted lease attempts
 */
export function grantQuoteLease(stored, date, missingDates, now, generateToken, reconnectTime = 0) {
  if (hasActiveLease(stored, now)) {
    return { granted: false, state: stored };
  }
  const retries = retriesOf(stored, missingDates);
  const dueDates = [];
  for (const day of missingDates) {
    if (isDue(retries[day], now)) {
      dueDates.push(day);
    } else if (reconnectTime && canBypassWithReconnect(retries[day], now, reconnectTime)) {
      retries[day] = recordReconnectBypass(retries[day], reconnectTime);
      dueDates.push(day);
    }
  }
  if (dueDates.length === 0) {
    return { granted: false, state: stored };
  }
  return {
    granted: true,
    dueDates,
    state: { date, token: generateToken(), leaseUntil: now + QUOTE_SCRAPE_LEASE_MS, retries }
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
 * Record the result of a quote attempt. Each date still missing a quote whose
 * window had expired, or whose reconnect bypass was unused, backs off 1, 3, 5,
 * 5 minutes; a date inside its window keeps it; a filled date drops its
 * sequence.
 *
 * @param {Object} state - Persisted lease state
 * @param {string[]} missingDates - Quote dates still missing a quote
 * @param {number} now
 */
export function recordQuoteAttempt(state, missingDates, now) {
  const retries = retriesOf(state, missingDates);
  for (const day of missingDates) {
    if (isDue(retries[day], now)) {
      retries[day] = recordFailure(retries[day] ?? {}, now);
    }
  }
  return { ...state, retries };
}

/**
 * Clear the lease token. A date no longer missing a quote drops its sequence;
 * the others keep theirs.
 *
 * @param {Object} state - Persisted lease state
 * @param {string[]} missingDates - Quote dates still missing a quote
 */
export function releaseQuoteLease(state, missingDates) {
  return { ...state, token: '', leaseUntil: 0, retries: retriesOf(state, missingDates) };
}
