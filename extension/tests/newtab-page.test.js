import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_KEY = 'bing_wallpaper_catalog_v2';
const DISPLAY_STATE_KEY = 'wallpaper_display_state_v2';
const CACHE_NAME = 'funbingbing-wallpaper-cache-v2';

const TARGET = '20261013';
const ID = 'OHR.Target_ZH-CN1000000001';
const PREVIEW = `https://ts1.tc.mm.bing.net/th?id=${ID}_640x360.jpg`;
const UHD = `https://ts1.tc.mm.bing.net/th?id=${ID}_UHD.jpg`;
const PREVIEW_DATA_URL = `data:image/jpeg;base64,${Buffer.from(PREVIEW).toString('base64')}`;

const OLDER = '20261012';
const OLDER_ID = 'OHR.Older_ZH-CN1000000002';
const OLDER_UHD = `https://ts1.tc.mm.bing.net/th?id=${OLDER_ID}_UHD.jpg`;

function catalog() {
  const entry = (date, imageId, headline) => ({
    date,
    imageId,
    headline,
    urls: {
      preview: `https://ts1.tc.mm.bing.net/th?id=${imageId}_640x360.jpg`,
      highDef: `https://ts1.tc.mm.bing.net/th?id=${imageId}_1920x1080.jpg`,
      ultraHighDef: `https://ts1.tc.mm.bing.net/th?id=${imageId}_UHD.jpg`
    }
  });
  return {
    version: 2,
    refreshState: { date: TARGET },
    entries: {
      [TARGET]: entry(TARGET, ID, 'Target headline'),
      [OLDER]: entry(OLDER, OLDER_ID, 'Older headline')
    }
  };
}

function fakeElement() {
  return {
    style: {},
    textContent: '',
    innerHTML: '',
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => fakeElement(),
    append() {},
    appendChild() {}
  };
}

/**
 * Run the real boot.js, and the wallpaper.js it loads, as classic scripts in
 * one global scope against mocked Chrome, Cache Storage and DOM. `worker`
 * answers ensureWallpaperCached requests; `undecodable` lists cached image
 * URLs whose decoding fails.
 */
async function openNewTab({ local = {}, cached = [], undecodable = [], networkStatus = 'online', worker = () => ({ ok: false }) } = {}) {
  const page = {
    local: structuredClone(local),
    cache: new Set(cached),
    cacheNames: new Set(),
    cacheWrites: 0,
    fetched: [],
    messages: [],
    backgrounds: [],
    listeners: []
  };

  const elements = new Map();
  const body = fakeElement();
  body.style = {
    backgroundColor: '',
    get backgroundImage() { return page.backgrounds.at(-1) ?? ''; },
    set backgroundImage(value) { page.backgrounds.push(value); }
  };
  elements.set('main-body', body);
  page.element = (id) => {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  };

  const context = vm.createContext({
    console: { log() {}, debug() {}, warn() {}, error: console.error },
    setTimeout,
    Buffer,
    readConf: key => page.local[key],
    readStorageKey: async key => structuredClone(page.local[key]),
    writeConf: async (key, value) => { page.local[key] = structuredClone(value); },
    i18n: key => key,
    fetch: async (url) => {
      page.fetched.push(String(url));
      return { ok: false };
    },
    caches: {
      async open(name) {
        page.cacheNames.add(name);
        return {
          match: async url => (page.cache.has(url) ? { blob: async () => ({ url }) } : undefined),
          put: async () => { page.cacheWrites += 1; }
        };
      }
    },
    URL: { createObjectURL: blob => `blob:${blob.url}`, revokeObjectURL() {} },
    Image: class {
      decode() {
        return undecodable.includes(this.src.slice('blob:'.length))
          ? Promise.reject(new Error('The source image cannot be decoded.'))
          : Promise.resolve();
      }
    },
    FileReader: class {
      readAsDataURL(blob) {
        this.result = `data:image/jpeg;base64,${Buffer.from(blob.url).toString('base64')}`;
        queueMicrotask(() => this.onloadend());
      }
    },
    chrome: {
      runtime: {
        getURL: file => pathToFileURL(path.join(ROOT, file)).href,
        onMessage: { addListener: listener => page.listeners.push(listener) },
        sendMessage(message, callback) {
          // Cloned into this realm so assertions can compare it structurally.
          page.messages.push(structuredClone(message));
          const response = Promise.resolve(message.type === 'ensureWallpaperCached' ? worker(message, page) : { ok: true });
          if (callback) {
            response.then(callback);
            return undefined;
          }
          return response;
        }
      },
      storage: { sync: { get: async () => ({}) } }
    }
  });
  context.window = context;
  context.addEventListener = () => {};
  context.confReadyPromise = Promise.resolve();

  const run = file => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, {
    filename: path.join(ROOT, file),
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
  });
  context.document = {
    documentElement: { dataset: { networkStatus } },
    getElementById: page.element,
    createElement: () => fakeElement(),
    // boot.js loads the page scripts by appending script elements.
    body: {
      appendChild(script) {
        if (script.src === 'scripts/main/wallpaper.js') run(script.src);
        script.onload();
      }
    }
  };

  run('scripts/boot.js');
  page.settled = async (condition) => {
    for (let i = 0; i < 200 && !condition(); i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(condition(), 'the page did not reach the expected state');
  };
  return page;
}

describe('new tab page scripts', () => {
  it('paints the committed preview at boot, then applies the cached final image without fetching it', async () => {
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: 42 };
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog(), [DISPLAY_STATE_KEY]: snapshot },
      cached: [PREVIEW, UHD]
    });

    await page.settled(() => page.backgrounds.length === 2);

    assert.deepStrictEqual(page.backgrounds, [`url('${PREVIEW_DATA_URL}')`, `url('blob:${UHD}')`]);
    assert.strictEqual(page.element('headline').textContent, 'Target headline');
    assert.deepStrictEqual(page.local[DISPLAY_STATE_KEY], snapshot);
    assert.deepStrictEqual([...page.cacheNames], [CACHE_NAME]);
    assert.strictEqual(page.cacheWrites, 0);
    assert.deepStrictEqual(page.fetched.filter(url => url.includes('bing.net')), [], 'no wallpaper image is fetched');
    assert.ok(page.messages.some(message => message.type === 'refreshWallpaperCatalog'));
  });

  it('asks the worker for a missing final image and records it once applied', async () => {
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog() },
      worker: ({ date, resolution }, opened) => {
        opened.cache.add(opened.local[CATALOG_KEY].entries[date].urls[resolution]);
        return { ok: true, status: 'fetched' };
      }
    });

    await page.settled(() => page.local[DISPLAY_STATE_KEY]?.preloadDataUrl);

    assert.deepStrictEqual(page.backgrounds, [`url('blob:${UHD}')`]);
    assert.deepStrictEqual(
      page.messages.filter(message => message.type === 'ensureWallpaperCached'),
      [
        { type: 'ensureWallpaperCached', date: TARGET, resolution: 'ultraHighDef' },
        { type: 'ensureWallpaperCached', date: TARGET, resolution: 'preview' }
      ]
    );
    const { updatedAt, ...published } = page.local[DISPLAY_STATE_KEY];
    assert.deepStrictEqual(published, { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL });
    assert.strictEqual(typeof updatedAt, 'number');
    assert.strictEqual(page.cacheWrites, 0);
  });

  it('displays the cached wallpaper when the tab opens offline', async () => {
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: 42 };
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog(), [DISPLAY_STATE_KEY]: snapshot },
      cached: [PREVIEW, UHD],
      networkStatus: 'offline'
    });

    await page.settled(() => page.backgrounds.length === 2);

    assert.deepStrictEqual(page.backgrounds, [`url('${PREVIEW_DATA_URL}')`, `url('blob:${UHD}')`]);
  });

  it('keeps the current wallpaper, headline and snapshot when the destination image cannot be decoded', async () => {
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: 42 };
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog(), [DISPLAY_STATE_KEY]: snapshot },
      cached: [PREVIEW, UHD, OLDER_UHD],
      undecodable: [OLDER_UHD]
    });
    await page.settled(() => page.backgrounds.length === 2);

    await page.element('leftNav').onclick();

    assert.strictEqual(page.backgrounds.at(-1), `url('blob:${UHD}')`);
    assert.strictEqual(page.element('headline').textContent, 'Target headline');
    assert.deepStrictEqual(page.local[DISPLAY_STATE_KEY], snapshot);
  });

  it('exposes the gradient with no inline color when nothing can be displayed', async () => {
    const page = await openNewTab();

    await page.settled(() => page.backgrounds.length === 1);

    assert.deepStrictEqual(page.backgrounds, ['']);
    assert.strictEqual(page.element('main-body').style.backgroundColor, '');
    assert.strictEqual(page.local[DISPLAY_STATE_KEY], undefined);
  });
});
