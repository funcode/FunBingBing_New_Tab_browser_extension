import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isValidDisplaySnapshot,
  snapshotMatchesIdentity,
  isPreloadDataUrlConsistent
} from '../src/helpers/display-state.js';

const imageId = 'OHR.Test_ZH-CN123';
const finalUrl = `https://ts1.tc.mm.bing.net/th?id=${imageId}_1920x1080.jpg`;

describe('Display state helpers', () => {
  describe('isValidDisplaySnapshot', () => {
    it('accepts a fully populated valid snapshot', () => {
      assert.strictEqual(isValidDisplaySnapshot({
        date: '20260728', imageId, url: finalUrl,
        preloadDataUrl: 'data:image/jpeg;base64,abc', updatedAt: 123
      }), true);
    });

    it('accepts an explicitly empty preview', () => {
      assert.strictEqual(isValidDisplaySnapshot({
        date: '20260728', imageId, url: finalUrl,
        preloadDataUrl: '', updatedAt: 123
      }), true);
    });

    it('rejects impossible dates, mismatched identities, invalid preview values, and missing timestamps', () => {
      const base = { date: '20260728', imageId, url: finalUrl, preloadDataUrl: '', updatedAt: 123 };
      assert.strictEqual(isValidDisplaySnapshot({ ...base, date: '20260229' }), false);
      assert.strictEqual(isValidDisplaySnapshot({ ...base, url: finalUrl.replace(imageId, 'OHR.Other_ZH-CN456') }), false);
      assert.strictEqual(isValidDisplaySnapshot({ ...base, preloadDataUrl: 42 }), false);
      assert.strictEqual(isValidDisplaySnapshot({ ...base, updatedAt: undefined }), false);
      assert.strictEqual(isValidDisplaySnapshot({ ...base, updatedAt: '123' }), false);
    });

    it('rejects non-canonical or incomplete snapshots', () => {
      assert.strictEqual(isValidDisplaySnapshot({ date: '20260728', imageId, url: '', preloadDataUrl: '', updatedAt: 1 }), false);
      assert.strictEqual(isValidDisplaySnapshot({ date: '20260728', imageId: 'invalid', url: finalUrl, preloadDataUrl: '', updatedAt: 1 }), false);
      assert.strictEqual(isValidDisplaySnapshot(null), false);
      assert.strictEqual(isValidDisplaySnapshot({ date: '20260728', imageId, url: `${finalUrl}&rf=x`, preloadDataUrl: '', updatedAt: 1 }), false);
    });
  });

  describe('snapshotMatchesIdentity', () => {
    it('matches both date and imageId', () => {
      assert.strictEqual(snapshotMatchesIdentity({ date: '20260728', imageId }, '20260728', imageId), true);
      assert.strictEqual(snapshotMatchesIdentity({ date: '20260728', imageId }, '20260729', imageId), false);
      assert.strictEqual(snapshotMatchesIdentity({ date: '20260728', imageId }, '20260728', 'OHR.Other'), false);
      assert.strictEqual(snapshotMatchesIdentity(null, '20260728', imageId), false);
    });
  });

  describe('isPreloadDataUrlConsistent', () => {
    it('accepts empty or matching previews and rejects mismatches/non-data values', () => {
      assert.strictEqual(isPreloadDataUrlConsistent({ imageId, preloadDataUrl: '' }, 'OHR.Other'), true);
      assert.strictEqual(isPreloadDataUrlConsistent({ imageId, preloadDataUrl: 'data:image/jpeg;base64,abc' }, imageId), true);
      assert.strictEqual(isPreloadDataUrlConsistent({ imageId: 'OHR.New', preloadDataUrl: 'data:image/jpeg;base64,abc' }, 'OHR.Old'), false);
      assert.strictEqual(isPreloadDataUrlConsistent({ imageId, preloadDataUrl: 42 }, imageId), false);
      assert.strictEqual(isPreloadDataUrlConsistent(null, imageId), false);
    });
  });
});
