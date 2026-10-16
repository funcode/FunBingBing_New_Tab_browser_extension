/**
 * Service-worker v1-to-v2 migration for the regular context (ADR-0004).
 *
 * Every worker start runs the migration until it is complete. The `writing`
 * phase recovers the suffixed regular state of earlier v2 builds, imports the
 * v1 wallpaper and quote state, copies old Cache Storage responses by
 * canonical URL and writes the shared settings to sync storage. Valid
 * unsuffixed state comes first, then suffixed state, then v1 state. Each step
 * is idempotent, so an interrupted run is simply repeated. Only fresh-read
 * verification of the cache copies, catalog, quote state and sync settings
 * advances the marker to `verified`.
 *
 * The worker never writes the display state. The first page turns the
 * retained display inputs into the v2 display state and acknowledges it; the
 * acknowledgement completes migration and deletes the old state.
 */

import { isValidCalendarDate } from '../helpers/date.js';
import { isEmptyDisplayState, isValidDisplaySnapshot } from '../helpers/display-state.js';
import { canonicalizeImageUrl } from '../helpers/image.js';
import { SHARED_SETTINGS, resolveSharedSettings } from '../helpers/migration.js';
import { importLegacyImages, importSuffixedEntries, isValidCatalogEntry } from './catalog.js';
import { normalizeQuote, pruneQuotes } from './quote-service.js';
import { STORAGE_KEYS, WALLPAPER_CACHE_NAME } from './storage-keys.js';

const LEGACY_IMAGES_KEY = 'bing_images';
const LEGACY_QUOTE_STATE_KEY = 'cache_quote_state';
const SETTING_KEYS = Object.keys(SHARED_SETTINGS);

// Regular state of earlier v2 builds, kept under context-suffixed names.
const SUFFIXED_KEYS = Object.freeze({
  catalog: 'bing_wallpaper_catalog_v2_regular',
  displayState: 'wallpaper_display_state_v2_regular',
  quoteState: 'cache_quote_state_v2_regular',
  quoteLease: 'quote_scrape_state_v2_regular',
  migration: 'wallpaper_migration_v2_state_regular'
});

// Old caches, copied in this order and deleted on completion.
const OLD_CACHE_NAMES = Object.freeze(['funbingbing-wallpaper-cache-v2-regular', 'funbingbing-wallpaper-cache-v1']);

// Old keys deleted on completion: the suffixed state, and the v1 wallpaper,
// display inputs, lock, index, quick facts, model preload and quote caches,
// including those of older v1 builds.
const OLD_KEYS = Object.freeze([
  ...Object.values(SUFFIXED_KEYS),
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
    const suffixed = await read(SUFFIXED_KEYS.catalog);
    const images = await read(LEGACY_IMAGES_KEY);
    const { dates } = await catalogService.commitMigration((catalog) => {
      const recovered = importSuffixedEntries(catalog, suffixed, now());
      const imported = importLegacyImages(catalog, images, now());
      const changedDates = [...new Set([...recovered.changedDates, ...imported.changedDates])];
      // A catalog that was never committed is written even with nothing to import.
      return {
        dates: [...recovered.dates, ...imported.dates],
        changedDates,
        changed: changedDates.length > 0 || catalog.updatedAt === 0
      };
    });
    const stored = await read(STORAGE_KEYS.catalog);
    return stored?.version === 2 && isObject(stored.entries) &&
      dates.every(date => isValidCatalogEntry(stored.entries[date], date));
  }

  // Fill v2 quotes missing from the suffixed, then the v1 quote cache.
  // Resolves true once the quote state holds every quote it should.
  async function migrateQuotes() {
    const current = await read(STORAGE_KEYS.quoteState);
    const quotes = isObject(current?.quotes) ? current.quotes : {};
    let changed = !isObject(current?.quotes);
    for (const key of [SUFFIXED_KEYS.quoteState, LEGACY_QUOTE_STATE_KEY]) {
      const old = await read(key);
      for (const [date, raw] of Object.entries(isObject(old?.quotes) ? old.quotes : {})) {
        // Older builds stored a missing caption as null.
        const quote = isObject(raw) ? normalizeQuote({ ...raw, caption: raw.caption ?? '' }) : null;
        if (isValidCalendarDate(date) && quote && !normalizeQuote(quotes[date])) {
          quotes[date] = quote;
          changed = true;
        }
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

  // Responses missing from the v2 cache are copied under their canonical URL,
  // the first old cache winning. Resolves true once the v2 cache holds every
  // canonical URL; a failed copy is retried on the next run because the old
  // caches stay until completion.
  async function copyOldCaches() {
    const current = await caches.open(WALLPAPER_CACHE_NAME);
    for (const name of OLD_CACHE_NAMES) {
      if (!(await caches.has(name))) {
        continue;
      }
      const old = await caches.open(name);
      for (const request of await old.keys()) {
        const url = canonicalizeImageUrl(request.url);
        if (!url || await current.match(url)) {
          continue;
        }
        const response = await old.match(request);
        if (response) {
          await current.put(url, response);
        }
        if (!(await current.match(url))) {
          return false;
        }
      }
    }
    return true;
  }

  async function cleanUp() {
    try {
      await storage.remove([...OLD_KEYS]);
      for (const name of OLD_CACHE_NAMES) {
        await caches.delete(name);
      }
    } catch (error) {
      log.warn('[migration] Deleting old state failed', error);
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
          const copied = await copyOldCaches();
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
   * acknowledgement while `verified` completes migration and deletes the old
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
