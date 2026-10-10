import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  conflictsWithDisplayedIdentity,
  canAdmitStaleCandidate,
  isInRetentionSet,
  isGenerationValid
} from '../src/helpers/stale-work.js';

describe('Stale work helpers', () => {
  describe('conflictsWithDisplayedIdentity', () => {
    it('detects conflict when dates match but imageId differs', () => {
      const candidate = { date: '20260728', imageId: 'OHR.Test1' };
      const displayState = { date: '20260728', imageId: 'OHR.Test2' };
      assert.strictEqual(conflictsWithDisplayedIdentity(candidate, displayState), true);
    });

    it('returns false when dates differ', () => {
      const candidate = { date: '20260728', imageId: 'OHR.Test1' };
      const displayState = { date: '20260729', imageId: 'OHR.Test2' };
      assert.strictEqual(conflictsWithDisplayedIdentity(candidate, displayState), false);
    });

    it('returns false when imageId matches', () => {
      const candidate = { date: '20260728', imageId: 'OHR.Test' };
      const displayState = { date: '20260728', imageId: 'OHR.Test' };
      assert.strictEqual(conflictsWithDisplayedIdentity(candidate, displayState), false);
    });

    it('returns false with missing data', () => {
      assert.strictEqual(conflictsWithDisplayedIdentity(null, {}), false);
      assert.strictEqual(conflictsWithDisplayedIdentity({}, null), false);
    });
  });

  describe('canAdmitStaleCandidate', () => {
    it('rejects candidate conflicting with display identity', () => {
      const candidate = { date: '20260728', imageId: 'OHR.Test1' };
      const displayState = { date: '20260728', imageId: 'OHR.Test2' };
      assert.strictEqual(canAdmitStaleCandidate(candidate, null, displayState), false);
    });

    it('admits candidate when no current entry exists', () => {
      const candidate = { date: '20260727', imageId: 'OHR.Test' };
      const displayState = { date: '20260728', imageId: 'OHR.Display' };
      assert.strictEqual(canAdmitStaleCandidate(candidate, null, displayState), true);
    });

    it('admits candidate supplementing same date and imageId', () => {
      const candidate = { date: '20260728', imageId: 'OHR.Test', title: 'New' };
      const currentEntry = { date: '20260728', imageId: 'OHR.Test', title: 'Old' };
      const displayState = { date: '20260729', imageId: 'OHR.Display' };
      assert.strictEqual(canAdmitStaleCandidate(candidate, currentEntry, displayState), true);
    });

    it('rejects candidate trying to replace existing identity', () => {
      const candidate = { date: '20260728', imageId: 'OHR.Test1' };
      const currentEntry = { date: '20260728', imageId: 'OHR.Test2' };
      const displayState = { date: '20260729', imageId: 'OHR.Display' };
      assert.strictEqual(canAdmitStaleCandidate(candidate, currentEntry, displayState), false);
    });
  });

  describe('isInRetentionSet', () => {
    it('returns true when URL is in retention set', () => {
      const retentionSet = new Set(['https://example.com/image1.jpg', 'https://example.com/image2.jpg']);
      assert.strictEqual(isInRetentionSet('https://example.com/image1.jpg', retentionSet), true);
    });

    it('returns false when URL is not in retention set', () => {
      const retentionSet = new Set(['https://example.com/image1.jpg']);
      assert.strictEqual(isInRetentionSet('https://example.com/image2.jpg', retentionSet), false);
    });

    it('handles missing data', () => {
      assert.strictEqual(isInRetentionSet(null, new Set()), false);
      assert.strictEqual(isInRetentionSet('test', null), false);
    });
  });

  describe('isGenerationValid', () => {
    it('returns true when generations match', () => {
      assert.strictEqual(isGenerationValid(5, 5), true);
    });

    it('returns false when generations differ', () => {
      assert.strictEqual(isGenerationValid(5, 6), false);
    });
  });
});
