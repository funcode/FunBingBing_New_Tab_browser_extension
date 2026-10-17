/**
 * Harness for the browser checks: the actual MV3 extension loaded into
 * Chromium by Playwright, on a test profile that persists across launches.
 *
 * All DNS lookups fail, so nothing reaches Bing unless a test routes it with
 * `context.route`, which also serves the worker's requests. The catalog,
 * display state and Cache Storage are seeded directly, and a worker image
 * fetch can be stood in for by caching the image and sending the worker's
 * wallpaperCatalogUpdated notification.
 *
 * Every seed restarts the service worker, so no test inherits another test's
 * image queue, refresh round or in-flight request.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { addDays, getZhCnTargetDate } from '../../src/helpers/date.js';
import { buildCanonicalUrls } from '../../src/helpers/image.js';
import { createEmptyCatalog } from '../../src/worker/catalog.js';

export const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CATALOG_KEY = 'bing_wallpaper_catalog_v2';
export const DISPLAY_STATE_KEY = 'wallpaper_display_state_v2';
export const CACHE_NAME = 'funbingbing-wallpaper-cache-v2';
export const QUOTE_STATE_KEY = 'cache_quote_state_v2';
export const QUOTE_LEASE_KEY = 'quote_scrape_state_v2';
export const MIGRATION_KEY = 'wallpaper_migration_v2_state';
export const BING_QUOTE_PAGE = 'https://cn.bing.com/search?q=quote%20of%20the%20day*';
export const GRADIENT = 'linear-gradient(160deg, rgb(31, 41, 51), rgb(62, 76, 89))';
export const IMAGE_REQUESTS = /\.bing\.net\//;
export const METADATA_REQUESTS = {
  imageOfTheDay: /bing\.com\/hp\/api\/v1\/imageoftheday/,
  model: /bing\.com\/hp\/api\/model/,
  archive: /bing\.com\/HPImageArchive/
};
export const ANY_METADATA_REQUEST = /bing\.com\/(hp\/api\/(v1\/imageoftheday|model)|HPImageArchive)/;
export const TRIVIA_REQUESTS = /bing\.com\/hp\/api\/v1\/trivia/;
export const MINUTE = 60 * 1000;

export const TARGET = getZhCnTargetDate();
export const day = (offset, name, color) => {
  const date = addDays(TARGET, offset);
  const imageId = `OHR.${name}_ZH-CN100000000${-offset}`;
  return { date, imageId, color, headline: `${name} headline`, urls: buildCanonicalUrls(imageId) };
};

/** A catalog of the days whose sources all covered `targetDate`. */
export function catalogOf(days, targetDate = TARGET) {
  const catalog = createEmptyCatalog();
  catalog.refreshState.date = targetDate;
  catalog.refreshState.generation = 1;
  for (const source of Object.values(catalog.refreshState.sources)) {
    // Covered sources are not requested again for the same target date.
    source.status = 'success';
  }
  for (const { date, imageId, headline, urls, triviaId = '' } of days) {
    catalog.entries[date] = {
      date, imageId, urls, headline, title: headline, metadataStage: 'iotd',
      triviaId, triviaData: null, triviaState: 'missing', triviaAttemptedAt: 0, triviaNextRetryAt: 0, triviaRetryLevel: 0
    };
  }
  return catalog;
}

export let context;
let profileDir;
let realNetwork = false;
// An extension page that seeds storage and Cache Storage, sends runtime
// messages and holds the CDP session that stops the worker.
let control;
let cdp;
// Running status of each worker version Chrome reported.
const workerVersions = new Map();
// Transitions of any worker version to stopped.
let workerStops = 0;
const workerIs = status => [...workerVersions.values()].some(value => value === status);

/** Poll until the condition holds. */
export const eventually = async (condition, message = 'the expected state was not reached') => {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(message);
};

/** Start Chromium with the extension on the test profile. */
export async function launch() {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      // With the real network, Chromium follows this machine's system proxy.
      ...(realNetwork ? [] : [
        //Without the flag, Chromium follows this machine's system proxy and page requests fail with ERR_PROXY_CONNECTION_FAILED; with it, they fail at the blocked DNS lookup as the tests intend.
        '--no-proxy-server',
        '--host-resolver-rules=MAP * ~NOTFOUND'
      ])
    ]
  });
  // Record every inline background and headline the page sets, from before
  // boot.js runs, so short-lived states are not missed. Blob widths tell a
  // preview from a final image.
  await context.addInitScript(() => {
    window.__backgrounds = [];
    window.__headlines = [];
    window.__blobs = {};
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      const url = createObjectURL(blob);
      window.__blobs[url] = blob;
      return url;
    };
    const record = (list, value) => {
      if (value !== undefined && value !== (list.at(-1) ?? '')) list.push(value);
    };
    new MutationObserver(() => {
      record(window.__backgrounds, document.getElementById('main-body')?.style.backgroundImage);
      record(window.__headlines, document.getElementById('headline')?.textContent);
    }).observe(document, { attributes: true, attributeFilter: ['style'], childList: true, characterData: true, subtree: true });
  });
  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  control = await context.newPage();
  await control.goto(`chrome-extension://${new URL(serviceWorker.url()).host}/options.html`);
  cdp = await context.newCDPSession(control);
  workerVersions.clear();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const { versionId, runningStatus } of versions) {
      if (runningStatus === 'stopped' && workerVersions.get(versionId) !== 'stopped') workerStops += 1;
      workerVersions.set(versionId, runningStatus);
    }
  });
  await cdp.send('ServiceWorker.enable');
}

/**
 * Create the test profile, start the browser and let the new install's
 * migration verify. With `network`, requests reach the real Bing.
 */
export async function start({ network = false } = {}) {
  realNetwork = network;
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ataraxia-e2e-'));
  await launch();
  await migrationPhase('verified');
}

export async function finish() {
  await context?.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
}

/** Send a runtime message from the control page and resolve the worker's answer. */
export const sendMessage = message => control.evaluate(sent => chrome.runtime.sendMessage(sent), message);

/** One local storage value, or every item when `key` is null. */
export async function readLocal(key) {
  return control.evaluate(async (name) => {
    const items = await chrome.storage.local.get(name);
    return name === null ? items : items[name];
  }, key);
}

export async function writeLocal(items) {
  await control.evaluate(written => chrome.storage.local.set(written), items);
}

export async function removeLocal(keys) {
  await control.evaluate(removed => chrome.storage.local.remove(removed), keys);
}

/** Write shared settings the way a regular page does. */
export async function writeSync(items) {
  await control.evaluate(written => chrome.storage.sync.set(written), items);
}

export async function readSync(keys) {
  return control.evaluate(read => chrome.storage.sync.get(read), keys);
}

/** The running service worker, started again if it was stopped. */
export async function worker() {
  if (workerVersions.size > 0 && !workerIs('running')) {
    await eventually(() => workerIs('running') || !workerIs('starting') && !workerIs('stopping'), 'the worker neither stopped nor started');
    if (!workerIs('running')) {
      await sendMessage({ type: 'migrationStatus' });
    }
  }
  return context.serviceWorkers()[0] || context.waitForEvent('serviceworker');
}

/** Terminate the service worker, as Chrome does to an idle one. Its in-memory state is lost. */
export async function stopWorker() {
  if (workerVersions.size > 0 && [...workerVersions.values()].every(status => status === 'stopped')) {
    return;
  }
  // An event may start the worker again at once, so the stop itself is
  // awaited, and the command repeated if Chrome ignored it while starting.
  const stops = workerStops;
  for (let attempt = 0; attempt < 5 && workerStops === stops; attempt++) {
    await cdp.send('ServiceWorker.stopAllWorkers');
    for (let poll = 0; poll < 20 && workerStops === stops; poll++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(workerStops > stops, 'the worker did not stop');
}

/** Terminate the worker and start a fresh one; resolves once its start-up migration run finished. */
export async function restartWorker() {
  await stopWorker();
  await sendMessage({ type: 'migrationStatus' });
}

/** Every browser target, in the regular and any incognito browser context. */
export async function browserTargets() {
  return (await cdp.send('Target.getTargets')).targetInfos;
}

export async function closeTarget(targetId) {
  await cdp.send('Target.closeTarget', { targetId });
}

/**
 * Open a New Tab in a real incognito window, as a user does. Playwright does
 * not drive incognito pages, so the tab is resolved as its CDP target once
 * its title has loaded.
 */
export async function openIncognitoNewTab() {
  const regular = new Set((await browserTargets()).map(target => target.browserContextId));
  await control.evaluate(() => chrome.windows.create({ incognito: true, url: 'chrome://newtab/' }));
  let tab;
  await eventually(async () => {
    tab = (await browserTargets()).find(target => target.type === 'page' && !regular.has(target.browserContextId) &&
      target.url === 'chrome://newtab/' && target.title && !target.title.startsWith('chrome://'));
    return Boolean(tab);
  }, 'no incognito New Tab opened');
  return tab;
}

// Runs in the service worker: make sync storage hold exactly `desired`, and
// resolve once this worker's listeners have seen each change.
async function replaceSync(desired) {
  const current = await chrome.storage.sync.get(null);
  const removed = Object.keys(current).filter(key => !(key in desired));
  const changed = Object.fromEntries(Object.entries(desired)
    .filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)));
  const writes = [];
  if (removed.length > 0) writes.push(() => chrome.storage.sync.remove(removed));
  if (Object.keys(changed).length > 0) writes.push(() => chrome.storage.sync.set(changed));
  for (const write of writes) {
    const observed = new Promise((resolve) => {
      const listener = (changes, area) => {
        if (area !== 'sync') return;
        chrome.storage.onChanged.removeListener(listener);
        resolve();
      };
      chrome.storage.onChanged.addListener(listener);
    });
    await write();
    await observed;
  }
}

const jpegs = new Map();

/** A solid-color JPEG, encoded by the browser. */
export async function jpeg(color, size) {
  const key = `${color}/${size}`;
  if (!jpegs.has(key)) {
    const base64 = await control.evaluate(async ({ color, size }) => {
      const canvas = new OffscreenCanvas(size, size);
      const context2d = canvas.getContext('2d');
      context2d.fillStyle = color;
      context2d.fillRect(0, 0, size, size);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg' })).arrayBuffer());
      return btoa(String.fromCharCode(...bytes));
    }, { color, size });
    jpegs.set(key, Buffer.from(base64, 'base64'));
  }
  return jpegs.get(key);
}

const FINAL_SIZE = 64;
const PREVIEW_SIZE = 16;
export const final = (shown, url = shown.urls.ultraHighDef) => ({ url, color: shown.color, size: FINAL_SIZE });
export const finalHd = shown => final(shown, shown.urls.highDef);
export const preview = shown => ({ url: shown.urls.preview, color: shown.color, size: PREVIEW_SIZE });

/** Put solid-color JPEGs into a Cache Storage cache. */
export async function cacheImages(images, cacheName = CACHE_NAME) {
  const bodies = [];
  for (const { url, color, size } of images) {
    bodies.push({ url, base64: (await jpeg(color, size)).toString('base64') });
  }
  await control.evaluate(async ({ cacheName, bodies }) => {
    const cache = await caches.open(cacheName);
    for (const { url, base64 } of bodies) {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } }));
    }
  }, { cacheName, bodies });
}

export async function cachedUrls(cacheName = CACHE_NAME) {
  return control.evaluate(async name => (await (await caches.open(name)).keys()).map(request => request.url), cacheName);
}

/** Cache `urls` with filler bodies of `bytes` bytes each. */
export async function cacheFiller(urls, bytes, cacheName = CACHE_NAME) {
  await control.evaluate(async ({ urls, bytes, cacheName }) => {
    const cache = await caches.open(cacheName);
    const body = new Uint8Array(bytes).fill(7);
    for (const url of urls) {
      await cache.put(url, new Response(body, { headers: { 'Content-Type': 'image/jpeg' } }));
    }
  }, { urls, bytes, cacheName });
}

/** Fetch the URLs from an extension page, over its host permissions, and cache the responses. */
export async function fetchIntoCache(urls, cacheName = CACHE_NAME) {
  await control.evaluate(async ({ urls, cacheName }) => {
    const cache = await caches.open(cacheName);
    for (const url of urls) {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      await cache.put(url, response);
    }
  }, { urls, cacheName });
}

export async function fetchJson(url) {
  return control.evaluate(async address => (await fetch(address, { cache: 'no-store' })).json(), url);
}

export async function hasCache(cacheName) {
  return control.evaluate(name => caches.has(name), cacheName);
}

/** Every cached response with its body size in bytes. */
export async function cachedBytes(cacheName = CACHE_NAME) {
  return control.evaluate(async (name) => {
    const cache = await caches.open(name);
    return Promise.all((await cache.keys()).map(async request => ({
      url: request.url,
      bytes: (await (await cache.match(request)).arrayBuffer()).byteLength
    })));
  }, cacheName);
}

export async function deleteCached(urls) {
  await control.evaluate(async ({ cacheName, urls }) => {
    const cache = await caches.open(cacheName);
    await Promise.all(urls.map(url => cache.delete(url)));
  }, { cacheName: CACHE_NAME, urls });
}

const MIGRATION_COMPLETE = Object.freeze({ version: 2, phase: 'complete' });

/**
 * Replace the extension's state: local and sync storage, and the listed cached
 * images, under a freshly started worker. Migration is complete unless `local`
 * says otherwise, so a worker restart only repeats its cleanup.
 */
export async function seed({
  days = [], targetDate, displayState, cached = [], local = {}, sync = { enable_uhd_wallpaper: 'yes' }
} = {}) {
  const items = { [CATALOG_KEY]: catalogOf(days, targetDate), [MIGRATION_KEY]: MIGRATION_COMPLETE, ...local };
  if (displayState) {
    items[DISPLAY_STATE_KEY] = displayState;
  }
  // The restarted worker's start-up migration must find nothing to migrate,
  // and sync is written first: work the change starts dies with the restart.
  await control.evaluate(async (marker) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(marker);
  }, { [MIGRATION_KEY]: MIGRATION_COMPLETE });
  await (await worker()).evaluate(replaceSync, sync);
  await restartWorker();
  await control.evaluate(async ({ items, cacheName }) => {
    await chrome.storage.local.clear();
    await caches.delete(cacheName);
    await chrome.storage.local.set(items);
  }, { items, cacheName: CACHE_NAME });
  await cacheImages(cached);
}

/** Cache images the way a finished worker fetch would, then notify pages. */
export async function workerCaches(images, dates) {
  await cacheImages(images);
  await control.evaluate(
    notified => chrome.runtime.sendMessage({ type: 'wallpaperCatalogUpdated', dates: notified }).catch(() => {}),
    dates
  );
}

/** The data URL the page reconstructs from a cached preview. */
export async function cachedDataUrl(url) {
  return control.evaluate(async ({ cacheName, url }) => {
    const response = await (await caches.open(cacheName)).match(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;
  }, { cacheName: CACHE_NAME, url });
}

export async function readDisplayState(page) {
  return page.evaluate(async key => (await chrome.storage.local.get(key))[key], DISPLAY_STATE_KEY);
}

/** Poll the worker's migration marker until it reaches the phase. */
export async function migrationPhase(phase) {
  await eventually(async () => (await readLocal(MIGRATION_KEY).catch(() => null))?.phase === phase,
    `migration did not reach the ${phase} phase`);
}

/** Poll the stored display snapshot until it satisfies the predicate. */
export async function displayStateWhen(page, predicate) {
  let snapshot;
  await eventually(async () => predicate(snapshot = await readDisplayState(page)), 'the display snapshot did not reach the expected state');
  return snapshot;
}

/** Poll the stored catalog until it satisfies the predicate. */
export async function catalogWhen(predicate, message = 'the catalog did not reach the expected state') {
  let catalog;
  await eventually(async () => predicate(catalog = await readLocal(CATALOG_KEY)), message);
  return catalog;
}

/**
 * Open a new tab and collect what the page shows and requests. With
 * `holdPreviewConversion`, preview data URL conversion waits for
 * `window.__releaseConversion()`.
 */
export async function openNewTab({ holdPreviewConversion = false } = {}) {
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
export async function holdNextDecode(page) {
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
export const decodeIsHeld = page => page.waitForFunction(() => typeof window.__releaseDecode === 'function');
export const releaseDecode = page => page.evaluate(() => window.__releaseDecode());

// Kinds of inline body backgrounds in the order they were set.
export const backgroundKinds = async page => (await page.evaluate(() => window.__backgrounds))
  .map(value => (value.startsWith('url("data:') ? 'data' : value.startsWith('url("blob:') ? 'blob' : 'none'));
// Inline body backgrounds in order: 'preview' or 'final' for a blob of that
// width, otherwise as backgroundKinds names them.
export const backgroundImages = page => page.evaluate(async previewWidth => Promise.all(window.__backgrounds.map(async (value) => {
  const blob = value.match(/^url\("(blob:[^"]+)"\)$/)?.[1];
  if (!blob) return value.startsWith('url("data:') ? 'data' : 'none';
  return (await createImageBitmap(window.__blobs[blob])).width === previewWidth ? 'preview' : 'final';
})), PREVIEW_SIZE);
export const backgroundCount = page => page.evaluate(() => window.__backgrounds.length);
export const inlineBackground = page => page.evaluate(() => document.getElementById('main-body').style.backgroundImage);
export const computedBackground = page => page.evaluate(() => getComputedStyle(document.getElementById('main-body')).backgroundImage);
export const headline = page => page.locator('#headline').textContent();
export const headlineIs = (page, text) => page.waitForFunction(expected => document.getElementById('headline').textContent === expected, text);
export const showsFinal = page => page.waitForFunction(() => document.getElementById('main-body').style.backgroundImage.startsWith('url("blob:'));
export const updatingText = page => page.evaluate(() => chrome.i18n.getMessage('updating_wallpaper'));
export const previous = page => page.click('#leftNav');
export const next = page => page.click('#rightNav');

// Committed now, so no day rollover applies unless a test sets updatedAt.
export const COMMITTED_AT = Date.now();
export const DAY = 24 * 60 * 60 * 1000;
export const snapshotOf = (shown, preloadDataUrl = '', updatedAt = COMMITTED_AT, url = shown.urls.ultraHighDef) => ({
  date: shown.date, imageId: shown.imageId, url, preloadDataUrl, updatedAt
});
export const identityOf = snapshot => ({ date: snapshot.date, imageId: snapshot.imageId, url: snapshot.url });
// A 1x1 GIF: only its presence at boot matters.
export const BOOT_PREVIEW = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

/**
 * Serve wallpaper image requests with solid-color JPEGs: a preview URL gets a
 * preview-sized image, any other URL a final-sized one. Records every request
 * in order, and the most that were in flight at once. `respond(url)` may
 * return a promise that delays the answer, or a status code to fail it.
 */
export async function serveImages(respond = () => null) {
  const served = { urls: [], active: 0, maxActive: 0 };
  await context.route(IMAGE_REQUESTS, async (route) => {
    const url = route.request().url();
    served.urls.push(url);
    served.active += 1;
    served.maxActive = Math.max(served.maxActive, served.active);
    try {
      const answer = await respond(url);
      const isPreview = url.endsWith('_640x360.jpg');
      // The request is gone if the worker was terminated meanwhile.
      await (typeof answer === 'number'
        ? route.fulfill({ status: answer, body: '' })
        : route.fulfill({ contentType: 'image/jpeg', body: await jpeg('#808080', isPreview ? PREVIEW_SIZE : FINAL_SIZE) })
      ).catch(() => {});
    } finally {
      served.active -= 1;
    }
  });
  return served;
}

/** Answer one metadata source with `answer(url)`: a JSON body, or a status code to fail it. */
export async function serveMetadata(source, answer) {
  const requests = [];
  await context.route(METADATA_REQUESTS[source], async (route) => {
    requests.push(route.request().url());
    const body = await answer(route.request().url());
    await (typeof body === 'number'
      ? route.fulfill({ status: body, body: '' })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    ).catch(() => {});
  });
  return requests;
}

const relative = (shown, suffix) => `/th?id=${shown.imageId}${suffix}`;

/** An ImageOfTheDay response listing the days. */
export const imageOfTheDayResponse = days => ({
  data: {
    images: days.map(shown => ({
      isoDate: shown.date,
      title: shown.headline,
      imageUrls: { landscape: { highDef: relative(shown, '_1920x1080.jpg'), ultraHighDef: relative(shown, '_UHD.jpg') } }
    }))
  }
});

/** A Model response: MediaContents, then PreloadMediaContents. */
export const modelResponse = (media, preload = []) => {
  const item = shown => ({
    Ssd: shown.date,
    ImageContent: {
      Headline: shown.headline,
      Title: shown.headline,
      Image: { Url: relative(shown, '_1920x1080.jpg') },
      ...(shown.description ? { Description: shown.description } : {}),
      ...(shown.triviaId ? { TriviaId: shown.triviaId } : {})
    }
  });
  return { MediaContents: media.map(item), PreloadMediaContents: preload.map(item) };
};

/** Move the worker's clock by whole days; the next worker restart undoes it. */
export async function advanceWorkerClock(days) {
  await (await worker()).evaluate((offset) => {
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length > 0 ? args : [RealDate.now() + offset]));
      }

      static now() {
        return RealDate.now() + offset;
      }
    };
  }, days * DAY);
}
