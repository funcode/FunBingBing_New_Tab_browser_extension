import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateRetentionSet,
  calculateCachedFutureDepth,
  getNavigationIndex,
  getDateAtNavigationIndex
} from '../src/helpers/retention.js';

describe('Retention helpers', () => {
  describe('calculateRetentionSet', () => {
    it('retains preview + HD for each date when UHD disabled', () => {
      const catalog = {
        entries: {
          '20260728': {
            urls: {
              preview: 'https://example.com/preview1.jpg',
              highDef: 'https://example.com/hd1.jpg',
              ultraHighDef: 'https://example.com/uhd1.jpg'
            }
          },
          '20260727': {
            urls: {
              preview: 'https://example.com/preview2.jpg',
              highDef: 'https://example.com/hd2.jpg',
              ultraHighDef: 'https://example.com/uhd2.jpg'
            }
          }
        }
      };

      const retentionSet = calculateRetentionSet(catalog, null, false);

      assert.strictEqual(retentionSet.has('https://example.com/preview1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/hd1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/uhd1.jpg'), false);
      assert.strictEqual(retentionSet.has('https://example.com/preview2.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/hd2.jpg'), true);
    });

    it('retains preview + UHD for each date when UHD enabled', () => {
      const catalog = {
        entries: {
          '20260728': {
            urls: {
              preview: 'https://example.com/preview1.jpg',
              highDef: 'https://example.com/hd1.jpg',
              ultraHighDef: 'https://example.com/uhd1.jpg'
            }
          }
        }
      };

      const retentionSet = calculateRetentionSet(catalog, null, true);

      assert.strictEqual(retentionSet.has('https://example.com/preview1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/uhd1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/hd1.jpg'), false);
    });

    it('limits to 15 dates maximum (30 base keys)', () => {
      const entries = {};
      for (let i = 0; i < 20; i++) {
        const date = `202607${String(28 - i).padStart(2, '0')}`;
        entries[date] = {
          urls: {
            preview: `https://example.com/preview${i}.jpg`,
            highDef: `https://example.com/hd${i}.jpg`
          }
        };
      }

      const catalog = { entries };
      const retentionSet = calculateRetentionSet(catalog, null, false);

      // 15 dates × 2 URLs = 30 keys
      assert.strictEqual(retentionSet.size, 30);
    });

    it('adds display protection keys', () => {
      const catalog = {
        entries: {
          '20260728': {
            urls: {
              preview: 'https://example.com/preview1.jpg',
              highDef: 'https://example.com/hd1.jpg'
            }
          }
        }
      };

      const displayState = {
        date: '20260728',
        url: 'https://example.com/hd1.jpg'
      };

      const retentionSet = calculateRetentionSet(catalog, displayState, false);

      // Should include the display URL and its preview
      assert.strictEqual(retentionSet.has('https://example.com/hd1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/preview1.jpg'), true);
    });
  });

  describe('calculateCachedFutureDepth', () => {
    it('counts consecutive future dates with both resolutions cached', () => {
      const catalog = {
        entries: {
          '20260728': { urls: { preview: 'p0', highDef: 'h0' } },
          '20260729': { urls: { preview: 'p1', highDef: 'h1' } },
          '20260730': { urls: { preview: 'p2', highDef: 'h2' } },
          '20260731': { urls: { preview: 'p3', highDef: 'h3' } }
        }
      };

      const cachedUrls = new Set(['p1', 'h1', 'p2', 'h2', 'p3', 'h3']);
      const depth = calculateCachedFutureDepth(catalog, '20260728', cachedUrls, false);

      assert.strictEqual(depth, 3);
    });

    it('stops at first gap', () => {
      const catalog = {
        entries: {
          '20260728': { urls: { preview: 'p0', highDef: 'h0' } },
          '20260729': { urls: { preview: 'p1', highDef: 'h1' } },
          '20260730': { urls: { preview: 'p2', highDef: 'h2' } },
          '20260731': { urls: { preview: 'p3', highDef: 'h3' } }
        }
      };

      // Missing h2 creates a gap
      const cachedUrls = new Set(['p1', 'h1', 'p2', 'p3', 'h3']);
      const depth = calculateCachedFutureDepth(catalog, '20260728', cachedUrls, false);

      assert.strictEqual(depth, 1); // Stops after first day
    });

    it('caps at 7 days', () => {
      const catalog = {
        entries: {
          '20260715': { urls: { preview: 'p0', highDef: 'h0' } },
          '20260716': { urls: { preview: 'p1', highDef: 'h1' } },
          '20260717': { urls: { preview: 'p2', highDef: 'h2' } },
          '20260718': { urls: { preview: 'p3', highDef: 'h3' } },
          '20260719': { urls: { preview: 'p4', highDef: 'h4' } },
          '20260720': { urls: { preview: 'p5', highDef: 'h5' } },
          '20260721': { urls: { preview: 'p6', highDef: 'h6' } },
          '20260722': { urls: { preview: 'p7', highDef: 'h7' } },
          '20260723': { urls: { preview: 'p8', highDef: 'h8' } },
          '20260724': { urls: { preview: 'p9', highDef: 'h9' } },
          '20260725': { urls: { preview: 'p10', highDef: 'h10' } }
        }
      };

      // All future dates cached (p1-p10, h1-h10)
      const cachedUrls = new Set();
      for (let i = 1; i <= 10; i++) {
        cachedUrls.add(`p${i}`);
        cachedUrls.add(`h${i}`);
      }

      const depth = calculateCachedFutureDepth(catalog, '20260715', cachedUrls, false);

      assert.strictEqual(depth, 7); // Diagnostic max caps at 7
    });

    it('uses UHD when enabled', () => {
      const catalog = {
        entries: {
          '20260728': { urls: { preview: 'p0', highDef: 'h0', ultraHighDef: 'u0' } },
          '20260729': { urls: { preview: 'p1', highDef: 'h1', ultraHighDef: 'u1' } }
        }
      };

      const cachedUrls = new Set(['p1', 'u1']);
      const depth = calculateCachedFutureDepth(catalog, '20260728', cachedUrls, true);

      assert.strictEqual(depth, 1);
    });
  });

  describe('getNavigationIndex', () => {
    it('returns index for date in newest-to-oldest order', () => {
      const catalog = {
        entries: {
          '20260728': {},
          '20260727': {},
          '20260726': {}
        }
      };

      assert.strictEqual(getNavigationIndex(catalog, '20260728'), 0);
      assert.strictEqual(getNavigationIndex(catalog, '20260727'), 1);
      assert.strictEqual(getNavigationIndex(catalog, '20260726'), 2);
    });

    it('returns -1 for date not in catalog', () => {
      const catalog = {
        entries: {
          '20260728': {}
        }
      };

      assert.strictEqual(getNavigationIndex(catalog, '20260729'), -1);
    });
  });

  describe('getDateAtNavigationIndex', () => {
    it('returns date at index in newest-to-oldest order', () => {
      const catalog = {
        entries: {
          '20260728': {},
          '20260727': {},
          '20260726': {}
        }
      };

      assert.strictEqual(getDateAtNavigationIndex(catalog, 0), '20260728');
      assert.strictEqual(getDateAtNavigationIndex(catalog, 1), '20260727');
      assert.strictEqual(getDateAtNavigationIndex(catalog, 2), '20260726');
    });

    it('returns null for invalid index', () => {
      const catalog = {
        entries: {
          '20260728': {}
        }
      };

      assert.strictEqual(getDateAtNavigationIndex(catalog, 5), null);
      assert.strictEqual(getDateAtNavigationIndex(catalog, -1), null);
    });
  });
});
