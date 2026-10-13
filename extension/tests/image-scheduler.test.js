import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createCatalogService } from '../src/worker/catalog-service.js';
import { createEmptyCatalog } from '../src/worker/catalog.js';
import { createImageScheduler } from '../src/worker/image-scheduler.js';
import { STORAGE_KEYS } from '../src/worker/storage-keys.js';
import { addDays } from '../src/helpers/date.js';

const TARGET = '20260728';
const MINUTE = 60 * 1000;
const CDN = 'https://ts1.tc.mm.bing.net/th?id=';

function idFor(date, variant = 'A') {
  return `OHR.Day${variant}${date}_ZH-CN1`;
}

function urlsFor(date, variant) {
  const id = idFor(date, variant);
  return {
    preview: `${CDN}${id}_640x360.jpg`,
    highDef: `${CDN}${id}_1920x1080.jpg`,
    ultraHighDef: `${CDN}${id}_UHD.jpg`
  };
}

// Catalog with entries at the given day offsets from `target`.
function catalogAt(offsets, { target = TARGET, variants = {} } = {}) {
  const catalog = createEmptyCatalog();
  catalog.refreshState.date = target;
  catalog.refreshState.generation = 1;
  for (const offset of offsets) {
    const date = addDays(target, offset);
    catalog.entries[date] = { date, imageId: idFor(date, variants[date]), urls: urlsFor(date, variants[date]) };
  }
  return catalog;
}

function displayStateFor(date, { variant, uhd = false } = {}) {
  const urls = urlsFor(date, variant);
  return { date, imageId: idFor(date, variant), url: uhd ? urls.ultraHighDef : urls.highDef, preloadDataUrl: '', updatedAt: 1 };
}

function makeStorage(initial = {}) {
  const data = structuredClone(initial);
  const writtenKeys = [];
  return {
    data,
    writtenKeys,
    async get(key) {
      const keys = Array.isArray(key) ? key : [key];
      const result = {};
      for (const k of keys) {
        if (k in data) result[k] = structuredClone(data[k]);
      }
      return result;
    },
    async set(items) {
      writtenKeys.push(...Object.keys(items));
      Object.assign(data, structuredClone(items));
    }
  };
}

function makeCache(initialUrls = []) {
  const store = new Map(initialUrls.map(url => [url, { url, seeded: true }]));
  return {
    store,
    async match(url) { return store.get(url); },
    async put(url, response) { store.set(url, response); },
    async keys() { return [...store.keys()].map(url => ({ url })); },
    async delete(request) { return store.delete(request.url); }
  };
}

// Image fetches succeed at once unless the URL is failing or held; a held URL
// waits until the test releases it.
function makeImageFetch() {
  const calls = [];
  const failing = new Set();
  const holds = new Map();
  const stats = { active: 0, maxActive: 0 };
  const fetcher = { calls, failing, stats, onFetch: () => {} };
  async function fetchImage(url) {
    calls.push(url);
    fetcher.onFetch();
    stats.active++;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    try {
      const hold = holds.get(url);
      if (hold) {
        holds.delete(url);
        hold.markStarted();
        await hold.gate;
      }
      if (failing.has(url)) throw new Error('network');
      return { ok: true, url };
    } finally {
      stats.active--;
    }
  }
  // `started` resolves once the held fetch is active; `release` lets it finish.
  function hold(url) {
    let release;
    let markStarted;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { markStarted = resolve; });
    holds.set(url, { gate, markStarted });
    return { release, started };
  }
  return Object.assign(fetcher, { fetchImage, hold });
}

function makeHarness({ catalog = catalogAt([0]), displayState, uhd = 'no', cached = [], time = 1_000_000 } = {}) {
  const local = makeStorage({
    [STORAGE_KEYS.catalog]: catalog,
    ...(displayState ? { [STORAGE_KEYS.displayState]: displayState } : {})
  });
  const sync = makeStorage({ enable_uhd_wallpaper: uhd });
  const cache = makeCache(cached);
  const fetcher = makeImageFetch();
  const clock = { time };
  const broadcasts = [];
  const catalogService = createCatalogService({
    storage: local,
    fetchJson: async () => { throw new Error('no metadata in scheduler tests'); },
    now: () => clock.time,
    broadcast: message => broadcasts.push(message),
    log: { warn() {} }
  });
  const start = imageFetch => createImageScheduler({
    catalogService,
    syncStorage: sync,
    openCache: async () => cache,
    fetchImage: imageFetch.fetchImage,
    now: () => clock.time,
    log: { warn() {} }
  });
  const harness = { scheduler: start(fetcher), local, sync, cache, fetcher, clock, broadcasts };
  // Simulate worker termination: in-memory tasks and generation are lost,
  // storage and Cache Storage persist.
  harness.restart = () => {
    harness.fetcher = makeImageFetch();
    harness.scheduler = start(harness.fetcher);
  };
  return harness;
}

const catalogOf = harness => harness.local.data[STORAGE_KEYS.catalog];

const short = url => {
  const id = url.slice(CDN.length);
  const date = id.match(/\d{8}/)[0];
  return `${date}${id.slice(id.lastIndexOf('_'))}`;
};

describe('image scheduler ordering and concurrency', () => {
  it('fetches target, history and future serially in baseline priority order', async () => {
    const harness = makeHarness({ catalog: catalogAt([2, -2, 0, -1, 1]) });
    await harness.scheduler.reconcile();

    assert.deepStrictEqual(harness.fetcher.calls.map(short), [
      '20260728_640x360.jpg',
      '20260728_1920x1080.jpg',
      '20260727_640x360.jpg',
      '20260726_640x360.jpg',
      '20260727_1920x1080.jpg',
      '20260726_1920x1080.jpg',
      '20260729_640x360.jpg',
      '20260730_640x360.jpg',
      '20260729_1920x1080.jpg',
      '20260730_1920x1080.jpg'
    ]);
    assert.strictEqual(harness.fetcher.stats.maxActive, 1);
    assert.strictEqual(harness.cache.store.size, 10);
  });

  it('checks Cache Storage before fetching and skips cached responses', async () => {
    const harness = makeHarness({
      catalog: catalogAt([0, -1]),
      cached: [urlsFor(TARGET).preview, urlsFor(addDays(TARGET, -1)).highDef]
    });
    await harness.scheduler.reconcile();
    assert.deepStrictEqual(harness.fetcher.calls.map(short), [
      '20260728_1920x1080.jpg',
      '20260727_640x360.jpg'
    ]);
  });
});

describe('urgent requests and canonical URL sharing', () => {
  it('promotes a pending task to the front without interrupting the active fetch', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -1, -2, 1]) });
    const target = harness.fetcher.hold(urlsFor(TARGET).preview);
    const drained = harness.scheduler.reconcile();
    await target.started;

    const navigation = harness.scheduler.ensureWallpaperCached({ date: addDays(TARGET, -2), resolution: 'highDef' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(harness.fetcher.stats.active, 1);
    target.release();

    assert.deepStrictEqual(await navigation, { ok: true, status: 'fetched' });
    await drained;
    const order = harness.fetcher.calls.map(short);
    assert.deepStrictEqual(order.slice(0, 2), ['20260728_640x360.jpg', '20260726_1920x1080.jpg']);
    assert.strictEqual(order.filter(url => url === '20260726_1920x1080.jpg').length, 1);
    assert.strictEqual(harness.fetcher.stats.maxActive, 1);
  });

  it('moves a repeated urgent request back to the front of pending work', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -1, -2]), cached: [urlsFor(TARGET).preview] });
    const target = harness.fetcher.hold(urlsFor(TARGET).highDef);
    const drained = harness.scheduler.reconcile();
    await target.started;

    const a = { date: addDays(TARGET, -1), resolution: 'highDef' };
    const b = { date: addDays(TARGET, -2), resolution: 'highDef' };
    const requests = [a, b, a].map(request => harness.scheduler.ensureWallpaperCached(request));
    target.release();
    await Promise.all([...requests, drained]);

    assert.deepStrictEqual(harness.fetcher.calls.map(short).slice(0, 3), [
      '20260728_1920x1080.jpg',
      '20260727_1920x1080.jpg',
      '20260726_1920x1080.jpg'
    ]);
  });

  it('re-derives background work on an event that arrives while only urgent work is pending', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -1, -2]) });
    await harness.scheduler.reconcile();
    harness.cache.store.delete(urlsFor(TARGET).highDef);

    const history = harness.fetcher.hold(urlsFor(addDays(TARGET, -1)).highDef);
    harness.cache.store.delete(urlsFor(addDays(TARGET, -1)).highDef);
    harness.cache.store.delete(urlsFor(addDays(TARGET, -2)).highDef);
    const first = harness.scheduler.ensureWallpaperCached({ date: addDays(TARGET, -1), resolution: 'highDef' });
    await history.started;
    const second = harness.scheduler.ensureWallpaperCached({ date: addDays(TARGET, -2), resolution: 'highDef' });
    const drained = harness.scheduler.reconcile();
    history.release();
    await Promise.all([first, second, drained]);

    assert.ok(harness.cache.store.has(urlsFor(TARGET).highDef), 'evicted target final is repaired');
  });

  it('shares an active fetch with urgent callers instead of starting another', async () => {
    const harness = makeHarness();
    const final = harness.fetcher.hold(urlsFor(TARGET).highDef);
    const drained = harness.scheduler.reconcile();
    await final.started;

    const first = harness.scheduler.ensureWallpaperCached({ date: TARGET, resolution: 'highDef' });
    const second = harness.scheduler.ensureWallpaperCached({ date: TARGET, resolution: 'highDef' });
    final.release();

    assert.deepStrictEqual(await first, { ok: true, status: 'fetched' });
    assert.deepStrictEqual(await second, { ok: true, status: 'fetched' });
    await drained;
    assert.strictEqual(harness.fetcher.calls.filter(url => url === urlsFor(TARGET).highDef).length, 1);
  });

  it('answers a cached request from Cache Storage without network access', async () => {
    const harness = makeHarness({ cached: [urlsFor(TARGET).highDef] });
    assert.deepStrictEqual(
      await harness.scheduler.ensureWallpaperCached({ date: TARGET, resolution: 'highDef' }),
      { ok: true, status: 'cached' }
    );
    assert.deepStrictEqual(harness.fetcher.calls, []);
  });

  it('rejects arbitrary dates, resolutions and non-retained URLs', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -9]) });
    const rejected = [
      { date: '2026-07-28', resolution: 'highDef' },
      { date: TARGET, resolution: '_1920x1080.jpg' },
      { date: TARGET, url: urlsFor(TARGET).highDef },
      { date: addDays(TARGET, -3), resolution: 'highDef' },
      // UHD is not the configured final resolution.
      { date: TARGET, resolution: 'ultraHighDef' },
      // Outside the retention window.
      { date: addDays(TARGET, -9), resolution: 'preview' }
    ];
    for (const request of rejected) {
      const result = await harness.scheduler.ensureWallpaperCached(request);
      assert.strictEqual(result.ok, false, JSON.stringify(request));
    }
    assert.deepStrictEqual(harness.fetcher.calls, []);
  });
});

describe('imagePrefetchGeneration and resolution changes', () => {
  it('caches a retained stale-generation response once and skips it after the queue is rebuilt', async () => {
    const harness = makeHarness({ catalog: catalogAt([0]) });
    const preview = harness.fetcher.hold(urlsFor(TARGET).preview);
    const first = harness.scheduler.reconcile();
    await preview.started;

    // A catalog key change increments the generation while the fetch is active.
    harness.local.data[STORAGE_KEYS.catalog] = catalogAt([0, -1]);
    const second = harness.scheduler.reconcile();
    preview.release();
    await Promise.all([first, second]);
    await harness.scheduler.reconcile();

    assert.strictEqual(harness.fetcher.calls.filter(url => url === urlsFor(TARGET).preview).length, 1);
    assert.ok(harness.cache.store.has(urlsFor(TARGET).preview));
    assert.ok(harness.cache.store.has(urlsFor(addDays(TARGET, -1)).highDef));
  });

  it('stops dispatching pending work for keys that left the catalog', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -1]) });
    const preview = harness.fetcher.hold(urlsFor(TARGET).preview);
    const first = harness.scheduler.reconcile();
    await preview.started;

    harness.local.data[STORAGE_KEYS.catalog] = catalogAt([0, -1], { variants: { [addDays(TARGET, -1)]: 'B' } });
    const second = harness.scheduler.reconcile();
    preview.release();
    await Promise.all([first, second]);

    const oldHistory = urlsFor(addDays(TARGET, -1));
    assert.ok(!harness.fetcher.calls.includes(oldHistory.preview));
    assert.ok(!harness.fetcher.calls.includes(oldHistory.highDef));
    assert.ok(harness.fetcher.calls.includes(urlsFor(addDays(TARGET, -1), 'B').preview));
  });

  it('switches to UHD current-first, history, then future without re-fetching previews, cleaning old keys before the future batch', async () => {
    const offsets = [0, -1, 1];
    const cached = offsets.flatMap(offset => {
      const urls = urlsFor(addDays(TARGET, offset));
      return [urls.preview, urls.highDef];
    });
    const harness = makeHarness({ catalog: catalogAt(offsets), cached });
    await harness.scheduler.reconcile();
    assert.deepStrictEqual(harness.fetcher.calls, []);

    harness.sync.data.enable_uhd_wallpaper = 'yes';
    const future = harness.fetcher.hold(urlsFor(addDays(TARGET, 1)).ultraHighDef);
    const drained = harness.scheduler.reconcile();
    await future.started;
    const hdKeys = [...harness.cache.store.keys()].filter(url => url.endsWith('_1920x1080.jpg'));
    assert.deepStrictEqual(hdKeys, [], 'old-resolution keys are removed before the future batch');
    future.release();
    await drained;

    assert.deepStrictEqual(harness.fetcher.calls.map(short), [
      '20260728_UHD.jpg',
      '20260727_UHD.jpg',
      '20260729_UHD.jpg'
    ]);
  });

  it("fetches the displayed wallpaper's new final resolution first when the resolution changes", async () => {
    const offsets = [0, -1, -2, -3, -4, -5, 1];
    const displayed = addDays(TARGET, -5);
    const cached = offsets.flatMap(offset => {
      const urls = urlsFor(addDays(TARGET, offset));
      return [urls.preview, urls.highDef];
    });
    const harness = makeHarness({ catalog: catalogAt(offsets), displayState: displayStateFor(displayed), cached });
    await harness.scheduler.reconcile();
    assert.deepStrictEqual(harness.fetcher.calls, []);

    harness.sync.data.enable_uhd_wallpaper = 'yes';
    await harness.scheduler.reconcile({ resolutionChanged: true });

    assert.deepStrictEqual(harness.fetcher.calls.map(short), [
      '20260723_UHD.jpg',
      '20260728_UHD.jpg',
      '20260727_UHD.jpg',
      '20260726_UHD.jpg',
      '20260725_UHD.jpg',
      '20260724_UHD.jpg',
      '20260729_UHD.jpg'
    ]);
    assert.strictEqual(harness.fetcher.stats.maxActive, 1);
  });

  it('keeps the baseline order on a resolution change before any display snapshot exists', async () => {
    const cached = [0, -1].map(offset => urlsFor(addDays(TARGET, offset)).preview);
    const harness = makeHarness({ catalog: catalogAt([0, -1]), cached, uhd: 'yes' });
    await harness.scheduler.reconcile({ resolutionChanged: true });

    assert.deepStrictEqual(harness.fetcher.calls.map(short), ['20260728_UHD.jpg', '20260727_UHD.jpg']);
  });

  it('does not promote a displayed date whose catalog identity has changed', async () => {
    const displayed = addDays(TARGET, -2);
    const cached = [0, -1, -2].flatMap(offset => [urlsFor(addDays(TARGET, offset)).preview]);
    const harness = makeHarness({
      catalog: catalogAt([0, -1, -2]),
      displayState: displayStateFor(displayed, { variant: 'B' }),
      cached,
      uhd: 'yes'
    });
    await harness.scheduler.reconcile({ resolutionChanged: true });

    assert.deepStrictEqual(harness.fetcher.calls.map(short), [
      '20260728_UHD.jpg',
      '20260727_UHD.jpg',
      '20260726_UHD.jpg'
    ]);
  });

  it('discards an obsolete active old-resolution response without recording success or failure', async () => {
    const harness = makeHarness({ catalog: catalogAt([0]), cached: [urlsFor(TARGET).preview] });
    const hd = harness.fetcher.hold(urlsFor(TARGET).highDef);
    const first = harness.scheduler.reconcile();
    await hd.started;

    harness.sync.data.enable_uhd_wallpaper = 'yes';
    const second = harness.scheduler.reconcile();
    hd.release();
    await Promise.all([first, second]);

    assert.ok(!harness.cache.store.has(urlsFor(TARGET).highDef));
    assert.ok(harness.cache.store.has(urlsFor(TARGET).ultraHighDef));
    assert.deepStrictEqual(catalogOf(harness).refreshState.imageFailures, {});
    assert.deepStrictEqual(harness.broadcasts, [{ type: 'wallpaperCatalogUpdated', dates: [TARGET] }]);
  });

  it('keeps sharing one task across rapid HD to UHD to HD changes', async () => {
    const harness = makeHarness({ catalog: catalogAt([0]), cached: [urlsFor(TARGET).preview] });
    const hd = harness.fetcher.hold(urlsFor(TARGET).highDef);
    const first = harness.scheduler.reconcile();
    await hd.started;

    harness.sync.data.enable_uhd_wallpaper = 'yes';
    const second = harness.scheduler.reconcile();
    harness.sync.data.enable_uhd_wallpaper = 'no';
    const third = harness.scheduler.reconcile();
    hd.release();
    await Promise.all([first, second, third]);

    assert.deepStrictEqual(harness.fetcher.calls, [urlsFor(TARGET).highDef]);
    assert.ok(harness.cache.store.has(urlsFor(TARGET).highDef));
  });
});

describe('image failures and retry', () => {
  it('records an independent retry level per failed URL and continues with later work', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -1, 1]) });
    const failedTarget = urlsFor(TARGET).highDef;
    const failedHistory = urlsFor(addDays(TARGET, -1)).preview;
    harness.fetcher.failing.add(failedTarget).add(failedHistory);
    await harness.scheduler.reconcile();

    const failures = catalogOf(harness).refreshState.imageFailures;
    assert.deepStrictEqual(Object.keys(failures).sort(), [failedTarget, failedHistory].sort());
    assert.strictEqual(failures[failedTarget].retryLevel, 1);
    assert.strictEqual(failures[failedTarget].nextRetryAt, harness.clock.time + MINUTE);
    // Future work still ran after the target and historical failures.
    assert.ok(harness.cache.store.has(urlsFor(addDays(TARGET, 1)).highDef));
    assert.strictEqual(harness.cache.store.size, 4);
  });

  it('skips URLs inside their backoff window and escalates 1, 3, 5, 5 minutes on later events', async () => {
    const harness = makeHarness({ catalog: catalogAt([0]), cached: [urlsFor(TARGET).preview] });
    const url = urlsFor(TARGET).highDef;
    harness.fetcher.failing.add(url);
    const start = harness.clock.time;

    await harness.scheduler.reconcile();
    harness.clock.time = start + MINUTE - 1;
    await harness.scheduler.reconcile();
    assert.strictEqual(harness.fetcher.calls.length, 1, 'backoff window suppresses the retry');
    assert.deepStrictEqual(
      await harness.scheduler.ensureWallpaperCached({ date: TARGET, resolution: 'highDef' }),
      { ok: true, status: 'backoff' }
    );

    const delays = [];
    for (let i = 0; i < 3; i++) {
      const failure = catalogOf(harness).refreshState.imageFailures[url];
      harness.clock.time = failure.nextRetryAt;
      await harness.scheduler.reconcile();
      const next = catalogOf(harness).refreshState.imageFailures[url];
      delays.push((next.nextRetryAt - next.attemptedAt) / MINUTE);
    }
    assert.deepStrictEqual(delays, [3, 5, 5]);
    assert.strictEqual(catalogOf(harness).refreshState.imageFailures[url].retryLevel, 3);

    harness.fetcher.failing.delete(url);
    harness.clock.time = catalogOf(harness).refreshState.imageFailures[url].nextRetryAt;
    await harness.scheduler.reconcile();
    assert.ok(harness.cache.store.has(url));
    assert.deepStrictEqual(catalogOf(harness).refreshState.imageFailures, {});
  });

  it('lets a reconnect bypass one active window without resetting the level', async () => {
    const harness = makeHarness({ catalog: catalogAt([0]), cached: [urlsFor(TARGET).preview] });
    const url = urlsFor(TARGET).highDef;
    harness.fetcher.failing.add(url);
    // Fetches take time, so each failure starts its window after the reconnect.
    harness.fetcher.onFetch = () => { harness.clock.time += 10; };
    await harness.scheduler.reconcile();

    harness.clock.time += 1000;
    await harness.scheduler.reconcile({ reconnect: true });
    assert.strictEqual(harness.fetcher.calls.length, 2, 'reconnect bypasses the active window');
    assert.strictEqual(catalogOf(harness).refreshState.imageFailures[url].retryLevel, 2);

    harness.clock.time += 1000;
    await harness.scheduler.reconcile({ reconnect: true });
    await harness.scheduler.reconcile();
    assert.strictEqual(harness.fetcher.calls.length, 3, 'a new failure window allows one more bypass');

    harness.clock.time += 1000;
    await harness.scheduler.reconcile();
    assert.strictEqual(harness.fetcher.calls.length, 3, 'a plain event never bypasses');
    assert.strictEqual(catalogOf(harness).refreshState.imageFailures[url].retryLevel, 3);
  });

  it('does not let a backoff-skipped historical image block future work', async () => {
    const history = urlsFor(addDays(TARGET, -1)).preview;
    const catalog = catalogAt([0, -1, 1]);
    catalog.refreshState.imageFailures[history] = {
      attemptedAt: 999_000, nextRetryAt: 1_000_000 + MINUTE, retryLevel: 1, lastReconnectBypassAt: 0
    };
    const harness = makeHarness({ catalog });
    await harness.scheduler.reconcile();

    assert.ok(!harness.fetcher.calls.includes(history));
    assert.ok(harness.cache.store.has(urlsFor(addDays(TARGET, 1)).preview));
    assert.ok(harness.cache.store.has(urlsFor(addDays(TARGET, 1)).highDef));
  });

  it('deletes retry state of URLs that are no longer referenced', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -1]) });
    const history = urlsFor(addDays(TARGET, -1)).highDef;
    harness.fetcher.failing.add(history);
    await harness.scheduler.reconcile();
    assert.ok(history in catalogOf(harness).refreshState.imageFailures);

    harness.local.data[STORAGE_KEYS.catalog].entries = {
      [TARGET]: harness.local.data[STORAGE_KEYS.catalog].entries[TARGET]
    };
    await harness.scheduler.reconcile();
    assert.deepStrictEqual(catalogOf(harness).refreshState.imageFailures, {});
  });
});

describe('retention and cleanup', () => {
  it('bounds Cache Storage to 30 base keys plus two display-protection keys after cleanup', async () => {
    const offsets = Array.from({ length: 15 }, (_, i) => i - 7);
    const outside = addDays(TARGET, -10);
    const displayed = urlsFor(outside);
    const old = urlsFor(addDays(TARGET, -8));
    const oldUhd = urlsFor(addDays(TARGET, -1)).ultraHighDef;
    const harness = makeHarness({
      catalog: catalogAt(offsets),
      displayState: displayStateFor(outside),
      cached: [displayed.preview, displayed.highDef, old.preview, old.highDef, oldUhd]
    });
    await harness.scheduler.reconcile();

    const keys = [...harness.cache.store.keys()];
    assert.strictEqual(keys.length, 32);
    assert.ok(keys.includes(displayed.preview) && keys.includes(displayed.highDef));
    assert.ok(!keys.includes(old.preview) && !keys.includes(old.highDef) && !keys.includes(oldUhd));
    // Display-protection keys are retained, never downloaded.
    assert.strictEqual(harness.fetcher.calls.length, 30);
  });

  it('reads but never writes the page-owned display state', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, -1, 1]), displayState: displayStateFor(addDays(TARGET, -1)) });
    harness.fetcher.failing.add(urlsFor(addDays(TARGET, -1)).preview);
    await harness.scheduler.reconcile();
    await harness.scheduler.ensureWallpaperCached({ date: TARGET, resolution: 'highDef' });
    assert.ok(!harness.local.writtenKeys.includes(STORAGE_KEYS.displayState));
    assert.deepStrictEqual(harness.local.data[STORAGE_KEYS.displayState], displayStateFor(addDays(TARGET, -1)));
  });

  it('broadcasts the affected date after each cache success', async () => {
    const harness = makeHarness({ catalog: catalogAt([0]), cached: [urlsFor(TARGET).preview] });
    await harness.scheduler.reconcile();
    assert.deepStrictEqual(harness.broadcasts, [{ type: 'wallpaperCatalogUpdated', dates: [TARGET] }]);
  });
});

describe('cachedFutureDepth', () => {
  it('records consecutive future dates with preview and final cached, stopping at a gap', async () => {
    const harness = makeHarness({ catalog: catalogAt([0, 1, 2, 3]) });
    harness.fetcher.failing.add(urlsFor(addDays(TARGET, 2)).highDef);
    await harness.scheduler.reconcile();
    assert.strictEqual(catalogOf(harness).refreshState.cachedFutureDepth, 1);

    harness.fetcher.failing.clear();
    harness.clock.time += 5 * MINUTE;
    await harness.scheduler.reconcile();
    assert.strictEqual(catalogOf(harness).refreshState.cachedFutureDepth, 3);
  });

  it('never lets a stale diagnostic depth suppress cache checks or prefetch', async () => {
    const catalog = catalogAt([0, 1, 2]);
    catalog.refreshState.cachedFutureDepth = 7;
    const harness = makeHarness({ catalog });
    await harness.scheduler.reconcile();
    assert.strictEqual(harness.fetcher.calls.length, 6);
    assert.strictEqual(catalogOf(harness).refreshState.cachedFutureDepth, 2);
  });

  it('counts preview-only future hits as not cached and follows resolution changes', async () => {
    const future = urlsFor(addDays(TARGET, 1));
    const harness = makeHarness({ catalog: catalogAt([0, 1]) });
    await harness.scheduler.reconcile();
    assert.strictEqual(catalogOf(harness).refreshState.cachedFutureDepth, 1);

    harness.sync.data.enable_uhd_wallpaper = 'yes';
    harness.fetcher.failing.add(future.ultraHighDef);
    await harness.scheduler.reconcile();
    assert.ok(harness.cache.store.has(future.preview));
    assert.strictEqual(catalogOf(harness).refreshState.cachedFutureDepth, 0);
  });
});

describe('worker restart', () => {
  for (const [phase, offset, resolution] of [['target', 0, 'highDef'], ['history', -1, 'preview'], ['future', 1, 'highDef']]) {
    it(`retries an interrupted ${phase} fetch on the next event without a cache success`, async () => {
      const harness = makeHarness({ catalog: catalogAt([0, -1, 1]) });
      const url = urlsFor(addDays(TARGET, offset))[resolution];
      const interrupted = harness.fetcher.hold(url);
      harness.scheduler.reconcile();
      await interrupted.started;
      assert.ok(!harness.cache.store.has(url));

      const completedBefore = new Set(harness.cache.store.keys());

      // The terminated worker's fetch never resolves.
      harness.restart();
      await harness.scheduler.reconcile();

      assert.deepStrictEqual(harness.fetcher.calls.filter(call => call === url), [url]);
      assert.ok(harness.cache.store.has(url));
      // Work completed before termination is not fetched again.
      assert.ok(harness.fetcher.calls.every(call => !completedBefore.has(call)));
      assert.strictEqual(harness.cache.store.size, 6);
    });
  }
});
