/**
 * Service-worker image prefetch scheduler: one consumer with at most one
 * active wallpaper image fetch, one task per canonical URL, urgent promotion
 * and an in-memory imagePrefetchGeneration. Work is rebuilt from the catalog
 * and Cache Storage on each qualifying event; no queue state is persisted.
 *
 * The scheduler reads but never writes the page-owned display state.
 */

import { isValidCalendarDate } from '../helpers/date.js';
import {
  TASK_PRIORITY,
  canDispatchImageTask,
  resolveImageTaskAction,
  shouldCacheFetchResponse
} from '../helpers/image-task.js';
import { calculateCachedFutureDepth, calculateRetentionSet } from '../helpers/retention.js';
import {
  canBypassWithReconnect,
  createRetryObject,
  isRetryEligible,
  recordFailure,
  recordReconnectBypass
} from '../helpers/retry.js';
import { deriveImageWork } from './image-work.js';

const RESOLUTIONS = Object.freeze(['preview', 'highDef', 'ultraHighDef']);

// Queue marker: remove unreferenced keys before the future batch starts.
const CLEANUP = Object.freeze({ cleanup: true });

/** The sync setting stores "yes"/"no"; a missing value keeps the "yes" default. */
function isUhdEnabled(value) {
  return value === undefined || value === 'yes';
}

/**
 * @param {Object} deps
 * @param {{read: Function, commitImageState: Function}} deps.catalogService
 * @param {{get: Function}} deps.syncStorage - chrome.storage.sync-shaped area
 * @param {() => Promise<Cache>} deps.openCache
 * @param {(url: string) => Promise<Response>} deps.fetchImage - Rejects on transport or HTTP failure
 * @param {() => number} [deps.now]
 * @param {{warn: Function}} [deps.log]
 */
export function createImageScheduler({
  catalogService,
  syncStorage,
  openCache,
  fetchImage,
  now = Date.now,
  log = console
}) {
  let imagePrefetchGeneration = 0;
  let workSignature = null;
  let reconnectTime = 0;
  const tasks = new Map();
  let queue = [];
  let draining = null;
  let reconcileChain = Promise.resolve();

  async function readState() {
    const { catalog, displayState } = await catalogService.read();
    const stored = await syncStorage.get('enable_uhd_wallpaper');
    const enableUhd = isUhdEnabled(stored.enable_uhd_wallpaper);
    return { catalog, displayState, enableUhd, retention: retentionOf(catalog, displayState, enableUhd) };
  }

  function retentionOf(catalog, displayState, enableUhd) {
    return calculateRetentionSet(catalog, displayState, enableUhd, catalog.refreshState.date);
  }

  function createTask(url, date, priority) {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const task = { url, date, priority, generation: imagePrefetchGeneration, active: false, promise, resolve };
    tasks.set(url, task);
    return task;
  }

  // The task stays in the map until its cache or failure bookkeeping is done.
  function settle(task, outcome) {
    if (tasks.get(task.url) === task) {
      tasks.delete(task.url);
    }
    task.resolve(outcome);
  }

  // Replace pending work with the latest derivation. Urgent tasks keep the
  // front while their URL is retained; background tasks are kept only when
  // still derived, and re-placed in baseline order. Active tasks are untouched.
  function rebuildQueue(work, retention) {
    const derived = new Set(work.map(item => item.url));
    const next = [];
    for (const step of queue) {
      if (step === CLEANUP) {
        continue;
      }
      const urgent = step.priority === TASK_PRIORITY.URGENT;
      if (!(urgent ? retention.has(step.url) : derived.has(step.url))) {
        settle(step, 'obsolete');
        continue;
      }
      step.generation = imagePrefetchGeneration;
      if (urgent) {
        next.push(step);
      }
    }
    const placed = new Set(next.map(task => task.url));
    for (const item of work) {
      if (item.phase === 'future' && !next.includes(CLEANUP)) {
        next.push(CLEANUP);
      }
      const existing = tasks.get(item.url);
      if (placed.has(item.url) || existing?.active) {
        continue;
      }
      placed.add(item.url);
      next.push(existing || createTask(item.url, item.date, TASK_PRIORITY.NORMAL));
    }
    if (!next.includes(CLEANUP)) {
      next.push(CLEANUP);
    }
    queue = next;
  }

  function pump() {
    if (!draining) {
      draining = drain();
    }
    return draining;
  }

  async function drain() {
    for (;;) {
      while (queue.length > 0) {
        const step = queue.shift();
        try {
          await (step === CLEANUP ? cleanup() : runTask(step));
        } catch (error) {
          log.warn('[images] Image step failed', error);
          if (step !== CLEANUP) {
            settle(step, 'failed');
          }
        }
      }
      try {
        await updateCachedFutureDepth();
      } catch (error) {
        log.warn('[images] cachedFutureDepth update failed', error);
      }
      if (queue.length === 0) {
        draining = null;
        return;
      }
    }
  }

  // Backoff permits an attempt once expired; a reconnect may bypass one
  // active window per URL without resetting its level.
  async function mayAttempt(url, catalog) {
    const failure = catalog.refreshState.imageFailures[url];
    if (!failure || isRetryEligible(failure, now())) {
      return true;
    }
    const time = reconnectTime;
    if (!time || !canBypassWithReconnect(failure, now(), time)) {
      return false;
    }
    const { allowed } = await catalogService.commitImageState((fresh) => {
      const current = fresh.refreshState.imageFailures[url];
      if (!current || isRetryEligible(current, now())) {
        return { changed: false, allowed: true };
      }
      if (!canBypassWithReconnect(current, now(), time)) {
        return { changed: false, allowed: false };
      }
      fresh.refreshState.imageFailures[url] = recordReconnectBypass(current, time);
      return { changed: true, allowed: true };
    });
    return allowed;
  }

  async function runTask(task) {
    if (!canDispatchImageTask(task, imagePrefetchGeneration)) {
      settle(task, 'obsolete');
      return;
    }
    // Dispatched from here on: a rebuild neither re-queues nor promotes it,
    // and urgent callers share its promise.
    task.active = true;
    const dispatchedIn = imagePrefetchGeneration;
    const state = await readState();
    if (!state.retention.has(task.url)) {
      settle(task, 'obsolete');
      return;
    }
    const cache = await openCache();
    if (await cache.match(task.url)) {
      settle(task, 'cached');
      return;
    }
    if (!(await mayAttempt(task.url, state.catalog))) {
      settle(task, 'backoff');
      return;
    }
    if (dispatchedIn !== imagePrefetchGeneration && !(await readState()).retention.has(task.url)) {
      settle(task, 'obsolete');
      return;
    }

    let response = null;
    try {
      response = await fetchImage(task.url);
    } catch (error) {
      log.warn(`[images] Fetch failed for ${task.url}`, error);
    }

    // Admission and failure bookkeeping use the latest catalog, display state
    // and resolution, not the generation the fetch started in.
    const latest = await readState();
    if (response) {
      if (!shouldCacheFetchResponse(task.url, latest.retention)) {
        settle(task, 'obsolete');
        return;
      }
      let stored = false;
      try {
        await cache.put(task.url, response);
        stored = true;
      } catch (error) {
        log.warn(`[images] cache.put failed for ${task.url}`, error);
      }
      if (stored) {
        await commitSuccess(task.url);
        settle(task, 'fetched');
        return;
      }
    }
    await commitFailure(task.url, latest.enableUhd);
    settle(task, 'failed');
  }

  function commitSuccess(url) {
    return catalogService.commitImageState((catalog) => {
      const failures = catalog.refreshState.imageFailures;
      const changed = url in failures;
      delete failures[url];
      const changedDates = Object.values(catalog.entries)
        .filter(entry => entry.urls && Object.values(entry.urls).includes(url))
        .map(entry => entry.date);
      return { changed, changedDates };
    });
  }

  function commitFailure(url, enableUhd) {
    return catalogService.commitImageState((catalog, displayState) => {
      if (!retentionOf(catalog, displayState, enableUhd).has(url)) {
        return { changed: false };
      }
      const failures = catalog.refreshState.imageFailures;
      failures[url] = recordFailure(failures[url] || createRetryObject(), now());
      return { changed: true };
    });
  }

  // Delete Cache Storage keys and failure records outside the latest retention
  // set. Skipped until the catalog has a target date.
  async function cleanup() {
    const state = await readState();
    if (!isValidCalendarDate(state.catalog.refreshState.date)) {
      return;
    }
    const cache = await openCache();
    for (const request of await cache.keys()) {
      if (!state.retention.has(request.url)) {
        await cache.delete(request);
      }
    }
    await catalogService.commitImageState((catalog, displayState) => {
      const retention = retentionOf(catalog, displayState, state.enableUhd);
      const failures = catalog.refreshState.imageFailures;
      const unreferenced = Object.keys(failures).filter(url => !retention.has(url));
      for (const url of unreferenced) {
        delete failures[url];
      }
      return { changed: unreferenced.length > 0 };
    });
  }

  // Diagnostic only: never consulted when deciding whether to match or fetch.
  async function updateCachedFutureDepth() {
    const state = await readState();
    const targetDate = state.catalog.refreshState.date;
    if (!isValidCalendarDate(targetDate)) {
      return;
    }
    const cache = await openCache();
    const cachedUrls = new Set();
    for (const item of deriveImageWork(state.catalog, state.enableUhd)) {
      if (item.phase === 'future' && await cache.match(item.url)) {
        cachedUrls.add(item.url);
      }
    }
    const depth = calculateCachedFutureDepth(state.catalog, targetDate, cachedUrls, state.enableUhd);
    await catalogService.commitImageState((catalog) => {
      const refreshState = catalog.refreshState;
      if (refreshState.date !== targetDate || refreshState.cachedFutureDepth === depth) {
        return { changed: false };
      }
      refreshState.cachedFutureDepth = depth;
      return { changed: true };
    });
  }

  // Skipped without a display snapshot. The catalog entry must still hold the
  // displayed identity; otherwise the displayed image has no new final
  // resolution in the retention set.
  function promoteDisplayedFinal({ catalog, displayState, enableUhd, retention }) {
    const entry = displayState ? catalog.entries[displayState.date] : null;
    if (!entry || entry.imageId !== displayState.imageId) {
      return;
    }
    const url = entry.urls?.[enableUhd ? 'ultraHighDef' : 'highDef'];
    if (url && retention.has(url)) {
      promote(url, displayState.date);
    }
  }

  // Put the URL's task at the front of pending work as urgent, creating it if
  // needed. An active task is shared, never interrupted.
  function promote(url, date) {
    let task = tasks.get(url);
    if (resolveImageTaskAction(tasks, url, true, imagePrefetchGeneration) === 'create') {
      task = createTask(url, date, TASK_PRIORITY.URGENT);
      queue.unshift(task);
    } else if (!task.active) {
      // The latest request goes first, even if the task was already urgent.
      queue = queue.filter(step => step !== task);
      task.priority = TASK_PRIORITY.URGENT;
      task.generation = imagePrefetchGeneration;
      queue.unshift(task);
    }
    return task;
  }

  /**
   * Rebuild image work from the catalog and Cache Storage. A change of the
   * derived keys or resolution increments imagePrefetchGeneration. Completed
   * work is skipped again by cache.match(). After a resolution change the
   * displayed wallpaper's new final resolution is urgent.
   *
   * @param {{reconnect?: boolean, resolutionChanged?: boolean}} [options]
   * @returns {Promise<void>} Resolves when the consumer is idle
   */
  function reconcile({ reconnect = false, resolutionChanged = false } = {}) {
    const step = reconcileChain.then(async () => {
      if (reconnect) {
        reconnectTime = now();
      }
      const state = await readState();
      const work = deriveImageWork(state.catalog, state.enableUhd);
      const signature = JSON.stringify([state.catalog.refreshState.date, work.map(item => item.url)]);
      if (signature !== workSignature) {
        imagePrefetchGeneration += 1;
        workSignature = signature;
      }
      rebuildQueue(work, state.retention);
      if (resolutionChanged) {
        promoteDisplayedFinal(state);
      }
      return { drained: pump() };
    });
    reconcileChain = step.catch(() => {});
    return step.then(({ drained }) => drained);
  }

  /**
   * Urgent request for one catalog image, identified by date and resolution.
   * Promotes or inserts its task at the front of pending work, or shares an
   * active fetch; never interrupts the active fetch.
   *
   * @param {{date: string, resolution: 'preview'|'highDef'|'ultraHighDef'}} request
   * @returns {Promise<{ok: boolean, status?: 'cached'|'fetched'|'failed'|'backoff'|'obsolete', error?: string}>}
   */
  async function ensureWallpaperCached({ date, resolution } = {}) {
    if (!isValidCalendarDate(date) || !RESOLUTIONS.includes(resolution)) {
      return { ok: false, error: 'invalid request' };
    }
    const state = await readState();
    const url = state.catalog.entries[date]?.urls?.[resolution];
    if (!url || !state.retention.has(url)) {
      return { ok: false, error: 'not retained' };
    }

    const task = promote(url, date);
    pump();
    return { ok: true, status: await task.promise };
  }

  return { reconcile, ensureWallpaperCached };
}
