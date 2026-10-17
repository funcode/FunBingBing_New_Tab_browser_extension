import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  QUOTE_SCRAPE_LEASE_MS,
  grantQuoteLease,
  isValidQuoteSubmission,
  recordQuoteAttempt,
  releaseQuoteLease
} from '../src/helpers/quote-lease.js';

const DATE = '20261015';
const OLDER = '20261014';
const MINUTE = 60 * 1000;

// Deterministic token generator that records how often it was called.
function tokens() {
  let count = 0;
  const generate = () => `token-${++count}`;
  generate.calls = () => count;
  return generate;
}

const backingOff = (fields = {}) => ({ retryLevel: 1, nextRetryAt: 5000, attemptedAt: 1000, lastReconnectBypassAt: 0, ...fields });
const released = retries => ({ date: DATE, token: '', leaseUntil: 0, retries });

describe('Quote lease helpers', () => {
  describe('grantQuoteLease', () => {
    it('grants a 60-second lease with a generated token when none exists', () => {
      const generate = tokens();
      const { granted, state, dueDates } = grantQuoteLease(null, DATE, [DATE, OLDER], 1000, generate);

      assert.strictEqual(granted, true);
      assert.deepStrictEqual(dueDates, [DATE, OLDER]);
      assert.deepStrictEqual(state, { date: DATE, token: 'token-1', leaseUntil: 1000 + QUOTE_SCRAPE_LEASE_MS, retries: {} });
      assert.strictEqual(QUOTE_SCRAPE_LEASE_MS, 60 * 1000);
    });

    it('denies a lease while another is active, without generating a token', () => {
      const generate = tokens();
      const active = grantQuoteLease(null, DATE, [DATE], 1000, generate).state;

      const denied = grantQuoteLease(active, DATE, [DATE], 1000 + QUOTE_SCRAPE_LEASE_MS - 1, generate);

      assert.strictEqual(denied.granted, false);
      assert.strictEqual(generate.calls(), 1);
    });

    it('replaces an expired lease with a new token', () => {
      const generate = tokens();
      const expired = grantQuoteLease(null, DATE, [DATE], 1000, generate).state;

      const { granted, state } = grantQuoteLease(expired, DATE, [DATE], 1000 + QUOTE_SCRAPE_LEASE_MS, generate);

      assert.strictEqual(granted, true);
      assert.strictEqual(state.token, 'token-2');
    });

    it('denies a lease until a missing date leaves its own backoff window', () => {
      const generate = tokens();
      const stored = released({ [DATE]: backingOff() });

      assert.strictEqual(grantQuoteLease(stored, DATE, [DATE], 4999, generate).granted, false);
      assert.strictEqual(generate.calls(), 0);
      const { granted, state } = grantQuoteLease(stored, DATE, [DATE], 5000, generate);
      assert.strictEqual(granted, true);
      assert.strictEqual(state.retries[DATE].retryLevel, 1, 'a grant keeps the retry level');
    });

    it('grants a lease for an eligible historical date while the latest date backs off, attempting only that date', () => {
      const stored = released({ [DATE]: backingOff({ retryLevel: 3, nextRetryAt: 500_000 }) });

      const { granted, state, dueDates } = grantQuoteLease(stored, DATE, [DATE, OLDER], 2000, tokens());

      assert.strictEqual(granted, true);
      assert.strictEqual(state.date, DATE, 'the lease stays on the latest date');
      assert.deepStrictEqual(dueDates, [OLDER]);
      assert.deepStrictEqual(state.retries[DATE], stored.retries[DATE]);
    });

    it('lets one reconnect bypass each backoff window, keeping the level', () => {
      const generate = tokens();
      const stored = released({ [DATE]: backingOff({ retryLevel: 2, nextRetryAt: 500_000 }) });

      const { granted, state } = grantQuoteLease(stored, DATE, [DATE], 2000, generate, 2000);

      assert.strictEqual(granted, true);
      assert.deepStrictEqual(state.retries[DATE], backingOff({ retryLevel: 2, nextRetryAt: 500_000, lastReconnectBypassAt: 2000 }));
      // A duplicate reconnect signal while the bypassed lease is held grants nothing.
      assert.strictEqual(grantQuoteLease(state, DATE, [DATE], 3000, generate, 3000).granted, false);
      // The failed bypassed attempt opens a new window at the next level.
      const failed = releaseQuoteLease(recordQuoteAttempt(state, [DATE], 4000), [DATE]);
      assert.strictEqual(failed.retries[DATE].retryLevel, 3);
      assert.strictEqual(grantQuoteLease(failed, DATE, [DATE], 4001, generate).granted, false);
      assert.strictEqual(grantQuoteLease(failed, DATE, [DATE], 4002, generate, 4002).granted, true);
    });

    it('keeps an unused reconnect bypass until its attempt records a result', () => {
      const generate = tokens();
      const bypassed = grantQuoteLease(released({ [DATE]: backingOff({ nextRetryAt: 500_000 }) }), DATE, [DATE], 2000, generate, 2000).state;

      // The holder never submitted; its lease expired inside the same window.
      const { granted, state } = grantQuoteLease(bypassed, DATE, [DATE], 2000 + QUOTE_SCRAPE_LEASE_MS, generate);

      assert.strictEqual(granted, true);
      assert.strictEqual(state.retries[DATE].lastReconnectBypassAt, 2000);
    });

    it("keeps a historical date's sequence when a new latest date arrives, and drops the sequence of a filled or removed date", () => {
      const NEWER = '20261016';
      const stored = released({ [DATE]: backingOff({ retryLevel: 3 }), [OLDER]: backingOff({ retryLevel: 2 }) });

      const { granted, state, dueDates } = grantQuoteLease(stored, NEWER, [NEWER, OLDER], 2000, tokens());

      assert.strictEqual(granted, true);
      assert.deepStrictEqual(dueDates, [NEWER]);
      assert.deepStrictEqual(state.retries, { [OLDER]: stored.retries[OLDER] });
    });
  });

  describe('isValidQuoteSubmission', () => {
    const lease = { date: DATE, token: 'held', leaseUntil: 2000, retries: {} };

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

  describe('recordQuoteAttempt and releaseQuoteLease', () => {
    it('clears the lease and drops the sequences of dates that gained their quote', () => {
      const lease = { date: DATE, token: 'held', leaseUntil: 2000, retries: { [DATE]: backingOff({ retryLevel: 2 }) } };

      assert.deepStrictEqual(releaseQuoteLease(recordQuoteAttempt(lease, [], 1000), []), released({}));
    });

    it('backs each missing date off 1, 3, 5, 5 minutes on its own', () => {
      let state = { date: DATE, token: 'held', leaseUntil: 2000, retries: {} };
      const delays = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        const time = 1000 + attempt * 10 * MINUTE;
        state = releaseQuoteLease(recordQuoteAttempt({ ...state, token: 'held', leaseUntil: time + 1 }, [OLDER], time), [OLDER]);
        assert.strictEqual(state.token, '');
        assert.strictEqual(state.leaseUntil, 0);
        delays.push((state.retries[OLDER].nextRetryAt - time) / MINUTE);
      }
      assert.deepStrictEqual(delays, [1, 3, 5, 5]);
      assert.strictEqual(state.retries[OLDER].retryLevel, 3);
      assert.deepStrictEqual(Object.keys(state.retries), [OLDER], 'the lease date is not backed off for a historical miss');
    });

    it('leaves a missing date inside its window unchanged', () => {
      const waiting = backingOff({ nextRetryAt: 500_000 });
      const lease = { date: DATE, token: 'held', leaseUntil: 3000, retries: { [OLDER]: waiting } };

      const state = recordQuoteAttempt(lease, [DATE, OLDER], 2000);

      assert.deepStrictEqual(state.retries[OLDER], waiting);
      assert.strictEqual(state.retries[DATE].retryLevel, 1);
    });
  });
});
