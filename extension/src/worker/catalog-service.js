/**
 * Service-worker catalog owner: target-date rollover, per-source metadata
 * refresh with bounded retry, and the serial catalog write queue.
 *
 * The worker is the sole catalog writer. The page-owned display state is read
 * only, to protect the displayed identity from stale results. Until migration
 * completes, the legacy display identity the first page will hand off stands
 * in for a missing display state.
 */

import { getZhCnTargetDate } from '../helpers/date.js';
import { isEmptyDisplayState, isValidDisplaySnapshot } from '../helpers/display-state.js';
import { buildMigratedDisplayState } from '../helpers/migration.js';
import { validateSourceCoverage } from '../helpers/metadata.js';
import {
  canBypassWithReconnect,
  isRetryEligible,
  recordFailure,
  recordReconnectBypass,
  resetRetry
} from '../helpers/retry.js';
import {
  SOURCES,
  admitCandidates,
  applyTriviaResult,
  deriveTriviaCandidates,
  normalizeCatalog,
  parseSourceCandidates,
  recordTriviaReconnect,
  rollToTargetDate
} from './catalog.js';
import { STORAGE_KEYS } from './storage-keys.js';

const SOURCE_URLS = Object.freeze({
  imageOfTheDay: 'https://www.bing.com/hp/api/v1/imageoftheday?format=json&mkt=zh-CN',
  model: 'https://cn.bing.com/hp/api/model?mkt=zh-CN',
  archive: 'https://www.bing.com/HPImageArchive.aspx?format=js&n=1&mkt=zh-CN&idx=7'
});

/**
 * @param {Object} deps
 * @param {{get: Function, set: Function}} deps.storage - chrome.storage.local-shaped area
 * @param {(url: string) => Promise<any>} deps.fetchJson - Rejects on transport or JSON failure
 * @param {() => number} [deps.now]
 * @param {() => string} [deps.getTargetDate]
 * @param {(message: Object) => void} [deps.broadcast]
 * @param {(candidates: Array<{date: string, triviaId: string}>) => void} [deps.scheduleTrivia]
 * @param {() => void} [deps.onCatalogChanged] - Called after a metadata commit changed the catalog
 * @param {{warn: Function}} [deps.log]
 */
export function createCatalogService({
  storage,
  fetchJson,
  now = Date.now,
  getTargetDate = getZhCnTargetDate,
  broadcast = () => {},
  scheduleTrivia = () => {},
  onCatalogChanged = () => {},
  log = console
}) {
  let writeChain = Promise.resolve();
  const refreshesByDate = new Map();

  function enqueueWrite(task) {
    const run = writeChain.then(task);
    writeChain = run.catch(() => {});
    return run;
  }

  async function readCatalog() {
    const stored = await storage.get(STORAGE_KEYS.catalog);
    return normalizeCatalog(stored[STORAGE_KEYS.catalog]);
  }

  // The page-owned display state. While migration waits for the first page,
  // the legacy display identity that page will hand off, flagged `handoff`,
  // takes its place so its catalog entry and responses survive until then.
  async function readDisplayState(catalog) {
    const stored = await storage.get([STORAGE_KEYS.displayState, STORAGE_KEYS.migration, 'wallpaper_url', 'wallpaper_date']);
    const snapshot = stored[STORAGE_KEYS.displayState];
    if (isValidDisplaySnapshot(snapshot)) {
      return snapshot;
    }
    if (stored[STORAGE_KEYS.migration]?.phase === 'complete' || isEmptyDisplayState(snapshot)) {
      return null;
    }
    // The resolution only matters for a legacy URL without one.
    const legacy = buildMigratedDisplayState(catalog,
      { wallpaperUrl: stored.wallpaper_url, wallpaperDate: stored.wallpaper_date }, true);
    return isValidDisplaySnapshot(legacy) ? { ...legacy, handoff: true } : null;
  }

  // Fresh-read, mutate and persist through the serial queue.
  function commitWith(mutate, afterCommit) {
    return enqueueWrite(async () => {
      const catalog = await readCatalog();
      const displayState = await readDisplayState(catalog);
      const result = mutate(catalog, displayState);
      if (result.changed) {
        catalog.updatedAt = now();
        await storage.set({ [STORAGE_KEYS.catalog]: catalog });
      }
      if (result.changedDates && result.changedDates.length > 0) {
        broadcast({ type: 'wallpaperCatalogUpdated', dates: result.changedDates });
      }
      afterCommit(catalog, result);
      return result;
    });
  }

  // Metadata commits. Trivia is derived from the catalog as committed, never
  // from candidates.
  function commit(mutate) {
    return commitWith(mutate, (catalog, result) => {
      scheduleTrivia(deriveTriviaCandidates(catalog, now()));
      if (result.changed) {
        onCatalogChanged();
      }
    });
  }

  /**
   * Commit image bookkeeping (failure records, cachedFutureDepth) through the
   * same serial queue. It neither schedules trivia nor reports a catalog change.
   *
   * @param {(catalog: Object, displayState: Object|null) => {changed: boolean, changedDates?: string[]}} mutate
   */
  function commitImageState(mutate) {
    return commitWith(mutate, () => {});
  }

  /**
   * Commit one trivia result through the same serial queue, against a fresh
   * read of its entry. It neither schedules trivia nor starts image work.
   *
   * @param {{date: string, triviaId: string, ok: boolean, data?: Object|null}} result
   */
  function commitTriviaResult(result) {
    return commitWith(catalog => applyTriviaResult(catalog, result, now()), () => {});
  }

  /**
   * Commit a migration import through the same serial queue. It neither
   * schedules trivia nor starts image work: the gated refresh that follows
   * migration does both.
   *
   * @param {(catalog: Object) => {changed: boolean}} mutate
   */
  function commitMigration(mutate) {
    return commitWith(mutate, () => {});
  }

  /** @returns {Promise<{catalog: Object, displayState: Object|null}>} */
  async function read() {
    const catalog = await readCatalog();
    return { catalog, displayState: await readDisplayState(catalog) };
  }

  function beginRefresh(targetDate, reconnectTime) {
    return commit((catalog, displayState) => {
      let changed = rollToTargetDate(catalog, targetDate, displayState?.handoff ? displayState : null);
      const refreshState = catalog.refreshState;
      if (refreshState.date !== targetDate) {
        // A newer target date has already been committed.
        return { changed, due: [] };
      }
      const due = [];
      for (const source of SOURCES) {
        const state = refreshState.sources[source];
        if (state.status === 'success') {
          continue;
        }
        if (isRetryEligible(state, now())) {
          due.push(source);
        } else if (reconnectTime && canBypassWithReconnect(state, now(), reconnectTime)) {
          refreshState.sources[source] = recordReconnectBypass(state, reconnectTime);
          changed = true;
          due.push(source);
        }
      }
      // Trivia retries are separate retry objects; the derivation after this
      // commit includes each bypassed entry.
      if (reconnectTime && recordTriviaReconnect(catalog, now(), reconnectTime)) {
        changed = true;
      }
      return { changed, due, generation: refreshState.generation };
    });
  }

  async function fetchSource(source) {
    try {
      return { ok: true, response: await fetchJson(SOURCE_URLS[source]) };
    } catch (error) {
      log.warn(`[catalog] ${source} request failed`, error);
      return { ok: false };
    }
  }

  function commitSourceResult(source, result, targetDate, generation) {
    return commit((catalog, displayState) => {
      const refreshState = catalog.refreshState;
      const stale = refreshState.generation !== generation;
      let status = 'failed';
      if (result.ok) {
        status = validateSourceCoverage(source, result.response, targetDate, catalog) ? 'success' : 'missing';
      }
      const candidates = result.ok ? parseSourceCandidates(source, result.response, log) : [];
      const { changedDates } = admitCandidates(catalog, candidates, {
        stale,
        displayState,
        now: now()
      });

      if (stale) {
        // An older round never rewrites the current round's source state.
        if (status !== 'success') {
          log.warn(`[catalog] Ignoring ${status} ${source} result from refresh generation ${generation}`);
        }
        return { changed: changedDates.length > 0, changedDates };
      }

      const previous = refreshState.sources[source];
      refreshState.sources[source] = status === 'success'
        ? { status, ...resetRetry() }
        : { status, ...recordFailure(previous, now()) };
      return { changed: true, changedDates };
    });
  }

  async function runRefresh(targetDate, reconnectTime) {
    const { due, generation } = await beginRefresh(targetDate, reconnectTime);
    const commits = {};
    for (const source of due) {
      const response = fetchSource(source);
      // Archive coverage depends on the IOTD window, so its commit follows the
      // IOTD commit of the same round while both requests run in parallel.
      // Archive success therefore implies IOTD success for the date; since a
      // successful source is not refetched within a generation and stale rounds
      // only fill missing fields, the validated IOTD window cannot change
      // identity afterwards and Archive needs no separate invalidation.
      const after = source === 'archive' && commits.imageOfTheDay
        ? commits.imageOfTheDay.catch(() => {})
        : null;
      commits[source] = Promise.all([response, after])
        .then(([result]) => commitSourceResult(source, result, targetDate, generation));
    }
    await Promise.all(Object.values(commits));
  }

  /**
   * Refresh metadata sources for the current target date. Concurrent calls for
   * the same date share one promise; a new date starts its own round at once,
   * turning the older round's late results stale.
   *
   * @param {{reconnect?: boolean}} [options] - reconnect may bypass one active
   *   backoff window per source
   * @returns {Promise<void>} Resolves after each due source has committed
   */
  function refresh({ reconnect = false } = {}) {
    const targetDate = getTargetDate();
    const existing = refreshesByDate.get(targetDate);
    if (existing) {
      // The running round may not have been allowed to bypass backoff, so a
      // reconnect gets its own follow-up round.
      return reconnect ? existing.then(() => refresh({ reconnect })) : existing;
    }
    const promise = runRefresh(targetDate, reconnect ? now() : 0)
      .finally(() => refreshesByDate.delete(targetDate));
    refreshesByDate.set(targetDate, promise);
    return promise;
  }

  return { refresh, read, commitImageState, commitTriviaResult, commitMigration };
}
