/**
 * Page-side wallpaper controller: the new tab page as a read-only consumer of
 * the worker's catalog and Cache Storage. It never fetches or caches wallpaper
 * images, and it is the only writer of the display snapshot.
 *
 * No DOM, chrome.* or Cache Storage access: cache reads, decoding, storage and
 * messaging are injected, so the behaviour runs under Node tests. Rendering is
 * delegated through the view callbacks.
 */

import { isUhdEnabled, isValidDisplaySnapshot, snapshotMatchesIdentity } from '../helpers/display-state.js';
import { buildCanonicalUrls, isValidImageIdentity } from '../helpers/image.js';
import { getNavigableDates } from '../helpers/retention.js';

/**
 * Project a catalog entry into the identity and canonical URLs the page
 * displays. The entry already carries canonical URLs, so nothing is rebuilt.
 *
 * @param {Object} entry - Committed catalog entry
 * @param {boolean} enableUhd - Whether the configured final resolution is UHD
 * @returns {{date: string, imageId: string, url: string, previewUrl: string|null}|null}
 */
export function deriveEntryView(entry, enableUhd) {
  if (!entry || !entry.urls || !isValidImageIdentity(entry.imageId)) {
    return null;
  }
  const url = enableUhd ? entry.urls.ultraHighDef : entry.urls.highDef;
  if (!url) {
    return null;
  }
  return { date: entry.date, imageId: entry.imageId, url, previewUrl: entry.urls.preview || null };
}

// The same final image: date, identity and final URL all match.
function isSameFinal(a, b) {
  return snapshotMatchesIdentity(a, b?.date, b?.imageId) && a.url === b.url;
}

/**
 * @param {Object} deps
 * @param {() => Promise<Object>} deps.readCatalog - Fresh read of the committed v2 catalog
 * @param {() => Promise<Object|null>} deps.readDisplayState - Fresh read of the display snapshot
 * @param {(snapshot: Object) => Promise<void>} deps.writeDisplayState - Atomic snapshot write
 * @param {(url: string) => Promise<Blob|null>} deps.matchImage - Cache Storage match, read only
 * @param {(blob: Blob) => Promise<string>} deps.toDataUrl - Preview blob to data URL
 * @param {(request: {date: string, resolution: string}) => Promise<any>} deps.requestImage -
 *   Asks the worker to cache one catalog image; resolves when the worker has finished with it
 * @param {() => Promise<string|undefined>} deps.readUhdSetting
 * @param {Object} deps.view
 * @param {(shown: {view: Object, entry?: Object, blob: Blob, isCurrent: () => boolean}) => Promise<boolean>} deps.view.applyFinal -
 *   Decodes a final image, then applies it only if isCurrent() still holds.
 *   Resolves true only when the image was applied; a failed decode applies nothing.
 * @param {(shown: {view: Object, entry: Object, blob: Blob}) => void} deps.view.applyPreview
 * @param {(shown: {view: Object, entry?: Object}) => void} deps.view.refreshContents - Re-renders
 *   the texts of the image already on screen
 * @param {() => void} deps.view.showUpdating
 * @param {() => void} deps.view.showFallback
 * @param {() => number} [deps.now]
 * @param {{warn: Function}} [deps.log]
 */
export function createWallpaperController({
  readCatalog,
  readDisplayState,
  writeDisplayState,
  matchImage,
  toDataUrl,
  requestImage,
  readUhdSetting,
  view,
  now = Date.now,
  log = console
}) {
  // Page-local token, claimed when an action starts and before its first
  // read: a callback of an older action cannot override a newer one in this
  // page. It guards nothing outside this page.
  let generation = 0;
  // The action in flight, so a catalog notification continues it instead of
  // cancelling it. `date` is null while a navigation is choosing its date.
  let pending = null;
  // Date of the image on screen, including a temporary initialization preview.
  let displayDate = null;
  // The final image this page has rendered, with its catalog entry if any.
  let onScreen = null;
  let onScreenEntry;
  // The snapshot this page restored or published. Showing it again is not a
  // new application and never replaces another tab's later commit.
  let committed = null;
  // Snapshot writes of this page, serialized in the order images were applied.
  let writes = Promise.resolve();

  const superseded = { applied: false, reason: 'superseded' };

  async function readState() {
    const [catalog, stored] = await Promise.all([readCatalog(), readUhdSetting()]);
    return { catalog, enableUhd: isUhdEnabled(stored) };
  }

  async function match(url) {
    if (!url) {
      return null;
    }
    try {
      return await matchImage(url);
    } catch (error) {
      log.warn('[wallpaper] Cache match failed', error);
      return null;
    }
  }

  // The cached matching preview as a data URL, or the explicit empty value.
  async function previewDataUrl(target) {
    const cached = await match(target.previewUrl);
    if (!cached) {
      return '';
    }
    try {
      return (await toDataUrl(cached)) || '';
    } catch (error) {
      log.warn('[wallpaper] Preview conversion failed', error);
      return '';
    }
  }

  function enqueueWrite(task) {
    const run = writes.then(task);
    writes = run.catch(() => {});
    return run;
  }

  // Record a newly applied final image. Without a cached preview the snapshot
  // keeps the stored preview of the same identity, never one of another.
  // Resolves the preview that was reconstructed, if any.
  function publish(target, appliedAt) {
    return enqueueWrite(async () => {
      const preview = await previewDataUrl(target);
      const current = await readDisplayState();
      const kept = snapshotMatchesIdentity(current, target.date, target.imageId) ? current.preloadDataUrl : '';
      await writeDisplayState({
        date: target.date,
        imageId: target.imageId,
        url: target.url,
        preloadDataUrl: preview || kept || '',
        updatedAt: appliedAt
      });
      return preview;
    });
  }

  // Fill an empty preview of the snapshot that is still exactly this final
  // image. updatedAt keeps recording the final-image application.
  function repairPreview(target) {
    return enqueueWrite(async () => {
      const preview = await previewDataUrl(target);
      const current = preview ? await readDisplayState() : null;
      if (isSameFinal(current, target) && current.preloadDataUrl === '') {
        await writeDisplayState({ ...current, preloadDataUrl: preview });
      }
      return preview;
    });
  }

  // Ask the worker for the missing preview. Its completion is one repair
  // opportunity; every later initialization is another.
  function requestPreviewRepair(target, token) {
    requestImage({ date: target.date, resolution: 'preview' })
      .then(() => (token === generation ? repairPreview(target) : null))
      .catch(error => log.warn('[wallpaper] Preview repair failed', error));
  }

  // Decode and apply first; the snapshot and its preview follow the image.
  async function showFinal(target, entry, blob, token) {
    const applied = await view.applyFinal({ view: target, entry, blob, isCurrent: () => token === generation });
    if (!applied) {
      return token === generation ? { applied: false, reason: 'decode failed' } : superseded;
    }
    const isNewApplication = !isSameFinal(committed, target);
    onScreen = target;
    onScreenEntry = entry;
    displayDate = target.date;
    committed = target;
    const preview = await (isNewApplication ? publish(target, now()) : repairPreview(target));
    // Only catalog images can be requested from the worker.
    if (!preview && entry && target.previewUrl && token === generation) {
      requestPreviewRepair(target, token);
    }
    return { applied: true };
  }

  async function runAction(date, allowPreview, token) {
    const isCurrent = () => token === generation;
    const state = await readState();
    if (!isCurrent()) {
      return superseded;
    }
    const entry = state.catalog?.entries?.[date];
    const target = deriveEntryView(entry, state.enableUhd);
    if (!target) {
      return { applied: false, reason: 'no catalog entry' };
    }

    if (isSameFinal(onScreen, target)) {
      onScreenEntry = entry;
      view.refreshContents({ view: target, entry });
      await repairPreview(target);
      return { applied: true };
    }

    const cachedFinal = await match(target.url);
    if (!isCurrent()) {
      return superseded;
    }
    if (cachedFinal) {
      return showFinal(target, entry, cachedFinal, token);
    }

    let previewShown = false;
    if (allowPreview) {
      const cachedPreview = await match(target.previewUrl);
      if (!isCurrent()) {
        return superseded;
      }
      if (cachedPreview) {
        displayDate = target.date;
        view.applyPreview({ view: target, entry, blob: cachedPreview });
        previewShown = true;
      }
    }
    view.showUpdating();

    try {
      await requestImage({ date, resolution: state.enableUhd ? 'ultraHighDef' : 'highDef' });
    } catch (error) {
      log.warn('[wallpaper] Image request failed', error);
    }
    const fetchedFinal = await match(target.url);
    // The date may resolve to another identity or resolution by now.
    const latest = fetchedFinal ? await readState() : null;
    if (!isCurrent()) {
      return superseded;
    }
    const latestEntry = latest?.catalog?.entries?.[date];
    if (!isSameFinal(deriveEntryView(latestEntry, latest?.enableUhd), target)) {
      return { applied: false, reason: fetchedFinal ? 'identity changed' : 'final unavailable', previewShown };
    }
    return { ...(await showFinal(target, latestEntry, fetchedFinal, token)), previewShown };
  }

  /**
   * Apply one catalog date under an already claimed token. A cached final
   * image is applied at once. Otherwise the worker is asked for it and the
   * page swaps once when it is decoded; with allowPreview the matching cached
   * preview renders meanwhile.
   */
  async function act(token, date, allowPreview) {
    pending = { date, allowPreview };
    let result;
    try {
      result = await runAction(date, allowPreview, token);
    } finally {
      if (token === generation) {
        pending = null;
      }
    }
    // A failed action leaves the image and the snapshot; only its pending
    // headline is withdrawn.
    if (!result.applied && token === generation && onScreen) {
      view.refreshContents({ view: onScreen, entry: onScreenEntry });
    }
    return result;
  }

  // The committed image stays protected in Cache Storage after the catalog
  // stops mapping its date to it, so it is matched by its own canonical URLs.
  async function showCommitted(snapshot, token) {
    const target = {
      date: snapshot.date,
      imageId: snapshot.imageId,
      url: snapshot.url,
      previewUrl: buildCanonicalUrls(snapshot.imageId).preview
    };
    const blob = await match(target.url);
    if (token !== generation) {
      return superseded;
    }
    return blob ? showFinal(target, undefined, blob, token) : { applied: false, reason: 'final unavailable' };
  }

  /**
   * Start from the committed display snapshot, otherwise from the target
   * date. A background target-date refresh never moves the page off the
   * committed selection.
   *
   * @returns {Promise<{applied: boolean, reason?: string, previewShown?: boolean}>}
   */
  async function initialize() {
    const token = ++generation;
    pending = null;
    const [state, stored] = await Promise.all([readState(), readDisplayState()]);
    if (token !== generation) {
      return superseded;
    }
    const snapshot = isValidDisplaySnapshot(stored) ? stored : null;
    if (snapshot) {
      committed = { date: snapshot.date, imageId: snapshot.imageId, url: snapshot.url };
      const entry = state.catalog?.entries?.[snapshot.date];
      // On failure the boot-painted preview of this snapshot stays on screen.
      if (entry?.imageId === snapshot.imageId) {
        return act(token, snapshot.date, true);
      }
      const shown = await showCommitted(snapshot, token);
      if (shown.applied || token !== generation) {
        return shown;
      }
      if (entry) {
        return act(token, snapshot.date, true);
      }
    }
    const targetDate = state.catalog?.refreshState?.date;
    const result = state.catalog?.entries?.[targetDate]
      ? await act(token, targetDate, true)
      : { applied: false, reason: 'target not published' };
    if (!result.applied && !result.previewShown && result.reason !== 'superseded') {
      view.showFallback();
    }
    return result;
  }

  /**
   * Navigate over the committed current and historical entries, wrapping by
   * their actual count. The destination preview is never rendered, and the
   * destination is published only after its final image is applied.
   *
   * @param {number} offset - 1 for the previous (older) date, -1 for the next
   */
  async function navigate(offset) {
    const token = ++generation;
    const interrupted = pending;
    pending = { date: null };
    const { catalog } = await readState();
    if (token !== generation) {
      return superseded;
    }
    const dates = getNavigableDates(catalog, catalog?.refreshState?.date);
    const index = dates.indexOf(displayDate ?? catalog?.refreshState?.date);
    if (index >= 0) {
      return act(token, dates[(index + offset + dates.length) % dates.length], false);
    }
    // Nowhere to go: the action this click interrupted carries on.
    pending = null;
    return interrupted?.date
      ? act(token, interrupted.date, interrupted.allowPreview)
      : { applied: false, reason: 'not navigable' };
  }

  /**
   * Guarded reread after a wallpaperCatalogUpdated notification. It continues
   * the action in flight, refreshes the displayed date, or initializes a page
   * that has nothing to show yet.
   *
   * @param {string[]} [dates] - Catalog dates the notification reports as changed
   */
  async function catalogUpdated(dates) {
    const current = pending || (displayDate && { date: displayDate, allowPreview: false });
    if (!current) {
      return initialize();
    }
    // A navigation that is still choosing its date rereads the catalog itself.
    if (current.date === null || (Array.isArray(dates) && !dates.includes(current.date))) {
      return { applied: false, reason: 'not displayed' };
    }
    return act(++generation, current.date, current.allowPreview);
  }

  return { initialize, navigate, catalogUpdated };
}
