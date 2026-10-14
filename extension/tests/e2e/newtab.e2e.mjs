/**
 * Browser checks of the new tab page in the actual MV3 extension, loaded into
 * Chromium by Playwright. Run with `npm run test:e2e`.
 *
 * All DNS lookups fail, so no test reaches Bing: the catalog, display state
 * and Cache Storage are seeded through the service worker, and a worker image
 * fetch is stood in for by caching the image and sending the worker's
 * wallpaperCatalogUpdated notification.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { addDays, getZhCnTargetDate } from '../../src/helpers/date.js';
import { buildCanonicalUrls } from '../../src/helpers/image.js';
import { createEmptyCatalog } from '../../src/worker/catalog.js';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG_KEY = 'bing_wallpaper_catalog_v2';
const DISPLAY_STATE_KEY = 'wallpaper_display_state_v2';
const CACHE_NAME = 'funbingbing-wallpaper-cache-v2';
const GRADIENT = 'linear-gradient(160deg, rgb(31, 41, 51), rgb(62, 76, 89))';

const TARGET = getZhCnTargetDate();
const day = (offset, name, color) => {
  const date = addDays(TARGET, offset);
  const imageId = `OHR.${name}_ZH-CN100000000${-offset}`;
  return { date, imageId, color, headline: `${name} headline`, urls: buildCanonicalUrls(imageId) };
};
const A = day(0, 'Target', '#a03020');
const B = day(-1, 'Older', '#2060a0');
const C = day(-2, 'Oldest', '#208040');

function catalogOf(days) {
  const catalog = createEmptyCatalog();
  catalog.refreshState.date = TARGET;
  catalog.refreshState.generation = 1;
  for (const source of Object.values(catalog.refreshState.sources)) {
    // Covered sources are not requested again for the same target date.
    source.status = 'success';
  }
  for (const { date, imageId, headline, urls } of days) {
    catalog.entries[date] = {
      date, imageId, urls, headline, title: headline, metadataStage: 'iotd', triviaId: '', triviaData: null, triviaState: 'missing'
    };
  }
  return catalog;
}

let context;
let profileDir;

async function worker() {
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
}

/** Replace the extension's state: local storage, and the listed cached images. */
async function seed({ days = [], displayState, cached = [] }) {
  const local = { [CATALOG_KEY]: catalogOf(days) };
  if (displayState) {
    local[DISPLAY_STATE_KEY] = displayState;
  }
  await (await worker()).evaluate(async ({ local, cacheName, cached }) => {
    await chrome.storage.local.clear();
    await caches.delete(cacheName);
    await chrome.storage.local.set(local);
    await chrome.storage.sync.set({ enable_uhd_wallpaper: 'yes' });
    const cache = await caches.open(cacheName);
    for (const { url, color, size } of cached) {
      const canvas = new OffscreenCanvas(size, size);
      const context2d = canvas.getContext('2d');
      context2d.fillStyle = color;
      context2d.fillRect(0, 0, size, size);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg' });
      await cache.put(url, new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
    }
  }, { local, cacheName: CACHE_NAME, cached });
}

const final = shown => ({ url: shown.urls.ultraHighDef, color: shown.color, size: 64 });
const preview = shown => ({ url: shown.urls.preview, color: shown.color, size: 16 });

/** Cache images the way a finished worker fetch would, then notify pages. */
async function workerCaches(images, dates) {
  await (await worker()).evaluate(async ({ cacheName, images, dates }) => {
    const cache = await caches.open(cacheName);
    for (const { url, color, size } of images) {
      const canvas = new OffscreenCanvas(size, size);
      const context2d = canvas.getContext('2d');
      context2d.fillStyle = color;
      context2d.fillRect(0, 0, size, size);
      await cache.put(url, new Response(await canvas.convertToBlob({ type: 'image/jpeg' })));
    }
    await chrome.runtime.sendMessage({ type: 'wallpaperCatalogUpdated', dates }).catch(() => {});
  }, { cacheName: CACHE_NAME, images, dates });
}

async function readDisplayState(page) {
  return page.evaluate(async key => (await chrome.storage.local.get(key))[key], DISPLAY_STATE_KEY);
}

/** Poll the stored display snapshot until it satisfies the predicate. */
async function displayStateWhen(page, predicate) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const snapshot = await readDisplayState(page);
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('the display snapshot did not reach the expected state');
}

/** Open a new tab and collect what the page shows and requests. */
async function openNewTab() {
  const page = await context.newPage();
  page.errors = [];
  page.imageRequests = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('ts1.tc.mm.bing.net')) page.imageRequests.push(request.url());
  });
  await page.goto('chrome://newtab/');
  return page;
}

// Kinds of inline body backgrounds in the order they were set.
const backgroundKinds = async page => (await page.evaluate(() => window.__backgrounds))
  .map(value => (value.startsWith('url("data:') ? 'data' : value.startsWith('url("blob:') ? 'blob' : 'none'));
const inlineBackground = page => page.evaluate(() => document.getElementById('main-body').style.backgroundImage);
const computedBackground = page => page.evaluate(() => getComputedStyle(document.getElementById('main-body')).backgroundImage);
const headline = page => page.locator('#headline').textContent();
const showsFinal = page => page.waitForFunction(() => document.getElementById('main-body').style.backgroundImage.startsWith('url("blob:'));

const snapshotOf = (shown, preloadDataUrl = '') => ({
  date: shown.date, imageId: shown.imageId, url: shown.urls.ultraHighDef, preloadDataUrl, updatedAt: 42
});
// A 1x1 GIF: only its presence at boot matters.
const BOOT_PREVIEW = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('new tab page in the loaded extension', () => {
  before(async () => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ataraxia-e2e-'));
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        '--no-proxy-server',
        '--host-resolver-rules=MAP * ~NOTFOUND'
      ]
    });
    // Record every inline background and headline the page sets, from before
    // boot.js runs, so short-lived states are not missed.
    await context.addInitScript(() => {
      window.__backgrounds = [];
      window.__headlines = [];
      const record = (list, value) => {
        if (value !== undefined && value !== (list.at(-1) ?? '')) list.push(value);
      };
      new MutationObserver(() => {
        record(window.__backgrounds, document.getElementById('main-body')?.style.backgroundImage);
        record(window.__headlines, document.getElementById('headline')?.textContent);
      }).observe(document, { attributes: true, attributeFilter: ['style'], childList: true, characterData: true, subtree: true });
    });
    await worker();
  });

  after(async () => {
    await context?.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  it('cold start shows the gradient without an inline color and without errors', async () => {
    await seed({});
    const page = await openNewTab();

    await page.waitForFunction(() => document.getElementById('main-body').dataset.wallpaperFallback === 'visible');

    assert.strictEqual(await computedBackground(page), GRADIENT);
    assert.strictEqual(await page.evaluate(() => document.getElementById('main-body').style.backgroundColor), '');
    assert.strictEqual(await readDisplayState(page), undefined);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  it('warm start paints the committed preview, then the cached final image, without fetching images', async () => {
    const committed = snapshotOf(A, BOOT_PREVIEW);
    await seed({ days: [A, B, C], displayState: committed, cached: [final(A), preview(A)] });
    const page = await openNewTab();

    await showsFinal(page);

    assert.deepStrictEqual(await backgroundKinds(page), ['data', 'blob']);
    assert.strictEqual(await headline(page), 'Target headline');
    assert.deepStrictEqual(await readDisplayState(page), committed);
    assert.deepStrictEqual(page.imageRequests, []);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  it('repairs an empty committed preview from Cache Storage on the next new tab', async () => {
    await seed({ days: [A], displayState: snapshotOf(A), cached: [final(A), preview(A)] });
    const page = await openNewTab();

    const repaired = await displayStateWhen(page, snapshot => snapshot?.preloadDataUrl);
    assert.match(repaired.preloadDataUrl, /^data:image\/jpeg;base64,/);
    assert.deepStrictEqual({ ...repaired, preloadDataUrl: '' }, snapshotOf(A));
    await page.close();
  });

  it('shows the cached preview first and swaps once when the final image is cached', async () => {
    await seed({ days: [A], cached: [preview(A)] });
    const page = await openNewTab();
    await page.waitForFunction(() => window.__backgrounds.length === 1);
    assert.strictEqual(await readDisplayState(page), undefined, 'a preview publishes nothing');

    await workerCaches([final(A)], [A.date]);
    const published = await displayStateWhen(page, snapshot => snapshot?.preloadDataUrl);

    assert.deepStrictEqual(await backgroundKinds(page), ['blob', 'blob'], 'the preview, then one final image');
    assert.strictEqual(await headline(page), 'Target headline');
    assert.strictEqual(published.url, A.urls.ultraHighDef);
    assert.match(published.preloadDataUrl, /^data:image\/jpeg;base64,/);
    await page.close();
  });

  it('navigates over cached dates, wraps, and keeps the current image when a destination is unavailable', async () => {
    await seed({ days: [A, B, C], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A), final(B), preview(B)] });
    const page = await openNewTab();
    await showsFinal(page);

    await page.click('#leftNav');
    await page.waitForFunction(() => document.getElementById('headline').textContent === 'Older headline');
    assert.strictEqual((await readDisplayState(page)).date, B.date);
    const olderBackground = await inlineBackground(page);

    // The oldest date is not cached and cannot be fetched.
    const headlinesBefore = (await page.evaluate(() => window.__headlines)).length;
    await page.click('#leftNav');
    await page.waitForFunction(count => window.__headlines.length === count + 2, headlinesBefore);
    const [updating, restored] = (await page.evaluate(() => window.__headlines)).slice(-2);
    assert.notStrictEqual(updating, 'Older headline', 'the updating headline is shown while waiting');
    assert.notStrictEqual(updating, 'Oldest headline');
    assert.strictEqual(restored, 'Older headline');
    assert.strictEqual(await inlineBackground(page), olderBackground);
    assert.strictEqual((await readDisplayState(page)).date, B.date);

    await page.click('#rightNav', { force: true });
    await page.waitForFunction(() => document.getElementById('headline').textContent === 'Target headline');
    assert.strictEqual((await readDisplayState(page)).date, A.date);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  it('a tab opened after another tab commits a navigation starts from that commit', async () => {
    await seed({ days: [A, B], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A), final(B), preview(B)] });
    const first = await openNewTab();
    await showsFinal(first);
    const early = await openNewTab();
    await showsFinal(early);

    await first.click('#leftNav');
    await first.waitForFunction(() => document.getElementById('headline').textContent === 'Older headline');
    const later = await openNewTab();
    await showsFinal(later);

    assert.strictEqual(await headline(later), 'Older headline');
    assert.strictEqual(await headline(early), 'Target headline', 'an open tab does not follow the later commit');
    assert.strictEqual((await readDisplayState(later)).date, B.date);
    await Promise.all([first.close(), early.close(), later.close()]);
  });

  it('keeps the cached wallpaper visible behind the offline page', async () => {
    await seed({ days: [A], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A)] });
    await context.setOffline(true);
    try {
      const page = await openNewTab();
      await showsFinal(page);

      assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.networkStatus), 'offline');
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('offline-view')).backgroundColor), 'rgba(0, 0, 0, 0)');
      assert.ok(await page.locator('.offline-search-input').isVisible());
      await page.close();
    } finally {
      await context.setOffline(false);
    }
  });
});
