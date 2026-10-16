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
const QUOTE_STATE_KEY = 'cache_quote_state_v2';

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
 * answers ensureWallpaperCached requests, `quotes` the quote lease and
 * submission messages, `migration` the migrationStatus request (by default
 * the stored marker phase) and `acknowledge` the migrationDisplayStateReady
 * acknowledgement; `undecodable` lists cached image URLs whose decoding
 * fails. `heldReads` maps local keys to promises that their fresh reads wait
 * for. `quotePage` maps selectors to elements of Bing's parsed quote page;
 * without it the quote page cannot be fetched.
 */
async function openNewTab({ local = {}, cached = [], undecodable = [], networkStatus = 'online', worker = () => ({ ok: false }), quotes = () => ({ ok: true }), acknowledge = () => ({ ok: true }), migration = (message, opened) => ({ phase: opened.local.wallpaper_migration_v2_state?.phase ?? null }), heldReads = {}, quotePage } = {}) {
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
    readStorageKey: async (key) => {
      await heldReads[key];
      return structuredClone(page.local[key]);
    },
    writeConf: async (key, value) => { page.local[key] = structuredClone(value); },
    i18n: key => key,
    fetch: async (url) => {
      page.fetched.push(String(url));
      return quotePage && String(url).includes('quote%20of%20the%20day')
        ? { ok: true, text: async () => '<html></html>' }
        : { ok: false };
    },
    DOMParser: class {
      parseFromString() {
        return { querySelector: selector => quotePage?.[selector] ?? null };
      }
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
          const answer = message.type === 'ensureWallpaperCached' ? worker(message, page)
            : /quote/i.test(message.type) ? quotes(message, page)
              : message.type === 'migrationDisplayStateReady' ? acknowledge(message, page)
                : message.type === 'migrationStatus' ? migration(message, page) : { ok: true };
          const response = Promise.resolve(answer);
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
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
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
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog(), [DISPLAY_STATE_KEY]: snapshot },
      cached: [PREVIEW, UHD],
      networkStatus: 'offline'
    });

    await page.settled(() => page.backgrounds.length === 2);

    assert.deepStrictEqual(page.backgrounds, [`url('${PREVIEW_DATA_URL}')`, `url('blob:${UHD}')`]);
  });

  it('keeps the current wallpaper, headline and snapshot when the destination image cannot be decoded', async () => {
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
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

  it("renders the displayed date's quote from the worker's v2 quote cache", async () => {
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
    const page = await openNewTab({
      local: {
        [CATALOG_KEY]: catalog(),
        [DISPLAY_STATE_KEY]: snapshot,
        [QUOTE_STATE_KEY]: { quotes: { [TARGET]: { text: 'Target quote', source: 'Author', caption: 'Caption', link: '' } } }
      },
      cached: [PREVIEW, UHD]
    });

    await page.settled(() => page.backgrounds.length === 2);

    assert.strictEqual(page.element('quote-text').textContent, '“Target quote”');
    assert.strictEqual(page.element('quote-caption').textContent, 'Caption');
  });

  it("scrapes Bing's quote only while holding the worker's lease and submits the result with its token", async () => {
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog() },
      quotes: message => (message.type === 'requestQuoteLease'
        ? { granted: true, date: TARGET, token: 'lease-token', scrape: true }
        : { ok: true, updatedDates: [] })
    });

    await page.settled(() => page.messages.some(message => message.type === 'syncQuotesForImages'));

    assert.deepStrictEqual(page.fetched.filter(url => url.includes('quote%20of%20the%20day')).length, 1);
    // The scrape fails in this harness, so the worker is left to its qotd_url fallback.
    assert.deepStrictEqual(page.messages.find(message => message.type === 'syncQuotesForImages'),
      { type: 'syncQuotesForImages', date: TARGET, token: 'lease-token', quote: null });
  });

  it("submits a scraped quote without a caption element with an empty caption", async () => {
    const author = { textContent: 'Author', closest: () => ({ getAttribute: () => '/search?q=Author' }) };
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog() },
      quotes: message => (message.type === 'requestQuoteLease'
        ? { granted: true, date: TARGET, token: 'lease-token', scrape: true }
        : { ok: true, updatedDates: [] }),
      // Bing's quote page with text and author but no caption element.
      quotePage: {
        '.bt_quoteText': { textContent: '“Usable Bing quote”', getAttribute: () => null },
        '.qotd_author': author
      }
    });

    await page.settled(() => page.messages.some(message => message.type === 'syncQuotesForImages'));

    assert.deepStrictEqual(page.messages.find(message => message.type === 'syncQuotesForImages').quote,
      { text: 'Usable Bing quote', source: 'Author', link: '/search?q=Author', caption: '' });
  });

  it("does not scrape Bing's quote without a lease", async () => {
    const page = await openNewTab({ local: { [CATALOG_KEY]: catalog() }, quotes: () => ({ granted: false }) });

    await page.settled(() => page.messages.some(message => message.type === 'requestQuoteLease'));
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.deepStrictEqual(page.fetched, []);
    assert.ok(!page.messages.some(message => message.type === 'syncQuotesForImages'));
  });

  describe('migration display-state handoff', () => {
    const MIGRATION_KEY = 'wallpaper_migration_v2_state';
    const verified = { [MIGRATION_KEY]: { version: 2, phase: 'verified', startedAt: 1, verifiedAt: 1, completedAt: 0 } };
    const LEGACY_INPUTS = { wallpaper_url: `https://cn.bing.com/th?id=${OLDER_ID}_UHD.jpg`, wallpaper_date: TARGET, wallpaper_idx: '1' };
    // Records the display state the worker would fresh-read on acknowledgement.
    const recordAcknowledged = (message, opened) => {
      opened.acknowledged = structuredClone(opened.local[DISPLAY_STATE_KEY]);
      return { ok: true };
    };

    it('the first page after verification writes the legacy display identity, then acknowledges it and shows it', async () => {
      const page = await openNewTab({
        local: { ...verified, ...LEGACY_INPUTS, [CATALOG_KEY]: catalog() },
        cached: [OLDER_UHD],
        acknowledge: recordAcknowledged
      });

      await page.settled(() => page.backgrounds.length === 1);

      const migrated = { date: OLDER, imageId: OLDER_ID, url: OLDER_UHD, preloadDataUrl: '', updatedAt: 0 };
      assert.deepStrictEqual(page.acknowledged, migrated);
      assert.deepStrictEqual(page.backgrounds, [`url('blob:${OLDER_UHD}')`]);
      assert.deepStrictEqual(page.local[DISPLAY_STATE_KEY], migrated);
    });

    it('writes the explicit empty display state when the legacy identity is not in the catalog', async () => {
      const page = await openNewTab({
        local: { ...verified, wallpaper_url: 'https://ts1.tc.mm.bing.net/th?id=OHR.Gone_ZH-CN9_UHD.jpg', wallpaper_date: TARGET, [CATALOG_KEY]: catalog() },
        acknowledge: recordAcknowledged
      });

      await page.settled(() => page.messages.some(message => message.type === 'migrationDisplayStateReady'));

      assert.deepStrictEqual(page.acknowledged, { date: '', imageId: '', url: '', preloadDataUrl: '', updatedAt: 0 });
    });

    it('keeps a valid v2 display state over the legacy inputs and still acknowledges', async () => {
      const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
      const page = await openNewTab({
        local: { ...verified, ...LEGACY_INPUTS, [CATALOG_KEY]: catalog(), [DISPLAY_STATE_KEY]: snapshot },
        cached: [PREVIEW, UHD, OLDER_UHD],
        acknowledge: recordAcknowledged
      });

      await page.settled(() => page.backgrounds.length === 2 && page.acknowledged);

      assert.deepStrictEqual(page.acknowledged, snapshot);
      assert.strictEqual(page.backgrounds.at(-1), `url('blob:${UHD}')`);
    });

    it('neither reads the legacy inputs nor acknowledges while the worker reports writing, or after completion', async () => {
      for (const phase of ['writing', 'complete']) {
        const page = await openNewTab({
          local: { [MIGRATION_KEY]: { version: 2, phase }, ...LEGACY_INPUTS, [CATALOG_KEY]: catalog() },
          cached: [UHD]
        });

        await page.settled(() => page.backgrounds.length === 1);

        assert.strictEqual(page.backgrounds[0], `url('blob:${UHD}')`, `${phase}: the page starts from the target date`);
        assert.ok(!page.messages.some(message => message.type === 'migrationDisplayStateReady'), phase);
      }
    });

    it('a completed migration costs the page no worker round trip', async () => {
      const page = await openNewTab({
        local: { [MIGRATION_KEY]: { version: 2, phase: 'complete' }, [CATALOG_KEY]: catalog() },
        cached: [UHD],
        migration: () => new Promise(() => {})
      });

      await page.settled(() => page.backgrounds.length === 1);

      assert.ok(!page.messages.some(message => message.type === 'migrationStatus'));
    });

    it('hands off once the worker verifies a migration that was still writing when the page opened', async () => {
      const page = await openNewTab({
        local: { [MIGRATION_KEY]: { version: 2, phase: 'writing' }, ...LEGACY_INPUTS, [CATALOG_KEY]: catalog() },
        cached: [UHD, OLDER_UHD],
        // The worker answers after its start-up run has verified the migration.
        migration: (message, opened) => {
          opened.local[MIGRATION_KEY] = { ...verified[MIGRATION_KEY] };
          return { phase: 'verified' };
        },
        acknowledge: recordAcknowledged
      });

      await page.settled(() => page.backgrounds.length === 1 && page.acknowledged);

      assert.deepStrictEqual(page.acknowledged, { date: OLDER, imageId: OLDER_ID, url: OLDER_UHD, preloadDataUrl: '', updatedAt: 0 });
      assert.deepStrictEqual(page.backgrounds, [`url('blob:${OLDER_UHD}')`], 'the legacy selection is shown, not the target date');
    });

    it('starts at once from a valid v2 snapshot while the worker has not answered', async () => {
      const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
      const page = await openNewTab({
        local: { [MIGRATION_KEY]: { version: 2, phase: 'writing' }, [CATALOG_KEY]: catalog(), [DISPLAY_STATE_KEY]: snapshot },
        cached: [PREVIEW, UHD],
        migration: () => new Promise(() => {})
      });

      await page.settled(() => page.backgrounds.length === 2);

      assert.strictEqual(page.backgrounds.at(-1), `url('blob:${UHD}')`);
    });

    it('a catalog notification during the handoff waits for it, so the screen and snapshot agree', async () => {
      let release;
      const page = await openNewTab({
        local: { ...verified, ...LEGACY_INPUTS, [CATALOG_KEY]: catalog() },
        cached: [UHD, OLDER_UHD],
        heldReads: { wallpaper_url: new Promise((resolve) => { release = resolve; }) }
      });
      await page.settled(() => page.listeners.length > 0);

      for (const listener of page.listeners) listener({ type: 'wallpaperCatalogUpdated', dates: [TARGET] });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.deepStrictEqual(page.backgrounds, [], 'nothing is applied while the handoff reads');
      assert.strictEqual(page.local[DISPLAY_STATE_KEY], undefined);
      release();

      await page.settled(() => page.backgrounds.length >= 1 && page.messages.some(message => message.type === 'migrationDisplayStateReady'));
      await new Promise(resolve => setTimeout(resolve, 20));

      assert.strictEqual(page.local[DISPLAY_STATE_KEY].imageId, OLDER_ID);
      assert.strictEqual(page.backgrounds.at(-1), `url('blob:${OLDER_UHD}')`);
    });

    it('transfers the suffixed display snapshot of an earlier v2 build', async () => {
      const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
      const page = await openNewTab({
        local: { ...verified, ...LEGACY_INPUTS, [CATALOG_KEY]: catalog(), wallpaper_display_state_v2_regular: snapshot },
        cached: [PREVIEW, UHD],
        acknowledge: recordAcknowledged
      });

      await page.settled(() => page.acknowledged && page.backgrounds.at(-1) === `url('blob:${UHD}')`);

      assert.deepStrictEqual(page.acknowledged, snapshot);
    });
  });

  it('applies the wallpaper while quote work is still pending', async () => {
    const snapshot = { date: TARGET, imageId: ID, url: UHD, preloadDataUrl: PREVIEW_DATA_URL, updatedAt: Date.now() };
    const page = await openNewTab({
      local: { [CATALOG_KEY]: catalog(), [DISPLAY_STATE_KEY]: snapshot },
      cached: [PREVIEW, UHD],
      quotes: () => new Promise(() => {})
    });

    await page.settled(() => page.backgrounds.length === 2);

    assert.strictEqual(page.backgrounds.at(-1), `url('blob:${UHD}')`);
    assert.ok(page.messages.some(message => message.type === 'requestQuoteLease'));
  });
});
