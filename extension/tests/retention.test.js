import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateRetentionSet,
  calculateCachedFutureDepth,
  getNavigableDates,
  getNavigationIndex,
  getDateAtNavigationIndex
} from '../src/helpers/retention.js';
import { addDays } from '../src/helpers/date.js';

describe('Retention helpers', () => {
  describe('calculateRetentionSet', () => {
    it('retains preview + HD for each date when UHD disabled', () => {
      const catalog = {
        entries: {
          '20260728': { urls: { preview: 'https://example.com/preview1.jpg', highDef: 'https://example.com/hd1.jpg', ultraHighDef: 'https://example.com/uhd1.jpg' } },
          '20260727': { urls: { preview: 'https://example.com/preview2.jpg', highDef: 'https://example.com/hd2.jpg', ultraHighDef: 'https://example.com/uhd2.jpg' } }
        }
      };

      const retentionSet = calculateRetentionSet(catalog, null, false, '20260728');

      assert.strictEqual(retentionSet.has('https://example.com/preview1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/hd1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/uhd1.jpg'), false);
      assert.strictEqual(retentionSet.has('https://example.com/preview2.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/hd2.jpg'), true);
    });

    it('retains preview + UHD for each date when UHD enabled', () => {
      const catalog = {
        entries: {
          '20260728': { urls: { preview: 'https://example.com/preview1.jpg', highDef: 'https://example.com/hd1.jpg', ultraHighDef: 'https://example.com/uhd1.jpg' } }
        }
      };

      const retentionSet = calculateRetentionSet(catalog, null, true, '20260728');

      assert.strictEqual(retentionSet.has('https://example.com/preview1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/uhd1.jpg'), true);
      assert.strictEqual(retentionSet.has('https://example.com/hd1.jpg'), false);
    });

    it('limits to 15 dates maximum (30 base keys)', () => {
      const entries = {};
      for (let i = -10; i < 10; i++) {
        const date = addDays('20260728', i);
        entries[date] = { urls: { preview: `https://example.com/preview${date}.jpg`, highDef: `https://example.com/hd${date}.jpg` } };
      }

      const catalog = { entries };
      const retentionSet = calculateRetentionSet(catalog, null, false, '20260728');
      assert.strictEqual(retentionSet.size, 30);
    });

    it('retains only dates within target minus seven through target plus seven', () => {
      const makeEntries = offsets => Object.fromEntries(offsets.map(offset => {
        const date = addDays('20260728', offset);
        return [date, { urls: { preview: `https://example.com/preview${date}.jpg`, highDef: `https://example.com/hd${date}.jpg` } }];
      }));

      // Sparse future coverage: target-8 must not fill the unused future slots.
      const sparse = calculateRetentionSet({ entries: makeEntries([-8, -7, 0, 1]) }, null, false, '20260728');
      assert.strictEqual(sparse.has(`https://example.com/preview${addDays('20260728', -8)}.jpg`), false);
      assert.strictEqual(sparse.has(`https://example.com/preview${addDays('20260728', -7)}.jpg`), true);
      assert.strictEqual(sparse.size, 6);

      // target-7 through target+8: target+8 is dropped, target-7 is kept.
      const offsets = Array.from({ length: 16 }, (_, i) => i - 7);
      const full = calculateRetentionSet({ entries: makeEntries(offsets) }, null, false, '20260728');
      assert.strictEqual(full.has(`https://example.com/preview${addDays('20260728', 8)}.jpg`), false);
      assert.strictEqual(full.has(`https://example.com/preview${addDays('20260728', -7)}.jpg`), true);
      assert.strictEqual(full.size, 30);
    });

    it('adds display protection keys derived from the displayed imageId, not the catalog entry for that date', () => {
      // Catalog entry for '20260728' has become OHR.B, but the page still displays OHR.A
      const catalog = {
        entries: {
          '20260728': { imageId: 'OHR.B', urls: { preview: 'https://cdn/OHR.B_640x360.jpg', highDef: 'https://cdn/OHR.B_1920x1080.jpg' } },
          '20260727': { imageId: 'OHR.A', urls: { preview: 'https://cdn/OHR.A_640x360.jpg', highDef: 'https://cdn/OHR.A_1920x1080.jpg' } }
        }
      };
      const displayState = { date: '20260728', imageId: 'OHR.A', url: 'https://ts1.tc.mm.bing.net/th?id=OHR.A_1920x1080.jpg' };

      const retentionSet = calculateRetentionSet(catalog, displayState, false, '20260728');

      // A's final URL must be protected (from displayState.url)
      assert.strictEqual(retentionSet.has('https://ts1.tc.mm.bing.net/th?id=OHR.A_1920x1080.jpg'), true);
      // A's preview must be protected from the displayed identity
      assert.strictEqual(retentionSet.has('https://ts1.tc.mm.bing.net/th?id=OHR.A_640x360.jpg'), true);
      // B's preview should NOT be the protected one — that was the old bug
    });

    it('protects the displayed preview even when the old identity is absent from the catalog', () => {
      const catalog = {
        entries: {
          '20260728': { imageId: 'OHR.B', urls: { preview: 'https://cdn/OHR.B_640x360.jpg', highDef: 'https://cdn/OHR.B_1920x1080.jpg' } }
        }
      };
      const displayState = {
        date: '20260728',
        imageId: 'OHR.A_ZH-CN123',
        url: 'https://ts1.tc.mm.bing.net/th?id=OHR.A_ZH-CN123_1920x1080.jpg'
      };
      const retentionSet = calculateRetentionSet(catalog, displayState, false, '20260728');
      assert.strictEqual(retentionSet.has('https://ts1.tc.mm.bing.net/th?id=OHR.A_ZH-CN123_640x360.jpg'), true);
    });

    it('ignores an invalid display URL but still protects a valid identity preview', () => {
      const retentionSet = calculateRetentionSet({}, {
        imageId: 'OHR.A_ZH-CN123',
        url: 'https://evil.example/image.jpg'
      }, false, '20260728');
      assert.strictEqual(retentionSet.has('https://evil.example/image.jpg'), false);
      assert.strictEqual(retentionSet.has('https://ts1.tc.mm.bing.net/th?id=OHR.A_ZH-CN123_640x360.jpg'), true);
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

      const cachedUrls = new Set(['p1', 'h1', 'p2', 'p3', 'h3']); // h2 missing
      const depth = calculateCachedFutureDepth(catalog, '20260728', cachedUrls, false);
      assert.strictEqual(depth, 1);
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
      const cachedUrls = new Set();
      for (let i = 1; i <= 10; i++) { cachedUrls.add(`p${i}`); cachedUrls.add(`h${i}`); }

      const depth = calculateCachedFutureDepth(catalog, '20260715', cachedUrls, false);
      assert.strictEqual(depth, 7);
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

  describe('getNavigableDates', () => {
    it('excludes future entries from navigation', () => {
      const catalog = {
        entries: {
          '20260730': {},  // future
          '20260729': {},  // future
          '20260728': {},  // target
          '20260727': {},  // historical
          '20260726': {}   // historical
        }
      };

      const dates = getNavigableDates(catalog, '20260728');
      assert.deepStrictEqual(dates, ['20260728', '20260727', '20260726']);
    });

    it('returns empty array when catalog is empty', () => {
      assert.deepStrictEqual(getNavigableDates({ entries: {} }, '20260728'), []);
    });

    it('excludes entries older than the seven historical dates', () => {
      const catalog = { entries: { '20260728': {}, '20260721': {}, '20260720': {} } };
      assert.deepStrictEqual(getNavigableDates(catalog, '20260728'), ['20260728', '20260721']);
    });
  });

  describe('getNavigationIndex', () => {
    it('returns index for date in newest-to-oldest navigable order', () => {
      const catalog = {
        entries: {
          '20260730': {},  // future — excluded
          '20260728': {},
          '20260727': {},
          '20260726': {}
        }
      };

      assert.strictEqual(getNavigationIndex(catalog, '20260728', '20260728'), 0);
      assert.strictEqual(getNavigationIndex(catalog, '20260727', '20260728'), 1);
      assert.strictEqual(getNavigationIndex(catalog, '20260726', '20260728'), 2);
      // Future date not navigable
      assert.strictEqual(getNavigationIndex(catalog, '20260730', '20260728'), -1);
    });

    it('returns -1 for date not in catalog', () => {
      const catalog = { entries: { '20260728': {} } };
      assert.strictEqual(getNavigationIndex(catalog, '20260729', '20260728'), -1);
    });
  });

  describe('getDateAtNavigationIndex', () => {
    it('returns date at index excluding future entries', () => {
      const catalog = {
        entries: {
          '20260730': {},  // future
          '20260728': {},
          '20260727': {},
          '20260726': {}
        }
      };

      assert.strictEqual(getDateAtNavigationIndex(catalog, 0, '20260728'), '20260728');
      assert.strictEqual(getDateAtNavigationIndex(catalog, 1, '20260728'), '20260727');
      assert.strictEqual(getDateAtNavigationIndex(catalog, 2, '20260728'), '20260726');
    });

    it('returns null for invalid index', () => {
      const catalog = { entries: { '20260728': {} } };
      assert.strictEqual(getDateAtNavigationIndex(catalog, 5, '20260728'), null);
      assert.strictEqual(getDateAtNavigationIndex(catalog, -1, '20260728'), null);
    });
  });
});

