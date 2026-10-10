import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createRetryObject,
  recordFailure,
  resetRetry,
  isRetryEligible,
  canBypassWithReconnect,
  recordReconnectBypass,
  getRetryDelay
} from '../src/helpers/retry.js';

describe('Retry helpers', () => {
  describe('createRetryObject', () => {
    it('creates a fresh retry object with level 0', () => {
      const retry = createRetryObject();
      assert.strictEqual(retry.attemptedAt, 0);
      assert.strictEqual(retry.nextRetryAt, 0);
      assert.strictEqual(retry.retryLevel, 0);
      assert.strictEqual(retry.lastReconnectBypassAt, 0);
    });
  });

  describe('recordFailure', () => {
    it('advances to level 1 with 1-minute delay on first failure', () => {
      const retry = createRetryObject();
      const now = 1000000;
      const result = recordFailure(retry, now);

      assert.strictEqual(result.retryLevel, 1);
      assert.strictEqual(result.attemptedAt, now);
      assert.strictEqual(result.nextRetryAt, now + 60 * 1000); // 1 minute
    });

    it('follows bounded escalation: 1, 3, 5, 5 minutes', () => {
      let retry = createRetryObject();
      const now = 1000000;

      // First failure: 1 minute
      retry = recordFailure(retry, now);
      assert.strictEqual(retry.retryLevel, 1);
      assert.strictEqual(retry.nextRetryAt, now + 60 * 1000);

      // Second failure: 3 minutes
      retry = recordFailure(retry, now + 100000);
      assert.strictEqual(retry.retryLevel, 2);
      assert.strictEqual(retry.nextRetryAt, now + 100000 + 3 * 60 * 1000);

      // Third failure: 5 minutes
      retry = recordFailure(retry, now + 200000);
      assert.strictEqual(retry.retryLevel, 3);
      assert.strictEqual(retry.nextRetryAt, now + 200000 + 5 * 60 * 1000);

      // Fourth failure: still 5 minutes (saturated)
      retry = recordFailure(retry, now + 300000);
      assert.strictEqual(retry.retryLevel, 3); // Level stays at 3
      assert.strictEqual(retry.nextRetryAt, now + 300000 + 5 * 60 * 1000);
    });

    it('preserves lastReconnectBypassAt', () => {
      const retry = { ...createRetryObject(), lastReconnectBypassAt: 5000 };
      const result = recordFailure(retry, 10000);
      assert.strictEqual(result.lastReconnectBypassAt, 5000);
    });
  });

  describe('resetRetry', () => {
    it('resets all fields to zero', () => {
      const result = resetRetry();
      assert.strictEqual(result.attemptedAt, 0);
      assert.strictEqual(result.nextRetryAt, 0);
      assert.strictEqual(result.retryLevel, 0);
      assert.strictEqual(result.lastReconnectBypassAt, 0);
    });
  });

  describe('isRetryEligible', () => {
    it('returns true when nextRetryAt is 0', () => {
      const retry = createRetryObject();
      assert.strictEqual(isRetryEligible(retry, 1000), true);
    });

    it('returns true when backoff has expired', () => {
      const retry = { ...createRetryObject(), nextRetryAt: 1000 };
      assert.strictEqual(isRetryEligible(retry, 1000), true);
      assert.strictEqual(isRetryEligible(retry, 1001), true);
    });

    it('returns false when backoff is still active', () => {
      const retry = { ...createRetryObject(), nextRetryAt: 1000 };
      assert.strictEqual(isRetryEligible(retry, 999), false);
    });
  });

  describe('canBypassWithReconnect', () => {
    it('returns false when retry is already eligible', () => {
      const retry = { ...createRetryObject(), nextRetryAt: 1000 };
      assert.strictEqual(canBypassWithReconnect(retry, 1000, 1000), false);
    });

    it('returns true when backoff is active and reconnect is new', () => {
      const retry = { ...createRetryObject(), nextRetryAt: 2000, lastReconnectBypassAt: 0 };
      assert.strictEqual(canBypassWithReconnect(retry, 1000, 1500), true);
    });

    it('returns false when reconnect event was already used', () => {
      const retry = { ...createRetryObject(), nextRetryAt: 3000, lastReconnectBypassAt: 1500 };
      assert.strictEqual(canBypassWithReconnect(retry, 2000, 1500), false);
      assert.strictEqual(canBypassWithReconnect(retry, 2000, 1400), false);
    });

    it('returns true for a newer reconnect event', () => {
      const retry = { ...createRetryObject(), nextRetryAt: 3000, lastReconnectBypassAt: 1500 };
      assert.strictEqual(canBypassWithReconnect(retry, 2000, 2500), true);
    });
  });

  describe('recordReconnectBypass', () => {
    it('records the reconnect time', () => {
      const retry = createRetryObject();
      const result = recordReconnectBypass(retry, 5000);
      assert.strictEqual(result.lastReconnectBypassAt, 5000);
    });

    it('preserves other retry fields', () => {
      const retry = { ...createRetryObject(), retryLevel: 2, nextRetryAt: 10000 };
      const result = recordReconnectBypass(retry, 5000);
      assert.strictEqual(result.retryLevel, 2);
      assert.strictEqual(result.nextRetryAt, 10000);
    });
  });

  describe('getRetryDelay', () => {
    it('returns correct delays for each level', () => {
      assert.strictEqual(getRetryDelay(0), 60 * 1000); // 1 minute
      assert.strictEqual(getRetryDelay(1), 3 * 60 * 1000); // 3 minutes
      assert.strictEqual(getRetryDelay(2), 5 * 60 * 1000); // 5 minutes
      assert.strictEqual(getRetryDelay(3), 5 * 60 * 1000); // 5 minutes (saturated)
    });

    it('clamps to valid range', () => {
      assert.strictEqual(getRetryDelay(-1), 60 * 1000); // Clamped to level 0
      assert.strictEqual(getRetryDelay(10), 5 * 60 * 1000); // Clamped to level 3
    });
  });
});
