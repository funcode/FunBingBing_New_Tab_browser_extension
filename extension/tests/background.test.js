import { describe, it } from 'node:test';
import assert from 'node:assert';
import { addDays, getZhCnTargetDate } from '../src/helpers/date.js';
import { createEmptyCatalog } from '../src/worker/catalog.js';
import { STORAGE_KEYS } from '../src/worker/storage-keys.js';

const TARGET = getZhCnTargetDate();
const LEGACY_DATE = addDays(TARGET, -1);
const ID = `OHR.Day${TARGET}_ZH-CN1`;
const PREVIEW = `https://ts1.tc.mm.bing.net/th?id=${ID}_640x360.jpg`;
const HD = `https://ts1.tc.mm.bing.net/th?id=${ID}_1920x1080.jpg`;

// `written` records every key set in the area.
function storageArea(data, written = []) {
  return {
    written,
    async get(key) {
      if (key == null) return structuredClone(data);
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
    },
    async set(items) {
      written.push(...Object.keys(items));
      Object.assign(data, structuredClone(items));
    },
    async remove(key) {
      for (const k of Array.isArray(key) ? key : [key]) delete data[k];
    }
  };
}

// Load the real worker module against mocked Chrome, Cache Storage and fetch.
// `entry` adds fields to the catalog's target entry; `local` adds local items.
async function loadWorker({ entry = {}, local = {} } = {}) {
  const catalog = createEmptyCatalog();
  catalog.refreshState.date = TARGET;
  catalog.entries[TARGET] = {
    date: TARGET,
    imageId: ID,
    urls: { preview: PREVIEW, highDef: HD, ultraHighDef: `https://ts1.tc.mm.bing.net/th?id=${ID}_UHD.jpg` },
    ...entry
  };
  const messageListeners = [];
  const changeListeners = [];
  const event = () => ({ addListener() {} });
  const localData = { [STORAGE_KEYS.catalog]: catalog, ...structuredClone(local) };
  globalThis.chrome = {
    storage: {
      local: storageArea(localData),
      sync: storageArea({ enable_uhd_wallpaper: 'no' }),
      onChanged: { addListener: listener => changeListeners.push(listener) }
    },
    runtime: {
      onStartup: event(),
      onInstalled: event(),
      onMessage: { addListener: listener => messageListeners.push(listener) },
      sendMessage: async () => {},
      OnInstalledReason: { INSTALL: 'install' }
    }
  };
  globalThis.self = { addEventListener() {} };

  const caches = new Map();
  globalThis.caches = {
    async open(name) {
      if (!caches.has(name)) {
        const store = new Map();
        caches.set(name, {
          store,
          async match(url) { return store.get(url); },
          async put(url, response) { store.set(url, response); },
          async keys() { return [...store.keys()].map(url => ({ url })); },
          async delete(request) { return store.delete(request.url); }
        });
      }
      return caches.get(name);
    },
    async has(name) { return caches.has(name); },
    async delete(name) { return caches.delete(name); }
  };

  const fetches = { calls: [], active: 0, maxActive: 0, holds: new Map() };
  globalThis.fetch = async (url) => {
    fetches.calls.push(url);
    fetches.active++;
    fetches.maxActive = Math.max(fetches.maxActive, fetches.active);
    try {
      const hold = fetches.holds.get(url);
      if (hold) await hold.gate;
      return { ok: true, url };
    } finally {
      fetches.active--;
    }
  };

  await import(`../scripts/background.js?instance=${Math.random()}`);

  const send = message => new Promise(resolve => {
    for (const listener of messageListeners) listener(message, {}, resolve);
  });
  const change = (changes, area) => changeListeners.forEach(listener => listener(changes, area));
  return { send, change, fetches, caches, local: localData, localWrites: chrome.storage.local.written };
}

describe('worker message handlers', () => {
  it('serves concurrent page image requests through the single image consumer', async () => {
    const worker = await loadWorker();
    let release;
    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    worker.fetches.holds.set(PREVIEW, { gate: new Promise(resolve => { release = resolve; }) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url === PREVIEW) started();
      return originalFetch(url);
    };

    const ensured = worker.send({ type: 'ensureWallpaperCached', date: TARGET, resolution: 'preview' });
    await startedPromise;
    const final = worker.send({ type: 'ensureWallpaperCached', date: TARGET, resolution: 'highDef' });
    await new Promise(resolve => setTimeout(resolve, 10));
    release();

    assert.deepStrictEqual(await ensured, { ok: true, status: 'fetched' });
    assert.deepStrictEqual(await final, { ok: true, status: 'fetched' });

    assert.strictEqual(worker.fetches.maxActive, 1);
    assert.deepStrictEqual(worker.fetches.calls, [PREVIEW, HD]);
    assert.deepStrictEqual([...worker.caches.keys()], ['funbingbing-wallpaper-cache-v2']);
  });

  it("grants a quote lease with a runtime UUID token and accepts only its holder's submission once", async () => {
    const worker = await loadWorker();

    const lease = await worker.send({ type: 'requestQuoteLease' });
    assert.strictEqual(lease.granted, true);
    assert.strictEqual(lease.date, TARGET);
    assert.match(lease.token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepStrictEqual(await worker.send({ type: 'requestQuoteLease' }), { granted: false });

    const quote = { text: 'Quote', source: 'Author', caption: 'Caption' };
    assert.deepStrictEqual(await worker.send({ type: 'syncQuotesForImages', date: TARGET, token: 'forged', quote }),
      { ok: false, rejected: true });
    assert.deepStrictEqual(await worker.send({ type: 'syncQuotesForImages', date: TARGET, token: lease.token, quote }),
      { ok: true, updatedDates: [TARGET] });
    assert.deepStrictEqual(await worker.send({ type: 'syncQuotesForImages', date: TARGET, token: lease.token, quote }),
      { ok: false, rejected: true }, 'a released lease cannot submit again');
  });

  it('migrates v1 state at worker start and completes only after the page acknowledges its display state', async () => {
    const legacyId = 'OHR.Legacy_ZH-CN2';
    const worker = await loadWorker({
      local: {
        bing_images: [{ isoDate: LEGACY_DATE, imageUrls: { landscape: { highDef: `/th?id=${legacyId}_1920x1080.jpg` } } }],
        wallpaper_url: `https://ts1.tc.mm.bing.net/th?id=${legacyId}_1920x1080.jpg`,
        wallpaper_date: LEGACY_DATE,
        wallpaper_preload_data_url: 'data:image/jpeg;base64,TEdBQ1k=',
        show_clock: 'no'
      }
    });

    // Catalog work waits for the migration, which never writes display state.
    await worker.send({ type: 'refreshWallpaperCatalog' });
    assert.strictEqual(worker.local[STORAGE_KEYS.migration].phase, 'verified');
    assert.strictEqual(worker.local[STORAGE_KEYS.catalog].entries[LEGACY_DATE].imageId, legacyId);
    assert.strictEqual(await chrome.storage.sync.get('show_clock').then(items => items.show_clock), 'no');
    assert.ok(!(STORAGE_KEYS.displayState in worker.local));

    assert.deepStrictEqual(await worker.send({ type: 'migrationStatus' }), { phase: 'verified' });
    assert.deepStrictEqual(await worker.send({ type: 'migrationDisplayStateReady' }), { ok: false });
    assert.strictEqual(worker.local[STORAGE_KEYS.migration].phase, 'verified');

    worker.local[STORAGE_KEYS.displayState] = {
      date: LEGACY_DATE, imageId: legacyId, url: `https://ts1.tc.mm.bing.net/th?id=${legacyId}_1920x1080.jpg`, preloadDataUrl: '', updatedAt: 0
    };
    assert.deepStrictEqual(await worker.send({ type: 'migrationDisplayStateReady' }), { ok: true });
    assert.strictEqual(worker.local[STORAGE_KEYS.migration].phase, 'complete');
    assert.ok(!('bing_images' in worker.local));
    assert.ok(!('wallpaper_url' in worker.local));
    assert.ok(!('wallpaper_preload_data_url' in worker.local));
    assert.ok(!worker.localWrites.includes(STORAGE_KEYS.displayState), 'the page is the only display-state writer');
    assert.ok(!worker.localWrites.includes('wallpaper_preload_data_url'));
  });

  it('fetches only the displayed final image in the new resolution when UHD changes in sync', async () => {
    const UHD = `https://ts1.tc.mm.bing.net/th?id=${ID}_UHD.jpg`;
    const worker = await loadWorker({
      local: { [STORAGE_KEYS.displayState]: { date: TARGET, imageId: ID, url: HD, preloadDataUrl: '', updatedAt: Date.now() } }
    });
    const cache = await caches.open('funbingbing-wallpaper-cache-v2');
    await cache.put(PREVIEW, { ok: true });
    await cache.put(HD, { ok: true });
    // Work left over from earlier tests' workers shares the global fetch.
    await new Promise(resolve => setTimeout(resolve, 20));
    worker.fetches.calls.length = 0;

    await chrome.storage.sync.set({ enable_uhd_wallpaper: 'yes' });
    worker.change({ enable_uhd_wallpaper: { oldValue: 'no', newValue: 'yes' } }, 'sync');
    for (let i = 0; i < 100 && !(await cache.match(UHD)); i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.deepStrictEqual(worker.fetches.calls, [UHD], 'no metadata or preview is fetched again');
  });

  it('requests missing trivia for a committed entry after a catalog refresh', async () => {
    const triviaId = `HPQuiz_${TARGET}_Day`;
    const worker = await loadWorker({ entry: { triviaId, triviaData: null, triviaState: 'missing' } });

    await worker.send({ type: 'refreshWallpaperCatalog' });
    const triviaUrl = `https://www.bing.com/hp/api/v1/trivia?format=json&id=${triviaId}&mkt=zh-CN`;
    for (let i = 0; i < 100 && !worker.fetches.calls.includes(triviaUrl); i++) {
      await new Promise(resolve => setImmediate(resolve));
    }

    assert.ok(worker.fetches.calls.includes(triviaUrl));
  });
});
