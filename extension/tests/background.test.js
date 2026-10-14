import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createEmptyCatalog } from '../src/worker/catalog.js';
import { STORAGE_KEYS } from '../src/worker/storage-keys.js';

const TARGET = '20261013';
const ID = `OHR.Day${TARGET}_ZH-CN1`;
const PREVIEW = `https://ts1.tc.mm.bing.net/th?id=${ID}_640x360.jpg`;
const HD = `https://ts1.tc.mm.bing.net/th?id=${ID}_1920x1080.jpg`;

function storageArea(data) {
  return {
    async get(key) {
      if (key == null) return structuredClone(data);
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
    },
    async set(items) { Object.assign(data, structuredClone(items)); }
  };
}

// Load the real worker module against mocked Chrome, Cache Storage and fetch.
async function loadWorker() {
  const catalog = createEmptyCatalog();
  catalog.refreshState.date = TARGET;
  catalog.entries[TARGET] = {
    date: TARGET,
    imageId: ID,
    urls: { preview: PREVIEW, highDef: HD, ultraHighDef: `https://ts1.tc.mm.bing.net/th?id=${ID}_UHD.jpg` }
  };
  const messageListeners = [];
  const event = () => ({ addListener() {} });
  globalThis.chrome = {
    storage: {
      local: storageArea({ [STORAGE_KEYS.catalog]: catalog }),
      sync: storageArea({ enable_uhd_wallpaper: 'no' }),
      onChanged: event()
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
    }
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
  return { send, fetches, caches };
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
});
