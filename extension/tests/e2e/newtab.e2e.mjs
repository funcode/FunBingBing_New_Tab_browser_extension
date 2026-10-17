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
const QUOTE_STATE_KEY = 'cache_quote_state_v2';
const MIGRATION_KEY = 'wallpaper_migration_v2_state';
const BING_QUOTE_PAGE = 'https://cn.bing.com/search?q=quote%20of%20the%20day*';
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

// Runs in the service worker: cache one solid-color JPEG per image.
async function cacheImages({ cacheName, images }) {
  const cache = await caches.open(cacheName);
  for (const { url, color, size } of images) {
    const canvas = new OffscreenCanvas(size, size);
    const context2d = canvas.getContext('2d');
    context2d.fillStyle = color;
    context2d.fillRect(0, 0, size, size);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' });
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
  }
}

/**
 * Replace the extension's state: local and sync storage, and the listed cached
 * images. Migration is complete unless `local` says otherwise, so a worker
 * restart during a test only repeats its cleanup.
 */
async function seed({ days = [], displayState, cached = [], local = {}, sync = {} }) {
  const items = { [CATALOG_KEY]: catalogOf(days), [MIGRATION_KEY]: { version: 2, phase: 'complete' }, ...local };
  if (displayState) {
    items[DISPLAY_STATE_KEY] = displayState;
  }
  const serviceWorker = await worker();
  await serviceWorker.evaluate(async ({ items, cacheName, sync }) => {
    await chrome.storage.local.clear();
    await caches.delete(cacheName);
    await chrome.storage.local.set(items);
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ enable_uhd_wallpaper: 'yes', ...sync });
  }, { items, cacheName: CACHE_NAME, sync });
  await serviceWorker.evaluate(cacheImages, { cacheName: CACHE_NAME, images: cached });
}

const final = shown => ({ url: shown.urls.ultraHighDef, color: shown.color, size: 64 });
const preview = shown => ({ url: shown.urls.preview, color: shown.color, size: 16 });

/** Cache images the way a finished worker fetch would, then notify pages. */
async function workerCaches(images, dates) {
  const serviceWorker = await worker();
  await serviceWorker.evaluate(cacheImages, { cacheName: CACHE_NAME, images });
  await serviceWorker.evaluate(
    notified => chrome.runtime.sendMessage({ type: 'wallpaperCatalogUpdated', dates: notified }).catch(() => {}),
    dates
  );
}

/** The data URL the page reconstructs from a cached preview. */
async function cachedDataUrl(url) {
  return (await worker()).evaluate(async ({ cacheName, url }) => {
    const response = await (await caches.open(cacheName)).match(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
  }, { cacheName: CACHE_NAME, url });
}

async function readDisplayState(page) {
  return page.evaluate(async key => (await chrome.storage.local.get(key))[key], DISPLAY_STATE_KEY);
}

/** Poll the worker's migration marker until it reaches the phase. */
async function migrationPhase(phase) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const marker = await (await worker()).evaluate(async key => (await chrome.storage.local.get(key))[key], MIGRATION_KEY)
      .catch(() => null);
    if (marker?.phase === phase) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`migration did not reach the ${phase} phase`);
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

/**
 * Open a new tab and collect what the page shows and requests. With
 * `holdPreviewConversion`, preview data URL conversion waits for
 * `window.__releaseConversion()`.
 */
async function openNewTab({ holdPreviewConversion = false } = {}) {
  const page = await context.newPage();
  page.errors = [];
  page.imageRequests = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('ts1.tc.mm.bing.net')) page.imageRequests.push(request.url());
  });
  if (holdPreviewConversion) {
    await page.addInitScript(() => {
      const read = FileReader.prototype.readAsDataURL;
      const released = new Promise((resolve) => { window.__releaseConversion = resolve; });
      FileReader.prototype.readAsDataURL = function (blob) {
        released.then(() => read.call(this, blob));
      };
    });
  }
  await page.goto('chrome://newtab/');
  return page;
}

/** Make the page's next image decode wait for `window.__releaseDecode()`. */
async function holdNextDecode(page) {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    let held = false;
    HTMLImageElement.prototype.decode = function () {
      if (held) return decode.call(this);
      held = true;
      return new Promise((resolve) => { window.__releaseDecode = resolve; }).then(() => decode.call(this));
    };
  });
}
const decodeIsHeld = page => page.waitForFunction(() => typeof window.__releaseDecode === 'function');
const releaseDecode = page => page.evaluate(() => window.__releaseDecode());

// Kinds of inline body backgrounds in the order they were set.
const backgroundKinds = async page => (await page.evaluate(() => window.__backgrounds))
  .map(value => (value.startsWith('url("data:') ? 'data' : value.startsWith('url("blob:') ? 'blob' : 'none'));
const backgroundCount = page => page.evaluate(() => window.__backgrounds.length);
const inlineBackground = page => page.evaluate(() => document.getElementById('main-body').style.backgroundImage);
const computedBackground = page => page.evaluate(() => getComputedStyle(document.getElementById('main-body')).backgroundImage);
const headline = page => page.locator('#headline').textContent();
const headlineIs = (page, text) => page.waitForFunction(expected => document.getElementById('headline').textContent === expected, text);
const showsFinal = page => page.waitForFunction(() => document.getElementById('main-body').style.backgroundImage.startsWith('url("blob:'));
// rightNav carries a static aria-disabled attribute, so its click is forced.
const previous = page => page.click('#leftNav');
const next = page => page.click('#rightNav', { force: true });

// Committed now, so no day rollover applies unless a test sets updatedAt.
const COMMITTED_AT = Date.now();
const snapshotOf = (shown, preloadDataUrl = '', updatedAt = COMMITTED_AT) => ({
  date: shown.date, imageId: shown.imageId, url: shown.urls.ultraHighDef, preloadDataUrl, updatedAt
});
const identityOf = snapshot => ({ date: snapshot.date, imageId: snapshot.imageId, url: snapshot.url });
// A 1x1 GIF: only its presence at boot matters.
const BOOT_PREVIEW = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Start Chromium with the extension on the test profile, which persists across launches. */
async function launch() {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      //Without the flag, Chromium follows this machine's system proxy and page requests fail with ERR_PROXY_CONNECTION_FAILED; with it, they fail at the blocked DNS lookup as the tests intend.
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
}

describe('new tab page in the loaded extension', () => {
  before(async () => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ataraxia-e2e-'));
    await launch();
    // Let the new install's migration finish before tests replace its state.
    await migrationPhase('verified');
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
    assert.deepStrictEqual(repaired, snapshotOf(A, await cachedDataUrl(A.urls.preview)));
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
    await page.close();
  });

  it('navigates over cached dates, wraps, and never shows the preview of an unavailable destination', async () => {
    await seed({
      days: [A, B, C],
      displayState: snapshotOf(A, BOOT_PREVIEW),
      cached: [final(A), preview(A), final(B), preview(B), preview(C)]
    });
    const page = await openNewTab();
    await showsFinal(page);

    await previous(page);
    await headlineIs(page, 'Older headline');
    assert.strictEqual((await readDisplayState(page)).date, B.date);
    const olderBackground = await inlineBackground(page);
    const backgroundsBefore = await backgroundCount(page);
    const headlinesBefore = (await page.evaluate(() => window.__headlines)).length;

    // The oldest date has a cached preview, but its final image cannot be fetched.
    await previous(page);
    await page.waitForFunction(count => window.__headlines.length === count + 2, headlinesBefore);
    const [updating, restored] = (await page.evaluate(() => window.__headlines)).slice(-2);
    assert.notStrictEqual(updating, 'Older headline', 'the updating headline is shown while waiting');
    assert.notStrictEqual(updating, 'Oldest headline');
    assert.strictEqual(restored, 'Older headline');
    assert.strictEqual(await backgroundCount(page), backgroundsBefore, 'the destination preview is never rendered');
    assert.strictEqual(await inlineBackground(page), olderBackground);
    assert.strictEqual((await readDisplayState(page)).date, B.date);

    await next(page);
    await headlineIs(page, 'Target headline');
    assert.strictEqual((await readDisplayState(page)).date, A.date);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  it('drops a delayed final image of an older click after a newer navigation', async () => {
    await seed({ days: [A, B, C], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A), final(B), final(C)] });
    const page = await openNewTab();
    await showsFinal(page);
    const backgroundsBefore = await backgroundCount(page);

    await holdNextDecode(page);
    await previous(page);
    await decodeIsHeld(page);
    // The newer click wraps to the oldest date and completes first.
    await next(page);
    await headlineIs(page, 'Oldest headline');
    await releaseDecode(page);
    await displayStateWhen(page, snapshot => snapshot?.date === C.date);
    await page.waitForTimeout(300);

    assert.strictEqual(await headline(page), 'Oldest headline');
    assert.strictEqual(await backgroundCount(page), backgroundsBefore + 1, 'only the newer image was applied');
    assert.deepStrictEqual(identityOf(await readDisplayState(page)), identityOf(snapshotOf(C)));
    await page.close();
  });

  it('a tab opened while another is still loading starts from the old commit; one opened after starts from the new', async () => {
    await seed({ days: [A, B], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A), final(B), preview(B)] });
    const first = await openNewTab();
    await showsFinal(first);
    await holdNextDecode(first);
    await previous(first);
    await decodeIsHeld(first);

    const during = await openNewTab();
    await showsFinal(during);
    assert.strictEqual(await headline(during), 'Target headline');
    assert.strictEqual((await readDisplayState(during)).date, A.date, 'the pending destination is not published');

    await releaseDecode(first);
    await headlineIs(first, 'Older headline');
    await displayStateWhen(first, snapshot => snapshot?.date === B.date);
    const afterCommit = await openNewTab();
    await showsFinal(afterCommit);

    assert.strictEqual(await headline(afterCommit), 'Older headline');
    assert.strictEqual(await headline(during), 'Target headline', 'an open tab does not follow the later commit');
    await Promise.all([first.close(), during.close(), afterCommit.close()]);
  });

  it('concurrent commits from two tabs leave one whole snapshot', async () => {
    await seed({
      days: [A, B, C],
      displayState: snapshotOf(A, BOOT_PREVIEW),
      cached: [final(A), preview(A), final(B), preview(B), final(C), preview(C)]
    });
    const first = await openNewTab();
    const second = await openNewTab();
    await Promise.all([showsFinal(first), showsFinal(second)]);
    await Promise.all([holdNextDecode(first), holdNextDecode(second)]);
    await previous(first);
    await next(second);
    await Promise.all([decodeIsHeld(first), decodeIsHeld(second)]);

    await Promise.all([releaseDecode(first), releaseDecode(second)]);
    await Promise.all([headlineIs(first, 'Older headline'), headlineIs(second, 'Oldest headline')]);
    await displayStateWhen(first, snapshot => snapshot?.date !== A.date && snapshot?.preloadDataUrl !== BOOT_PREVIEW);
    await first.waitForTimeout(300);

    const { updatedAt, ...stored } = await readDisplayState(first);
    const whole = async shown => ({ ...identityOf(snapshotOf(shown)), preloadDataUrl: await cachedDataUrl(shown.urls.preview) });
    const matches = [await whole(B), await whole(C)]
      .filter(candidate => Object.keys(candidate).every(key => candidate[key] === stored[key]));
    assert.strictEqual(Object.keys(stored).length, 4);
    assert.strictEqual(matches.length, 1, 'date, identity, URL and preview all belong to one image');
    assert.strictEqual(typeof updatedAt, 'number');
    await Promise.all([first.close(), second.close()]);
  });

  it("never writes one image's preview repair into a later selection", async () => {
    await seed({ days: [A, B, C], displayState: snapshotOf(B), cached: [final(B), preview(B), final(C)] });
    const repairing = await openNewTab({ holdPreviewConversion: true });
    await showsFinal(repairing);
    const other = await openNewTab();
    await showsFinal(other);

    // Another tab commits the oldest date while the repair is still converting.
    await previous(other);
    await headlineIs(other, 'Oldest headline');
    await displayStateWhen(other, snapshot => snapshot?.date === C.date);
    await repairing.evaluate(() => window.__releaseConversion());
    await repairing.waitForTimeout(500);

    assert.deepStrictEqual({ ...(await readDisplayState(other)), updatedAt: 0 }, { ...snapshotOf(C), updatedAt: 0 });

    // A later new tab repairs the selection that is now global, with its own preview.
    await workerCaches([preview(C)], [C.date]);
    const later = await openNewTab();
    const repaired = await displayStateWhen(later, snapshot => snapshot?.preloadDataUrl);
    assert.strictEqual(repaired.date, C.date);
    assert.strictEqual(repaired.preloadDataUrl, await cachedDataUrl(C.urls.preview));
    await Promise.all([repairing.close(), other.close(), later.close()]);
  });

  it("first tab of a day keeps yesterday's wallpaper under the updating headline until today's is loaded", async () => {
    const yesterday = COMMITTED_AT - 36 * 60 * 60 * 1000;
    await seed({ days: [A, B], displayState: snapshotOf(B, BOOT_PREVIEW, yesterday), cached: [final(B), preview(A)] });
    const page = await openNewTab();
    await showsFinal(page);
    const updatingText = await page.evaluate(() => chrome.i18n.getMessage('updating_wallpaper'));
    await page.waitForFunction(text => window.__headlines.includes(text), updatingText);
    const yesterdayBackground = await inlineBackground(page);
    assert.strictEqual((await readDisplayState(page)).date, B.date);

    await workerCaches([final(A)], [A.date]);
    await headlineIs(page, 'Target headline');
    await displayStateWhen(page, snapshot => snapshot?.date === A.date);

    const backgrounds = await backgroundKinds(page);
    assert.deepStrictEqual(backgrounds, ['data', 'blob', 'blob'], "boot preview, yesterday's final, today's final");
    assert.notStrictEqual(await inlineBackground(page), yesterdayBackground);
    const headlines = await page.evaluate(() => window.__headlines);
    assert.ok(headlines.indexOf(updatingText) < headlines.indexOf('Target headline'));
    await page.close();
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

  it("shows the wallpaper while the lease holder's quote scrape is still pending", async () => {
    await seed({ days: [A], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A)] });
    let scrapeStarted;
    const scraping = new Promise((resolve) => { scrapeStarted = resolve; });
    // The scrape never answers while the test runs.
    await context.route(BING_QUOTE_PAGE, () => scrapeStarted());
    try {
      const page = await openNewTab();
      await scraping;
      await showsFinal(page);

      assert.strictEqual(await headline(page), 'Target headline');
      const lease = await page.evaluate(async () => (await chrome.storage.local.get('quote_scrape_state_v2')).quote_scrape_state_v2);
      assert.strictEqual(lease.date, A.date);
      assert.ok(lease.token, 'the scraping page holds the worker lease');
      assert.deepStrictEqual(page.errors, []);
      await page.close();
    } finally {
      await context.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  it('the worker falls back to the qotd_url that pages share through sync storage', async () => {
    const qotdUrl = 'https://quotes.example/qotd.json';
    await seed({ days: [A], displayState: snapshotOf(A, BOOT_PREVIEW), cached: [final(A), preview(A)] });
    const fallbackRequests = [];
    await context.route(BING_QUOTE_PAGE, route => route.fulfill({ status: 503, body: '' }));
    await context.route(qotdUrl, (route) => {
      fallbackRequests.push(route.request().url());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ [A.date]: { text: 'Fallback quote', source: 'Fallback author', caption: 'Fallback caption' } })
      });
    });
    try {
      // A regular extension page writes the shared setting that the worker reads.
      const writer = await context.newPage();
      await writer.goto(`chrome-extension://${new URL((await worker()).url()).host}/options.html`);
      await writer.evaluate(url => chrome.storage.sync.set({ qotd_url: url }), qotdUrl);
      await writer.close();

      const page = await openNewTab();
      await page.waitForFunction(() => document.getElementById('quote-text').textContent === '“Fallback quote”');

      assert.deepStrictEqual(fallbackRequests, [qotdUrl]);
      const stored = await page.evaluate(key => chrome.storage.local.get(key), QUOTE_STATE_KEY);
      assert.strictEqual(stored[QUOTE_STATE_KEY].quotes[A.date].text, 'Fallback quote');
      assert.deepStrictEqual(page.errors, []);
      await page.close();
    } finally {
      await context.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  it('the loaded extension is not allowed in incognito', async () => {
    const mode = await (await worker()).evaluate(async () => ({
      incognito: chrome.runtime.getManifest().incognito,
      allowed: await chrome.extension.isAllowedIncognitoAccess()
    }));
    assert.deepStrictEqual(mode, { incognito: 'not_allowed', allowed: false });
  });

  it('turning UHD off on the options page writes sync, then fetches the displayed HD image first', async () => {
    await seed({ days: [A, B], displayState: snapshotOf(A), cached: [final(A), preview(A), final(B), preview(B)] });
    const imageRequests = [];
    const metadataRequests = [];
    await context.route(/\.bing\.net\//, (route) => {
      imageRequests.push(route.request().url());
      return route.fulfill({ contentType: 'image/jpeg', body: 'jpeg' });
    });
    await context.route(/bing\.com\/(hp\/api|HPImageArchive)/, (route) => {
      metadataRequests.push(route.request().url());
      return route.fulfill({ status: 503, body: '' });
    });
    try {
      const options = await context.newPage();
      options.on('dialog', dialog => dialog.accept());
      await options.goto(`chrome-extension://${new URL((await worker()).url()).host}/options.html`);
      await options.click('#nav-wallpaper');
      await options.locator('#use-uhd-wallpaper-checkbox').uncheck();
      await options.click('#save-wallpaper-conf-btn');
      for (let attempt = 0; attempt < 100 && imageRequests.length < 2; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      assert.deepStrictEqual(imageRequests, [A.urls.highDef, B.urls.highDef], 'current resolution first, no previews');
      assert.deepStrictEqual(metadataRequests, []);
      assert.deepStrictEqual(await options.evaluate(() => chrome.storage.sync.get('enable_uhd_wallpaper')), { enable_uhd_wallpaper: 'no' });
      const local = await options.evaluate(() => chrome.storage.local.get(null));
      for (const key of ['enable_uhd_wallpaper', 'wallpaper_date']) {
        assert.ok(!(key in local), `${key} is written locally`);
      }
      await options.close();
    } finally {
      await context.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  it('regular pages and the worker share settings through sync, and open pages render its changes', async () => {
    await seed({ days: [A], displayState: snapshotOf(A), cached: [final(A), preview(A)], sync: { display_search_box: 'yes' } });
    const first = await openNewTab();
    await showsFinal(first);
    await first.click('#search-logo');
    await first.waitForFunction(() => document.getElementById('search-form').action === 'https://google.com/search');

    const second = await openNewTab();
    await showsFinal(second);
    assert.strictEqual(await second.evaluate(() => document.getElementById('search-form').action), 'https://google.com/search');
    assert.deepStrictEqual(await (await worker()).evaluate(() => chrome.storage.sync.get('current_search_engine')), { current_search_engine: 'Google' });

    // The already open first page renders the second page's choice.
    await second.click('#search-logo');
    await first.waitForFunction(() => document.getElementById('search-form').action === 'https://bing.com/search');
    assert.strictEqual(await first.evaluate(() => readConf('current_search_engine')), 'Bing');

    // Visibility settings changed elsewhere are applied to the open pages.
    await second.evaluate(() => chrome.storage.sync.set({ display_search_box: 'no', show_clock: 'no', show_quote: 'no' }));
    await first.waitForFunction(() => document.getElementById('search-box-whole-block').style.display === 'none' &&
      document.getElementById('center-clock').style.visibility === 'hidden' &&
      document.getElementById('quote').style.display === 'none');
    await second.evaluate(() => chrome.storage.sync.set({ display_search_box: 'yes', show_clock: 'yes', show_quote: 'yes' }));
    await first.waitForFunction(() => document.getElementById('search-box-whole-block').style.display === 'block' &&
      document.getElementById('center-clock').style.visibility === 'visible' &&
      document.getElementById('quote').style.display === '');

    const local = await first.evaluate(() => chrome.storage.local.get(null));
    for (const key of ['current_search_engine', 'display_search_box', 'show_clock', 'show_quote']) {
      assert.ok(!(key in local), `${key} is written locally`);
    }
    assert.deepStrictEqual([...first.errors, ...second.errors], []);
    await first.close();
    await second.close();
  });

  it('quick links resolve the date of the displayed wallpaper', async () => {
    await seed({ days: [A, B], displayState: snapshotOf(B), cached: [final(B), preview(B)] });
    const page = await openNewTab();
    await headlineIs(page, B.headline);

    const opened = context.waitForEvent('request', request => request.url().includes('OnThisDay'));
    // The quick links popup is hidden until hovered; its first custom link is "history today".
    await page.locator('#top-sites-div a').first().dispatchEvent('click');
    assert.ok((await opened).url().includes(`OsKey%3A%22OnThisDay${B.date.slice(4)}%22`));
    for (const popup of context.pages().filter(other => other !== page && other.url().includes('bing.com'))) {
      await popup.close();
    }
    await page.close();
  });

  it('reconnecting refreshes the catalog without writing legacy wallpaper keys', async () => {
    const catalog = catalogOf([A]);
    const failedAt = Date.now() - 1000;
    // In backoff, so only a reconnect bypass requests it again.
    catalog.refreshState.sources.imageOfTheDay = {
      status: 'failed', attemptedAt: failedAt, nextRetryAt: failedAt + 3 * 60 * 1000, retryLevel: 1, lastReconnectBypassAt: 0
    };
    await seed({ days: [A], displayState: snapshotOf(A), cached: [final(A), preview(A)], local: { [CATALOG_KEY]: catalog } });
    const metadataRequests = [];
    await context.route(/bing\.com\/hp\/api\/v1\/imageoftheday/, (route) => {
      metadataRequests.push(route.request().url());
      return route.fulfill({ status: 503, body: '' });
    });
    try {
      const page = await openNewTab();
      await showsFinal(page);
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.deepStrictEqual(metadataRequests, [], 'the source is still in backoff');

      await context.setOffline(true);
      await page.waitForFunction(() => document.documentElement.dataset.networkStatus === 'offline');
      await context.setOffline(false);
      for (let attempt = 0; attempt < 50 && metadataRequests.length === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      assert.strictEqual(metadataRequests.length, 1, 'one reconnect bypass');
      const local = await page.evaluate(() => chrome.storage.local.get(null));
      for (const key of ['wallpaper_date', 'wallpaper_idx', 'wallpaper_url', 'wallpaper_preload_data_url']) {
        assert.ok(!(key in local), `${key} is written`);
      }
      assert.deepStrictEqual(page.errors, []);
      await page.close();
    } finally {
      await context.setOffline(false);
      await context.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  // Restarts the browser, so it runs last.
  it('upgrading a v1 install keeps its wallpapers, history, quotes and settings, then removes the v1 state', async () => {
    const v1Image = shown => ({
      isoDate: shown.date,
      headline: shown.headline,
      title: shown.headline,
      imageUrls: { landscape: { highDef: `/th?id=${shown.imageId}_1920x1080.jpg`, ultraHighDef: `/th?id=${shown.imageId}_UHD.jpg` } }
    });
    const v1Key = url => url.replace('ts1.tc.mm.bing.net', 'cn.bing.com');
    const V1_ENGINE = { name: 'DuckDuckGo', icon: 'icons/bing.png', action: 'https://duckduckgo.com/', param_name: 'q', css_style: '' };
    // The v1 page last showed B, the day before the v1 refresh date.
    await seed({
      local: {
        bing_images: [v1Image(A), v1Image(B)],
        wallpaper_date: A.date,
        wallpaper_idx: '1',
        wallpaper_url: v1Key(B.urls.ultraHighDef),
        wallpaper_preload_data_url: BOOT_PREVIEW,
        cache_quote_state: { quotes: { [A.date]: { text: 'v1 quote', source: 'v1 author', caption: 'v1 caption', link: '' } } },
        search_engine_list: [V1_ENGINE],
        current_search_engine: V1_ENGINE.name,
        show_clock: 'no',
        enable_uhd_wallpaper: 'yes',
        last_open_version: '1.7'
      }
    });
    const v1Cache = 'funbingbing-wallpaper-cache-v1';
    // A v1 install has no v2 state and nothing in sync storage.
    await (await worker()).evaluate(async (keys) => {
      await chrome.storage.local.remove(keys);
      await chrome.storage.sync.clear();
    }, [CATALOG_KEY, MIGRATION_KEY]);
    await (await worker()).evaluate(cacheImages, {
      cacheName: v1Cache,
      images: [{ ...final(A), url: v1Key(A.urls.ultraHighDef) }, { ...final(B), url: v1Key(B.urls.ultraHighDef) }]
    });

    // The upgraded extension starts with the browser and migrates at worker start.
    await context.close();
    await launch();

    // The first page opens while the worker migrates. Once the worker reports
    // verified, the page writes the v1 display identity, which is from an
    // earlier day, so it then moves to today's wallpaper, cached by the v1 page.
    const page = await openNewTab();
    await displayStateWhen(page, snapshot => snapshot?.date === A.date);
    await migrationPhase('complete');

    assert.deepStrictEqual(await backgroundKinds(page), ['blob', 'blob']);
    assert.strictEqual(await headline(page), A.headline);
    const local = await page.evaluate(() => chrome.storage.local.get(null));
    for (const key of ['bing_images', 'wallpaper_date', 'wallpaper_idx', 'wallpaper_url', 'wallpaper_preload_data_url', 'cache_quote_state']) {
      assert.ok(!(key in local), `${key} remains`);
    }
    assert.strictEqual(local[QUOTE_STATE_KEY].quotes[A.date].text, 'v1 quote');
    assert.deepStrictEqual(Object.keys(local[CATALOG_KEY].entries).sort(), [B.date, A.date]);
    // Pages and the worker share the migrated settings through sync; the local
    // copies are deleted.
    const shared = ['search_engine_list', 'current_search_engine', 'show_clock', 'enable_uhd_wallpaper'];
    assert.deepStrictEqual(await page.evaluate(keys => chrome.storage.sync.get(keys), shared), {
      search_engine_list: [V1_ENGINE], current_search_engine: V1_ENGINE.name, show_clock: 'no', enable_uhd_wallpaper: 'yes'
    });
    for (const key of shared) {
      assert.ok(!(key in local), `${key} remains in local storage`);
    }
    assert.strictEqual(await page.evaluate(() => readConf('show_clock')), 'no');
    assert.strictEqual(await page.evaluate(name => caches.has(name), v1Cache), false);

    // History survives: the previous date shows its wallpaper copied from the v1 cache.
    // The relaunched browser may restore earlier tabs in front of this one.
    await page.bringToFront();
    await previous(page);
    await headlineIs(page, B.headline);
    await displayStateWhen(page, snapshot => snapshot?.imageId === B.imageId);
    assert.deepStrictEqual(page.imageRequests, [], 'no image is downloaded again');
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });
});
