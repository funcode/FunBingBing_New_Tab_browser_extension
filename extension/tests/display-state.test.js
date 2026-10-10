import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isValidDisplaySnapshot,
  snapshotMatchesIdentity,
  isPreloadDataUrlConsistent
} from '../src/helpers/display-state.js';

describe('Display state helpers', () => {
  describe('isValidDisplaySnapshot', () => {
    it('accepts a fully populated valid snapshot', () => {
      const snapshot = {
        date: '20260728',
        imageId: 'OHR.Test_ZH-CN123',
        url: 'https://ts1.tc.mm.bing.net/th?id=OHR.Test_ZH-CN123_1920x1080.jpg',
        preloadDataUrl: 'data:image/jpeg;base64,abc'
      };
      assert.strictEqual(isValidDisplaySnapshot(snapshot), true);
    });

    it('accepts a snapshot with empty preloadDataUrl — explicitly cleared is valid', () => {
      const snapshot = {
        date: '20260728',
        imageId: 'OHR.Test_ZH-CN123',
        url: 'https://example.com/img.jpg',
        preloadDataUrl: ''
      };
      assert.strictEqual(isValidDisplaySnapshot(snapshot), true);
    });

    it('rejects snapshot missing preloadDataUrl key entirely', () => {
      const snapshot = { date: '20260728', imageId: 'OHR.Test', url: 'https://example.com' };
      assert.strictEqual(isValidDisplaySnapshot(snapshot), false);
    });

    it('rejects snapshot with invalid date format', () => {
      const snapshot = { date: '2026-07-28', imageId: 'OHR.Test', url: 'https://x.com', preloadDataUrl: '' };
      assert.strictEqual(isValidDisplaySnapshot(snapshot), false);
    });

    it('rejects snapshot with imageId that does not start with OHR.', () => {
      const snapshot = { date: '20260728', imageId: 'invalid', url: 'https://x.com', preloadDataUrl: '' };
      assert.strictEqual(isValidDisplaySnapshot(snapshot), false);
    });

    it('rejects snapshot with empty url', () => {
      const snapshot = { date: '20260728', imageId: 'OHR.Test', url: '', preloadDataUrl: '' };
      assert.strictEqual(isValidDisplaySnapshot(snapshot), false);
    });

    it('rejects null', () => {
      assert.strictEqual(isValidDisplaySnapshot(null), false);
    });
  });

  describe('snapshotMatchesIdentity', () => {
    it('returns true when both date and imageId match', () => {
      const snapshot = { date: '20260728', imageId: 'OHR.Test' };
      assert.strictEqual(snapshotMatchesIdentity(snapshot, '20260728', 'OHR.Test'), true);
    });

    it('returns false when date differs', () => {
      const snapshot = { date: '20260728', imageId: 'OHR.Test' };
      assert.strictEqual(snapshotMatchesIdentity(snapshot, '20260729', 'OHR.Test'), false);
    });

    it('returns false when imageId differs', () => {
      const snapshot = { date: '20260728', imageId: 'OHR.Test' };
      assert.strictEqual(snapshotMatchesIdentity(snapshot, '20260728', 'OHR.Other'), false);
    });

    it('returns false for missing data', () => {
      assert.strictEqual(snapshotMatchesIdentity(null, '20260728', 'OHR.Test'), false);
    });
  });

  describe('isPreloadDataUrlConsistent', () => {
    it('accepts empty preloadDataUrl regardless of imageId', () => {
      const snapshot = { imageId: 'OHR.Test', preloadDataUrl: '' };
      assert.strictEqual(isPreloadDataUrlConsistent(snapshot, 'OHR.Other'), true);
    });

    it('accepts non-empty preloadDataUrl when imageIds match', () => {
      const snapshot = { imageId: 'OHR.Test', preloadDataUrl: 'data:image/jpeg;base64,abc' };
      assert.strictEqual(isPreloadDataUrlConsistent(snapshot, 'OHR.Test'), true);
    });

    it('rejects non-empty preloadDataUrl when imageId has changed', () => {
      const snapshot = { imageId: 'OHR.New', preloadDataUrl: 'data:image/jpeg;base64,abc' };
      assert.strictEqual(isPreloadDataUrlConsistent(snapshot, 'OHR.Old'), false);
    });

    it('returns false for null snapshot', () => {
      assert.strictEqual(isPreloadDataUrlConsistent(null, 'OHR.Test'), false);
    });
  });
});
