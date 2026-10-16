import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  QUOTE_SCRAPE_LEASE_MS,
  grantQuoteLease,
  isValidQuoteSubmission,
  releaseQuoteLease
} from '../src/helpers/quote-lease.js';

const DATE = '20261015';
const MINUTE = 60 * 1000;

// Deterministic token generator that records how often it was called.
function tokens() {
  let count = 0;
  const generate = () => `token-${++count}`;
  generate.calls = () => count;
  return generate;
}

describe('Quote lease helpers', () => {
  describe('grantQuoteLease', () => {
    it('grants a 60-second lease with a generated token when none exists', () => {
      const generate = tokens();
      const { granted, state } = grantQuoteLease(null, DATE, 1000, generate);

      assert.strictEqual(granted, true);
      assert.deepStrictEqual(state, {
        date: DATE,
        token: 'token-1',
        leaseUntil: 1000 + QUOTE_SCRAPE_LEASE_MS,
        retryLevel: 0,
        nextRetryAt: 0,
        attemptedAt: 0,
        lastReconnectBypassAt: 0
      });
      assert.strictEqual(QUOTE_SCRAPE_LEASE_MS, 60 * 1000);
    });

    it('denies a lease while another is active, without generating a token', () => {
      const generate = tokens();
      const active = grantQuoteLease(null, DATE, 1000, generate).state;

      const denied = grantQuoteLease(active, DATE, 1000 + QUOTE_SCRAPE_LEASE_MS - 1, generate);

      assert.strictEqual(denied.granted, false);
      assert.strictEqual(generate.calls(), 1);
    });

    it('replaces an expired lease with a new token', () => {
      const generate = tokens();
      const expired = grantQuoteLease(null, DATE, 1000, generate).state;

      const { granted, state } = grantQuoteLease(expired, DATE, 1000 + QUOTE_SCRAPE_LEASE_MS, generate);

      assert.strictEqual(granted, true);
      assert.strictEqual(state.token, 'token-2');
    });

    it('denies a lease until the date-specific backoff window expires', () => {
      const generate = tokens();
      const backingOff = { date: DATE, token: '', leaseUntil: 0, retryLevel: 1, nextRetryAt: 5000, attemptedAt: 1000 };

      assert.strictEqual(grantQuoteLease(backingOff, DATE, 4999, generate).granted, false);
      assert.strictEqual(generate.calls(), 0);
      const { granted, state } = grantQuoteLease(backingOff, DATE, 5000, generate);
      assert.strictEqual(granted, true);
      assert.strictEqual(state.retryLevel, 1, 'a grant keeps the retry level');
    });

    it('lets one reconnect bypass the backoff window, keeping the level', () => {
      const generate = tokens();
      const backingOff = {
        date: DATE, token: '', leaseUntil: 0, retryLevel: 2, nextRetryAt: 500_000, attemptedAt: 1000, lastReconnectBypassAt: 0
      };

      const { granted, state } = grantQuoteLease(backingOff, DATE, 2000, generate, 2000);

      assert.strictEqual(granted, true);
      assert.deepStrictEqual(
        { retryLevel: state.retryLevel, nextRetryAt: state.nextRetryAt, lastReconnectBypassAt: state.lastReconnectBypassAt },
        { retryLevel: 2, nextRetryAt: 500_000, lastReconnectBypassAt: 2000 });
      // A duplicate reconnect signal while the bypassed lease is held grants nothing.
      assert.strictEqual(grantQuoteLease(state, DATE, 3000, generate, 3000).granted, false);
      // The failed bypassed attempt opens a new window at the next level.
      const failed = releaseQuoteLease(state, false, 4000);
      assert.strictEqual(failed.retryLevel, 3);
      assert.strictEqual(grantQuoteLease(failed, DATE, 4001, generate).granted, false);
      assert.strictEqual(grantQuoteLease(failed, DATE, 4002, generate, 4002).granted, true);
    });

    it('keeps an unused reconnect bypass until its attempt records a result', () => {
      const generate = tokens();
      const bypassed = grantQuoteLease(
        { date: DATE, token: '', leaseUntil: 0, retryLevel: 1, nextRetryAt: 500_000, attemptedAt: 1000, lastReconnectBypassAt: 0 },
        DATE, 2000, generate, 2000
      ).state;

      // The holder never submitted; its lease expired inside the same window.
      const { granted, state } = grantQuoteLease(bypassed, DATE, 2000 + QUOTE_SCRAPE_LEASE_MS, generate);

      assert.strictEqual(granted, true);
      assert.strictEqual(state.lastReconnectBypassAt, 2000);
    });

    it('starts a fresh retry sequence for a new date', () => {
      const backingOff = { date: '20261014', token: '', leaseUntil: 0, retryLevel: 3, nextRetryAt: 5000 };

      const { granted, state } = grantQuoteLease(backingOff, DATE, 1000, tokens());

      assert.strictEqual(granted, true);
      assert.deepStrictEqual({ date: state.date, retryLevel: state.retryLevel, nextRetryAt: state.nextRetryAt },
        { date: DATE, retryLevel: 0, nextRetryAt: 0 });
    });
  });

  describe('isValidQuoteSubmission', () => {
    const lease = { date: DATE, token: 'held', leaseUntil: 2000, retryLevel: 0, nextRetryAt: 0 };

    it('accepts the matching token and date before leaseUntil', () => {
      assert.strictEqual(isValidQuoteSubmission(lease, { date: DATE, token: 'held' }, 1999), true);
    });

    it('rejects a replaced token, another date, an expired lease or no lease', () => {
      assert.strictEqual(isValidQuoteSubmission(lease, { date: DATE, token: 'old' }, 1000), false);
      assert.strictEqual(isValidQuoteSubmission(lease, { date: '20261014', token: 'held' }, 1000), false);
      assert.strictEqual(isValidQuoteSubmission(lease, { date: DATE, token: 'held' }, 2000), false);
      assert.strictEqual(isValidQuoteSubmission(null, { date: DATE, token: 'held' }, 1000), false);
      assert.strictEqual(isValidQuoteSubmission({ ...lease, token: '' }, { date: DATE, token: '' }, 1000), false);
    });
  });

  describe('releaseQuoteLease', () => {
    it('clears the lease and resets the retry sequence when the quotes are complete', () => {
      const lease = { date: DATE, token: 'held', leaseUntil: 2000, retryLevel: 2, nextRetryAt: 900 };

      assert.deepStrictEqual(releaseQuoteLease(lease, true, 1000), {
        date: DATE, token: '', leaseUntil: 0, retryLevel: 0, nextRetryAt: 0, attemptedAt: 0, lastReconnectBypassAt: 0
      });
    });

    it('clears the lease and backs off 1, 3, 5, 5 minutes while quotes stay missing', () => {
      let state = { date: DATE, token: 'held', leaseUntil: 2000, retryLevel: 0, nextRetryAt: 0 };
      const delays = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        state = releaseQuoteLease({ ...state, token: 'held', leaseUntil: 2000 }, false, 1000);
        assert.strictEqual(state.token, '');
        assert.strictEqual(state.leaseUntil, 0);
        delays.push((state.nextRetryAt - 1000) / MINUTE);
      }
      assert.deepStrictEqual(delays, [1, 3, 5, 5]);
      assert.strictEqual(state.retryLevel, 3);
    });
  });
});
