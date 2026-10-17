/**
 * Service-worker v1-to-v2 migration for the regular context (ADR-0004).
 *
 * Every worker start runs the migration until it is complete. The `writing`
 * phase imports the v1 wallpaper and quote state, copies v1 Cache Storage
 * responses by canonical URL and writes the shared settings to sync storage.
 * Valid v2 state comes before v1 state. Each step is idempotent, so an
 * interrupted run is simply repeated. Only fresh-read
 * verification of the cache copies, catalog, quote state and sync settings
 * advances the marker to `verified`.
 *
 * The worker never writes the display state. The first page turns the
 * retained display inputs into the v2 display state and acknowledges it; the
 * acknowledgement completes migration and deletes the v1 state.
 */

import { isValidCalendarDate } from '../helpers/date.js';
import { isEmptyDisplayState, isValidDisplaySnapshot } from '../helpers/display-state.js';
import { canonicalizeImageUrl } from '../helpers/image.js';
import { SHARED_SETTINGS, resolveSharedSettings } from '../helpers/migration.js';
import { importLegacyImages, isValidCatalogEntry } from './catalog.js';
import { normalizeQuote, pruneQuotes } from './quote-service.js';
import { STORAGE_KEYS, WALLPAPER_CACHE_NAME } from './storage-keys.js';

const LEGACY_IMAGES_KEY = 'bing_images';
const LEGACY_QUOTE_STATE_KEY = 'cache_quote_state';
const SETTING_KEYS = Object.keys(SHARED_SETTINGS);

const LEGACY_CACHE_NAME = 'funbingbing-wallpaper-cache-v1';

// v1 keys deleted on completion: wallpaper, display inputs, lock, index,
// quick facts, model preload and quote caches, including those of older builds.
const LEGACY_KEYS = Object.freeze([
  LEGACY_IMAGES_KEY,
  'wallpaper_date',
  'wallpaper_idx',
  'wallpaper_url',
  'wallpaper_preload_data_url',
  'wallpaper_fetch_lock',
  'cache_quick_facts',
  'bing_model_preload_wallpaper_urls',
  'bing_data_errors',
  LEGACY_QUOTE_STATE_KEY,
  'lost_quotes',
  'cache_quote_of_the_day',
  'cache_quote_tracker',
  's3_quote_of_the_day',
  'todayQuote'
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Stored values are JSON values compared by content. Chrome storage returns
// object keys in its own order, so keys are compared sorted.
function sortedJson(value) {
  return JSON.stringify(value, (key, nested) => (isObject(nested)
    ? Object.fromEntries(Object.keys(nested).sort().map(name => [name, nested[name]]))
    : nested));
}

function isSameValue(a, b) {
  return sortedJson(a) === sortedJson(b);
}

/**
 * @param {Object} deps
 * @param {{commitMigration: Function}} deps.catalogService
 * @param {{get: Function, set: Function, remove: Function}} deps.storage - chrome.storage.local-shaped area
 * @param {{get: Function, set: Function}} deps.syncStorage - chrome.storage.sync-shaped area
 * @param {{has: Function, open: Function, delete: Function}} deps.caches - CacheStorage
 * @param {() => number} [deps.now]
 * @param {{warn: Function}} [deps.log]
 */
export function createMigrationService({ catalogService, storage, syncStorage, caches, now = Date.now, log = console }) {
  // Runs, status reads and acknowledgements take turns against fresh reads.
  let chain = Promise.resolve();

  function serialize(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  async function read(key) {
    return (await storage.get(key))[key];
  }

  // Resolves true once the catalog holds a valid entry for every recovered date.
  async function migrateCatalog() {
    const images = await read(LEGACY_IMAGES_KEY);
    const { dates } = await catalogService.commitMigration((catalog) => {
      const result = importLegacyImages(catalog, images, now());
      // A catalog that was never committed is written even with nothing to import.
      return { ...result, changed: result.changedDates.length > 0 || catalog.updatedAt === 0 };
    });
    const stored = await read(STORAGE_KEYS.catalog);
    return stored?.version === 2 && isObject(stored.entries) &&
      dates.every(date => isValidCatalogEntry(stored.entries[date], date));
  }

  // Fill v2 quotes missing from the v1 quote cache. Resolves true once the
  // quote state holds every quote it should.
  async function migrateQuotes() {
    const current = await read(STORAGE_KEYS.quoteState);
    const legacy = await read(LEGACY_QUOTE_STATE_KEY);
    const quotes = isObject(current?.quotes) ? current.quotes : {};
    let changed = !isObject(current?.quotes);
    for (const [date, raw] of Object.entries(isObject(legacy?.quotes) ? legacy.quotes : {})) {
      // Older builds stored a missing caption as null.
      const quote = isObject(raw) ? normalizeQuote({ ...raw, caption: raw.caption ?? '' }) : null;
      if (isValidCalendarDate(date) && quote && !normalizeQuote(quotes[date])) {
        quotes[date] = quote;
        changed = true;
      }
    }
    pruneQuotes(quotes);
    if (changed) {
      await storage.set({ [STORAGE_KEYS.quoteState]: { ...current, quotes } });
    }
    const stored = await read(STORAGE_KEYS.quoteState);
    return isObject(stored?.quotes) && Object.keys(quotes).every(date => isSameValue(stored.quotes[date], quotes[date]));
  }

  // Resolves true once sync holds the intended value of every shared setting.
  async function migrateSettings() {
    const [syncItems, localItems] = await Promise.all([syncStorage.get(SETTING_KEYS), storage.get(SETTING_KEYS)]);
    const intended = resolveSharedSettings(syncItems, localItems);
    const writes = Object.fromEntries(Object.entries(intended)
      .filter(([key, value]) => !isSameValue(syncItems[key], value)));
    if (Object.keys(writes).length > 0) {
      await syncStorage.set(writes);
    }
    const stored = await syncStorage.get(SETTING_KEYS);
    return SETTING_KEYS.every(key => isSameValue(stored[key], intended[key]));
  }

  // Responses missing from the v2 cache are copied under their canonical URL.
  // Resolves true once the v2 cache holds every canonical URL; a failed copy
  // is retried on the next run because the v1 cache stays until completion.
  async function copyLegacyCache() {
    if (!(await caches.has(LEGACY_CACHE_NAME))) {
      return true;
    }
    const legacy = await caches.open(LEGACY_CACHE_NAME);
    const current = await caches.open(WALLPAPER_CACHE_NAME);
    for (const request of await legacy.keys()) {
      const url = canonicalizeImageUrl(request.url);
      if (!url || await current.match(url)) {
        continue;
      }
      const response = await legacy.match(request);
      if (response) {
        await current.put(url, response);
      }
      if (!(await current.match(url))) {
        return false;
      }
    }
    return true;
  }

  async function cleanUp() {
    try {
      await storage.remove([...LEGACY_KEYS]);
      await caches.delete(LEGACY_CACHE_NAME);
    } catch (error) {
      log.warn('[migration] Deleting v1 state failed', error);
    }
  }

  async function writePhase(marker, phase) {
    if (marker?.phase === phase) {
      return;
    }
    const next = { version: 2, phase, startedAt: marker?.startedAt || now(), verifiedAt: 0, completedAt: 0 };
    if (phase === 'verified') {
      next.verifiedAt = now();
    }
    await storage.set({ [STORAGE_KEYS.migration]: next });
  }

  /**
   * Run or resume migration. A complete migration only repeats its cleanup.
   * Never rejects: a failed run stays retryable on the next worker start.
   *
   * @returns {Promise<void>}
   */
  function run() {
    return serialize(async () => {
      try {
        const marker = await read(STORAGE_KEYS.migration);
        if (marker?.phase === 'complete') {
          await cleanUp();
          return;
        }
        if (marker?.phase !== 'verified') {
          await writePhase(marker, 'writing');
        }
        let verified = false;
        try {
          const copied = await copyLegacyCache();
          verified = copied && await migrateCatalog() && await migrateQuotes() && await migrateSettings();
        } catch (error) {
          log.warn('[migration] Migration step failed', error);
        }
        // TODO(#126): delete the migrated local settings once verified, after
        // pages read and write the shared settings through sync storage.
        // A verified marker whose state no longer verifies goes back to writing.
        await writePhase(await read(STORAGE_KEYS.migration), verified ? 'verified' : 'writing');
      } catch (error) {
        log.warn('[migration] Migration attempt failed', error);
      }
    });
  }

  /**
   * The marker phase once the runs started so far have finished, so a page
   * learns whether it should hand off its display state.
   *
   * @returns {Promise<{phase: string|null}>}
   */
  function status() {
    return serialize(async () => ({ phase: (await read(STORAGE_KEYS.migration))?.phase ?? null }));
  }

  /**
   * A page reports that it wrote the v2 display state. The first valid
   * acknowledgement while `verified` completes migration and deletes the v1
   * state; any other acknowledgement changes nothing.
   *
   * @returns {Promise<{ok: boolean}>}
   */
  function acknowledge() {
    return serialize(async () => {
      const marker = await read(STORAGE_KEYS.migration);
      if (marker?.phase !== 'verified') {
        return { ok: false };
      }
      const displayState = await read(STORAGE_KEYS.displayState);
      if (!isValidDisplaySnapshot(displayState) && !isEmptyDisplayState(displayState)) {
        return { ok: false };
      }
      await storage.set({ [STORAGE_KEYS.migration]: { ...marker, phase: 'complete', completedAt: now() } });
      await cleanUp();
      return { ok: true };
    });
  }

  return { run, status, acknowledge };
}
