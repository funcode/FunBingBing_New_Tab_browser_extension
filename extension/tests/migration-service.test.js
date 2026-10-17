import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCatalogService } from '../src/worker/catalog-service.js';
import { createMigrationService } from '../src/worker/migration-service.js';
import { STORAGE_KEYS } from '../src/worker/storage-keys.js';

const MARKER_KEY = 'wallpaper_migration_v2_state';
const START = 1_000_000;
const quiet = { warn() {} };

const DEFAULT_SETTINGS = {
  search_engine_list: [
    { name: 'Bing', icon: 'icons/bing.png', action: 'https://bing.com/search', param_name: 'q', css_style: 'height: 50px;  margin: 10px;' },
    { name: 'Google', icon: 'icons/google.png', action: 'https://google.com/search', param_name: 'q', css_style: 'height: 40px; margin: 15px 10px;' }
  ],
  current_search_engine: 'Bing',
  display_search_box: 'no',
  show_top_sites: 'no',
  show_clock: 'yes',
  show_quote: 'yes',
  enable_uhd_wallpaper: 'yes',
  qotd_url: ''
};

// Chrome storage returns the keys of stored objects in sorted order.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
}

// chrome.storage-shaped area. `failSet` makes every write reject; `dropKeys`
// makes writes of those keys resolve without storing them.
function makeArea(initial = {}, { failSet = false, dropKeys = [] } = {}) {
  const area = {
    data: structuredClone(initial),
    failSet,
    dropKeys,
    async get(key) {
      const keys = key === null ? Object.keys(area.data) : Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter(k => k in area.data).map(k => [k, sortKeys(area.data[k])]));
    },
    async set(items) {
      if (area.failSet) throw new Error('QUOTA_BYTES quota exceeded');
      for (const [key, value] of Object.entries(items)) {
        if (!area.dropKeys.includes(key)) area.data[key] = structuredClone(value);
      }
    },
    async remove(key) {
      for (const k of Array.isArray(key) ? key : [key]) delete area.data[k];
    }
  };
  return area;
}

// CacheStorage-shaped fake holding response bodies by URL. While `failPuts`
// is positive, each put rejects and decrements it.
function makeCaches(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, urls]) =>
    [name, new Map(urls.map(url => [url, `body of ${url}`]))]));
  const caches = {
    stores,
    failPuts: 0,
    async has(name) { return stores.has(name); },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async keys() { return [...store.keys()].map(url => ({ url })); },
        async match(request) {
          const url = typeof request === 'string' ? request : request.url;
          return store.has(url) ? { body: store.get(url), clone() { return this; } } : undefined;
        },
        async put(request, response) {
          if (caches.failPuts > 0) {
            caches.failPuts -= 1;
            throw new Error('QuotaExceededError');
          }
          store.set(typeof request === 'string' ? request : request.url, response.body);
        }
      };
    }
  };
  return caches;
}

function makeWorker({ local = {}, sync = {}, syncOptions, caches = {} } = {}) {
  const storage = makeArea(local);
  const syncStorage = makeArea(sync, syncOptions);
  const cacheStorage = makeCaches(caches);
  const clock = { time: START };
  const catalogService = createCatalogService({
    storage,
    fetchJson: async () => { throw new Error('offline'); },
    now: () => clock.time,
    log: quiet
  });
  const migration = createMigrationService({
    catalogService,
    storage,
    syncStorage,
    caches: cacheStorage,
    now: () => clock.time,
    log: quiet
  });
  return { migration, storage, syncStorage, cacheStorage, clock };
}

describe('migration service: shared settings', () => {
  it('moves valid local settings to sync, keeps valid sync values and writes defaults for the rest', async () => {
    const { migration, storage, syncStorage } = makeWorker({
      local: {
        show_clock: 'no',
        enable_uhd_wallpaper: 'no',
        current_search_engine: 'Google',
        qotd_url: 'https://quotes.example/qotd.json',
        display_search_box: 'maybe',
        last_open_version: '1.7'
      },
      sync: { show_clock: 'yes', show_top_sites: 'yes', qotd_url: 'http://insecure.example/' }
    });

    await migration.run();

    assert.deepStrictEqual(syncStorage.data, {
      ...DEFAULT_SETTINGS,
      show_clock: 'yes',
      show_top_sites: 'yes',
      enable_uhd_wallpaper: 'no',
      current_search_engine: 'Google',
      qotd_url: 'https://quotes.example/qotd.json'
    });
    // The local copies, valid or not, are deleted once sync is verified.
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      assert.ok(!(key in storage.data), `${key} remains in local storage`);
    }
    assert.strictEqual(storage.data.last_open_version, '1.7');
    assert.strictEqual(storage.data[MARKER_KEY].phase, 'verified');
  });
});

const TODAY = '20261015';
const ts1 = path => `https://ts1.tc.mm.bing.net${path}`;
const idOn = date => `OHR.Day${date}_ZH-CN${date}`;

// A v1 `bing_images` item as the v1 page stored it: IOTD fields with relative
// image URLs, plus the fields the page added.
function v1Image(date, extra = {}) {
  return {
    isoDate: date,
    date: '2026 10月 15',
    title: `Title ${date}`,
    caption: `Caption ${date}`,
    description: `Description ${date}`,
    descriptionPara2: '',
    copyright: `© ${date}`,
    clickUrl: `/search?q=${date}`,
    imageUrls: {
      landscape: {
        highDef: `/th?id=${idOn(date)}_1920x1080.jpg`,
        ultraHighDef: `/th?id=${idOn(date)}_UHD.jpg`
      }
    },
    headline: `Headline ${date}`,
    quickFact: `Fact ${date}`,
    triviaId: `HPQuiz_${date}_Day`,
    ...extra
  };
}

// v1 images for `count` days ending today, newest first.
function v1Images(count = 8) {
  return Array.from({ length: count }, (_, i) => v1Image(String(Number(TODAY) - i)));
}

const TRIVIA = { question: 'Where?', options: [{ url: '/search?q=a', bullet: 'A', text: 'Here' }] };
const v1Quote = date => ({ text: `"Quote ${date}"`, source: `Author ${date}`, caption: `Caption ${date}`, link: '/search?q=author' });

function v2EntryOf(date, imageId, fields = {}) {
  return {
    date,
    imageId,
    urls: {
      preview: ts1(`/th?id=${imageId}_640x360.jpg`),
      highDef: ts1(`/th?id=${imageId}_1920x1080.jpg`),
      ultraHighDef: ts1(`/th?id=${imageId}_UHD.jpg`)
    },
    metadataStage: 'iotd',
    triviaId: '',
    triviaData: null,
    triviaState: 'missing',
    triviaAttemptedAt: 0,
    triviaNextRetryAt: 0,
    triviaRetryLevel: 0,
    updatedAt: 5,
    ...fields
  };
}

function v2Catalog(entries) {
  return {
    version: 2,
    updatedAt: 5,
    refreshState: { date: TODAY, generation: 1, cachedFutureDepth: 0, sources: {}, imageFailures: {} },
    entries: Object.fromEntries(entries.map(entry => [entry.date, entry]))
  };
}

const markerOf = worker => worker.storage.data[MARKER_KEY];
const catalogOf = worker => worker.storage.data[STORAGE_KEYS.catalog];

describe('migration service: v1 wallpaper and quote state', () => {
  it('imports the newest eight valid v1 dates as canonical legacy entries without writing display state', async () => {
    const images = [
      v1Image('20261016', { imageUrls: { landscape: { highDef: '/th?id=OHR.Bad_ZH-CN1_1366x768.jpg' } } }),
      ...v1Images(8),
      v1Image('20261007'),
      v1Image('2026-10-06')
    ];
    images[1].triviaData = TRIVIA;
    images[8].triviaId = '/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20261007_Day%22&FORM=HPQUIZ';
    const worker = makeWorker({ local: { bing_images: images, wallpaper_url: ts1(`/th?id=${idOn(TODAY)}_UHD.jpg`), wallpaper_date: TODAY } });

    await worker.migration.run();

    const catalog = catalogOf(worker);
    assert.strictEqual(catalog.version, 2);
    assert.deepStrictEqual(Object.keys(catalog.entries).sort(), v1Images(8).map(image => image.isoDate).sort());
    const today = catalog.entries[TODAY];
    assert.strictEqual(today.imageId, idOn(TODAY));
    assert.strictEqual(today.metadataStage, 'legacy');
    assert.deepStrictEqual(today.urls, {
      preview: ts1(`/th?id=${idOn(TODAY)}_640x360.jpg`),
      highDef: ts1(`/th?id=${idOn(TODAY)}_1920x1080.jpg`),
      ultraHighDef: ts1(`/th?id=${idOn(TODAY)}_UHD.jpg`)
    });
    assert.strictEqual(today.headline, `Headline ${TODAY}`);
    assert.strictEqual(today.quickFact, `Fact ${TODAY}`);
    assert.strictEqual(today.triviaId, `HPQuiz_${TODAY}_Day`);
    assert.deepStrictEqual(today.triviaData, TRIVIA);
    assert.strictEqual(today.triviaState, 'complete');
    const oldest = catalog.entries['20261008'];
    assert.strictEqual(oldest.triviaState, 'missing');
    assert.strictEqual(oldest.triviaData, null);
    assert.strictEqual(oldest.triviaId, '', 'a raw quiz search path is not a trivia ID');
    assert.strictEqual(catalog.entries['20261009'].triviaId, 'HPQuiz_20261009_Day');
    // The legacy display inputs stay for the first page; the worker never writes display state.
    assert.ok(!(STORAGE_KEYS.displayState in worker.storage.data));
    assert.strictEqual(worker.storage.data.wallpaper_url, ts1(`/th?id=${idOn(TODAY)}_UHD.jpg`));
    assert.strictEqual(worker.storage.data.wallpaper_date, TODAY);
    assert.ok(Array.isArray(worker.storage.data.bing_images));
    assert.strictEqual(markerOf(worker).phase, 'verified');
  });

  it('keeps every valid entry and field of a partial v2 catalog and merges only missing legacy data', async () => {
    const replaced = v2EntryOf(TODAY, 'OHR.Replacement_ZH-CN9', { headline: 'v2 headline' });
    const same = v2EntryOf('20261014', idOn('20261014'), { title: 'v2 title', headline: '' });
    const worker = makeWorker({
      local: { bing_images: v1Images(3), [STORAGE_KEYS.catalog]: v2Catalog([replaced, same]) }
    });

    await worker.migration.run();

    const catalog = catalogOf(worker);
    assert.deepStrictEqual(catalog.entries[TODAY], replaced);
    assert.strictEqual(catalog.entries['20261014'].title, 'v2 title');
    assert.strictEqual(catalog.entries['20261014'].headline, 'Headline 20261014');
    assert.strictEqual(catalog.entries['20261014'].metadataStage, 'iotd');
    assert.strictEqual(catalog.entries['20261013'].metadataStage, 'legacy');
    assert.strictEqual(catalog.refreshState.date, TODAY);

    // A repeated run neither duplicates nor rewrites anything.
    const before = structuredClone(catalog);
    worker.clock.time += 1000;
    await worker.migration.run();
    assert.deepStrictEqual(catalogOf(worker), before);
  });

  it('copies missing valid v1 quotes and keeps valid v2 quotes', async () => {
    const v2Quote = { text: 'Kept', source: 'v2', caption: 'v2 caption', link: '' };
    const worker = makeWorker({
      local: {
        cache_quote_state: {
          quotes: {
            [TODAY]: v1Quote(TODAY),
            20261014: v1Quote('20261014'),
            20261013: { ...v1Quote('20261013'), caption: null },
            20261012: { text: '', source: 'Nobody' }
          },
          tracker: { last: 1 }
        },
        [STORAGE_KEYS.quoteState]: { quotes: { 20261014: v2Quote } }
      }
    });

    await worker.migration.run();

    assert.deepStrictEqual(worker.storage.data[STORAGE_KEYS.quoteState], {
      quotes: {
        [TODAY]: { text: `Quote ${TODAY}`, source: `Author ${TODAY}`, caption: `Caption ${TODAY}`, link: 'https://cn.bing.com/search?q=author' },
        20261014: v2Quote,
        20261013: { text: 'Quote 20261013', source: 'Author 20261013', caption: '', link: 'https://cn.bing.com/search?q=author' }
      }
    });
    assert.strictEqual(markerOf(worker).phase, 'verified');
  });

  it('writes an empty catalog, quote state and default settings for a new install', async () => {
    const worker = makeWorker();

    await worker.migration.run();

    assert.deepStrictEqual(catalogOf(worker).entries, {});
    assert.strictEqual(catalogOf(worker).updatedAt, START);
    assert.deepStrictEqual(worker.storage.data[STORAGE_KEYS.quoteState], { quotes: {} });
    assert.deepStrictEqual(worker.syncStorage.data, DEFAULT_SETTINGS);
    assert.deepStrictEqual(markerOf(worker), { version: 2, phase: 'verified', startedAt: START, verifiedAt: START, completedAt: 0 });
  });

  it('recovers a completed v1 trivia payload only for the same trivia ID, and keeps an existing completion', async () => {
    const missing = { triviaData: null, triviaState: 'missing' };
    const kept = { question: 'Kept?', options: [] };
    const worker = makeWorker({
      local: {
        [STORAGE_KEYS.catalog]: v2Catalog([
          v2EntryOf(TODAY, idOn(TODAY), { ...missing, triviaId: `HPQuiz_${TODAY}_Day`, triviaRetryLevel: 2, triviaNextRetryAt: 9 }),
          v2EntryOf('20261014', idOn('20261014'), { ...missing, triviaId: 'HPQuiz_20261014_Other' }),
          v2EntryOf('20261013', idOn('20261013'), { triviaId: 'HPQuiz_20261013_Day', triviaData: kept, triviaState: 'complete' })
        ]),
        bing_images: v1Images(3).map(image => ({ ...image, triviaData: TRIVIA }))
      }
    });

    await worker.migration.run();

    const entries = catalogOf(worker).entries;
    assert.deepStrictEqual(entries[TODAY].triviaData, TRIVIA);
    assert.strictEqual(entries[TODAY].triviaState, 'complete');
    assert.strictEqual(entries[TODAY].triviaRetryLevel, 0);
    assert.strictEqual(entries[TODAY].triviaNextRetryAt, 0);
    assert.strictEqual(entries['20261014'].triviaData, null, 'a payload of another trivia ID is not recovered');
    assert.strictEqual(entries['20261014'].triviaState, 'missing');
    assert.deepStrictEqual(entries['20261013'].triviaData, kept);
  });
});

describe('migration service: v1 Cache Storage', () => {
  it('copies v1 responses missing from the v2 cache under their canonical URL and keeps the v1 cache until completion', async () => {
    const id = idOn(TODAY);
    const worker = makeWorker({
      caches: {
        'funbingbing-wallpaper-cache-v1': [
          `https://cn.bing.com/th?id=${id}_UHD.jpg`,
          ts1(`/th?id=${id}_640x360.jpg`),
          ts1('/th?id=OHR.Future_ZH-CN2_1920x1080.webp&w=1920'),
          ts1(`/th?id=${id}_1366x768.jpg`)
        ],
        'funbingbing-wallpaper-cache-v2': []
      }
    });
    worker.cacheStorage.stores.get('funbingbing-wallpaper-cache-v2').set(ts1(`/th?id=${id}_640x360.jpg`), 'v2 body');

    await worker.migration.run();

    assert.deepStrictEqual(Object.fromEntries(worker.cacheStorage.stores.get('funbingbing-wallpaper-cache-v2')), {
      [ts1(`/th?id=${id}_640x360.jpg`)]: 'v2 body',
      [ts1(`/th?id=${id}_UHD.jpg`)]: `body of https://cn.bing.com/th?id=${id}_UHD.jpg`,
      [ts1('/th?id=OHR.Future_ZH-CN2_1920x1080.jpg')]: `body of ${ts1('/th?id=OHR.Future_ZH-CN2_1920x1080.webp&w=1920')}`
    });
    assert.ok(worker.cacheStorage.stores.has('funbingbing-wallpaper-cache-v1'));
  });
});

describe('migration service: failed settings migration', () => {
  it('keeps local settings and stays retryable when sync rejects the write', async () => {
    const worker = makeWorker({ local: { show_clock: 'no', bing_images: v1Images(1) }, syncOptions: { failSet: true } });

    await worker.migration.run();

    assert.strictEqual(worker.storage.data.show_clock, 'no');
    assert.strictEqual(markerOf(worker).phase, 'writing');

    worker.syncStorage.failSet = false;
    await worker.migration.run();

    assert.strictEqual(worker.syncStorage.data.show_clock, 'no');
    assert.strictEqual(markerOf(worker).phase, 'verified');
  });

  it('keeps local settings when a sync value cannot be verified', async () => {
    const worker = makeWorker({ local: { show_quote: 'no', show_clock: 'no' }, syncOptions: { dropKeys: ['show_quote'] } });

    await worker.migration.run();

    assert.strictEqual(worker.storage.data.show_quote, 'no');
    assert.strictEqual(worker.storage.data.show_clock, 'no');
    assert.strictEqual(markerOf(worker).phase, 'writing');
  });

  it('stays retryable when deleting the verified local settings fails, then deletes them on the next run', async () => {
    const worker = makeWorker({ local: { show_clock: 'no' } });
    const remove = worker.storage.remove;
    worker.storage.remove = async () => { throw new Error('storage unavailable'); };

    await worker.migration.run();

    assert.strictEqual(worker.syncStorage.data.show_clock, 'no');
    assert.strictEqual(worker.storage.data.show_clock, 'no');
    assert.strictEqual(markerOf(worker).phase, 'writing');

    worker.storage.remove = remove;
    await worker.migration.run();

    assert.strictEqual(worker.syncStorage.data.show_clock, 'no', 'the synced value is kept on the rerun');
    assert.ok(!('show_clock' in worker.storage.data));
    assert.strictEqual(markerOf(worker).phase, 'verified');
  });
});

const LEGACY_LOCAL = {
  bing_images: v1Images(2),
  wallpaper_date: TODAY,
  wallpaper_idx: '1',
  wallpaper_url: ts1(`/th?id=${idOn(TODAY)}_UHD.jpg`),
  wallpaper_preload_data_url: 'data:image/jpeg;base64,AAAA',
  wallpaper_fetch_lock: 0,
  cache_quick_facts: { [TODAY]: 'Fact' },
  bing_model_preload_wallpaper_urls: [ts1('/th?id=OHR.Future_ZH-CN2_UHD.jpg')],
  cache_quote_state: { quotes: { [TODAY]: v1Quote(TODAY) } },
  last_open_version: '1.7'
};

const displayStateOf = (date, imageId) => ({
  date, imageId, url: ts1(`/th?id=${imageId}_UHD.jpg`), preloadDataUrl: '', updatedAt: 0
});

describe('migration service: page acknowledgement', () => {
  it('completes on the first valid acknowledgement and then deletes the v1 state', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL, caches: { 'funbingbing-wallpaper-cache-v1': [] } });
    await worker.migration.run();
    worker.storage.data[STORAGE_KEYS.displayState] = displayStateOf(TODAY, idOn(TODAY));
    worker.clock.time = START + 50;

    assert.deepStrictEqual(await worker.migration.acknowledge(), { ok: true });

    assert.deepStrictEqual(markerOf(worker), { version: 2, phase: 'complete', startedAt: START, verifiedAt: START, completedAt: START + 50 });
    assert.deepStrictEqual(Object.keys(worker.storage.data).sort(), [
      STORAGE_KEYS.catalog, STORAGE_KEYS.quoteState, STORAGE_KEYS.displayState, MARKER_KEY, 'last_open_version'
    ].sort());
    assert.ok(!worker.cacheStorage.stores.has('funbingbing-wallpaper-cache-v1'));
    assert.deepStrictEqual(worker.storage.data[STORAGE_KEYS.displayState], displayStateOf(TODAY, idOn(TODAY)));
  });

  it('accepts the explicit empty display state', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL });
    await worker.migration.run();
    worker.storage.data[STORAGE_KEYS.displayState] = { date: '', imageId: '', url: '', preloadDataUrl: '', updatedAt: 0 };

    assert.deepStrictEqual(await worker.migration.acknowledge(), { ok: true });
    assert.strictEqual(markerOf(worker).phase, 'complete');
  });

  it('stays verified, keeping the v1 inputs, while no valid display state was written', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL });
    await worker.migration.run();
    worker.storage.data[STORAGE_KEYS.displayState] = { date: TODAY, imageId: 'not an id' };

    assert.deepStrictEqual(await worker.migration.acknowledge(), { ok: false });

    assert.strictEqual(markerOf(worker).phase, 'verified');
    assert.strictEqual(worker.storage.data.wallpaper_url, LEGACY_LOCAL.wallpaper_url);
  });

  it('ignores an acknowledgement before verification', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL, syncOptions: { failSet: true } });
    await worker.migration.run();
    worker.storage.data[STORAGE_KEYS.displayState] = displayStateOf(TODAY, idOn(TODAY));

    assert.deepStrictEqual(await worker.migration.acknowledge(), { ok: false });
    assert.strictEqual(markerOf(worker).phase, 'writing');
    assert.ok('bing_images' in worker.storage.data);
  });

  it('treats duplicate and late acknowledgements after completion as no-ops', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL });
    await worker.migration.run();
    worker.storage.data[STORAGE_KEYS.displayState] = displayStateOf(TODAY, idOn(TODAY));

    const results = await Promise.all([worker.migration.acknowledge(), worker.migration.acknowledge()]);
    const completed = structuredClone(markerOf(worker));
    worker.clock.time += 1000;
    const late = await worker.migration.acknowledge();

    assert.deepStrictEqual(results, [{ ok: true }, { ok: false }]);
    assert.deepStrictEqual(late, { ok: false });
    assert.deepStrictEqual(markerOf(worker), completed);
  });
});

describe('migration service: interrupted transfers', () => {
  it('stays retryable and keeps the old cache when copying a response fails', async () => {
    const id = idOn(TODAY);
    const v1Url = `https://cn.bing.com/th?id=${id}_UHD.jpg`;
    const worker = makeWorker({ local: LEGACY_LOCAL, caches: { 'funbingbing-wallpaper-cache-v1': [v1Url] } });
    worker.cacheStorage.failPuts = 1;

    await worker.migration.run();
    worker.storage.data[STORAGE_KEYS.displayState] = { date: '', imageId: '', url: '', preloadDataUrl: '', updatedAt: 0 };

    assert.strictEqual(markerOf(worker).phase, 'writing');
    assert.deepStrictEqual(await worker.migration.acknowledge(), { ok: false });
    assert.ok(worker.cacheStorage.stores.get('funbingbing-wallpaper-cache-v1').has(v1Url));
    assert.ok('bing_images' in worker.storage.data);

    await worker.migration.run();

    assert.strictEqual(markerOf(worker).phase, 'verified');
    assert.strictEqual(worker.cacheStorage.stores.get('funbingbing-wallpaper-cache-v2').get(ts1(`/th?id=${id}_UHD.jpg`)), `body of ${v1Url}`);
  });

  it('replaces an invalid partial v2 entry with the valid v1 entry of its date', async () => {
    const broken = { date: TODAY, imageId: 'garbage', updatedAt: 5 };
    const worker = makeWorker({
      local: { bing_images: v1Images(2), [STORAGE_KEYS.catalog]: { ...v2Catalog([]), entries: { [TODAY]: broken } } }
    });

    await worker.migration.run();

    assert.strictEqual(catalogOf(worker).entries[TODAY].imageId, idOn(TODAY));
    assert.strictEqual(catalogOf(worker).entries[TODAY].metadataStage, 'legacy');
    assert.strictEqual(markerOf(worker).phase, 'verified');
  });
});

describe('migration service: restart', () => {
  it('rebuilds after an interruption in the writing phase without losing or duplicating data', async () => {
    const worker = makeWorker({ local: { ...LEGACY_LOCAL, show_clock: 'no' } });
    // An interrupted earlier run left its marker and a partly written catalog.
    worker.storage.data[MARKER_KEY] = { version: 2, phase: 'writing', startedAt: START - 10, verifiedAt: 0, completedAt: 0 };
    worker.storage.data[STORAGE_KEYS.catalog] = v2Catalog([]);

    await worker.migration.run();

    assert.deepStrictEqual(Object.keys(catalogOf(worker).entries).sort(), ['20261014', TODAY]);
    assert.strictEqual(worker.syncStorage.data.show_clock, 'no');
    assert.deepStrictEqual(markerOf(worker), { version: 2, phase: 'verified', startedAt: START - 10, verifiedAt: START, completedAt: 0 });
  });

  it('re-verifies on restart in the verified phase and keeps waiting for the page', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL });
    await worker.migration.run();
    const verified = structuredClone(worker.storage.data);
    worker.clock.time += 1000;

    await worker.migration.run();

    assert.deepStrictEqual(worker.storage.data, verified);
  });

  it('does not restore legacy dates that a rollover dropped while it waited for the page', async () => {
    const worker = makeWorker({ local: { ...LEGACY_LOCAL, bing_images: v1Images(8) } });
    await worker.migration.run();
    // A refresh rolled the catalog eight days on, dropping the expired dates.
    const later = String(Number(TODAY) + 6);
    const rolled = catalogOf(worker);
    rolled.refreshState.date = later;
    rolled.entries = Object.fromEntries(Object.entries(rolled.entries).filter(([date]) => date >= String(Number(later) - 7)));
    const kept = Object.keys(rolled.entries).sort();

    await worker.migration.run();

    assert.deepStrictEqual(Object.keys(catalogOf(worker).entries).sort(), kept);
    assert.strictEqual(markerOf(worker).phase, 'verified');
  });

  it('returns to writing when verified sync settings were lost, then verifies again', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL });
    await worker.migration.run();
    worker.syncStorage.failSet = true;
    worker.syncStorage.data = {};

    await worker.migration.run();
    assert.strictEqual(markerOf(worker).phase, 'writing');

    worker.syncStorage.failSet = false;
    await worker.migration.run();
    assert.strictEqual(markerOf(worker).phase, 'verified');
    assert.deepStrictEqual(worker.syncStorage.data, DEFAULT_SETTINGS);
  });

  it('finishes an interrupted cleanup on restart after completion without migrating again', async () => {
    const worker = makeWorker({ local: LEGACY_LOCAL, caches: { 'funbingbing-wallpaper-cache-v1': [] } });
    worker.storage.data[MARKER_KEY] = { version: 2, phase: 'complete', startedAt: START, verifiedAt: START, completedAt: START };

    await worker.migration.run();

    assert.ok(!('bing_images' in worker.storage.data));
    assert.ok(!('wallpaper_url' in worker.storage.data));
    assert.ok(!worker.cacheStorage.stores.has('funbingbing-wallpaper-cache-v1'));
    assert.ok(!(STORAGE_KEYS.catalog in worker.storage.data));
    assert.deepStrictEqual(worker.syncStorage.data, {});
  });
});
