import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createQuoteLease,
  validateQuoteLease,
  clearQuoteLease,
  isLeaseExpired
} from '../src/helpers/quote-lease.js';

describe('Quote lease helpers', () => {
  const mockUuidGenerator = () => 'test-uuid-12345';

  describe('createQuoteLease', () => {
    it('creates a lease with generated token and 60s expiry', () => {
      const now = 1000000;
      const lease = createQuoteLease(mockUuidGenerator, now);

      assert.strictEqual(lease.token, 'test-uuid-12345');
      assert.strictEqual(lease.expiresAt, now + 60000);
    });

    it('throws when uuidGenerator is not a function', () => {
      assert.throws(() => createQuoteLease(null, 1000), /must be a function/);
    });
  });

  describe('validateQuoteLease', () => {
    it('validates matching non-expired token', () => {
      const lease = { token: 'test-token', expiresAt: 2000 };
      assert.strictEqual(validateQuoteLease(lease, 'test-token', 1000), true);
    });

    it('rejects mismatched token', () => {
      const lease = { token: 'test-token', expiresAt: 2000 };
      assert.strictEqual(validateQuoteLease(lease, 'wrong-token', 1000), false);
    });

    it('rejects expired token', () => {
      const lease = { token: 'test-token', expiresAt: 1000 };
      assert.strictEqual(validateQuoteLease(lease, 'test-token', 1000), false);
      assert.strictEqual(validateQuoteLease(lease, 'test-token', 1001), false);
    });

    it('rejects missing lease', () => {
      assert.strictEqual(validateQuoteLease(null, 'test-token', 1000), false);
    });
  });

  describe('clearQuoteLease', () => {
    it('returns null', () => {
      assert.strictEqual(clearQuoteLease(), null);
    });
  });

  describe('isLeaseExpired', () => {
    it('returns true for expired lease', () => {
      const lease = { token: 'test', expiresAt: 1000 };
      assert.strictEqual(isLeaseExpired(lease, 1000), true);
      assert.strictEqual(isLeaseExpired(lease, 1001), true);
    });

    it('returns false for non-expired lease', () => {
      const lease = { token: 'test', expiresAt: 2000 };
      assert.strictEqual(isLeaseExpired(lease, 1000), false);
    });

    it('returns true for missing lease', () => {
      assert.strictEqual(isLeaseExpired(null, 1000), true);
      assert.strictEqual(isLeaseExpired({}, 1000), true);
    });
  });
});
