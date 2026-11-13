import {
  DESKTOP_WALLPAPER_AVAILABLE, DESKTOP_WALLPAPER_OFF_PENDING,
  NATIVE_WALLPAPER_PERMISSION, changesNativeWallpaperPermission
} from '../helpers/desktop-wallpaper-availability.js';
import { isAbsoluteDownloadFilename } from '../helpers/wallpaper-download.js';
import { applyWallpaperWithHelper, verifyWallpaperHelper } from './native-wallpaper.js';

export function registerDesktopWallpaperSetup(chrome) {
  const { permissions, runtime, storage } = chrome;
  const optionsUrl = runtime.getURL('options.html');
  const newTabUrl = runtime.getURL('newtab.html');
  const blobPrefix = `blob:${runtime.getURL('')}`;
  let status = 'idle';
  let activeCheck;
  let pendingPermission;
  let intentRevision = 0;
  const cleared = { [DESKTOP_WALLPAPER_AVAILABLE]: false, [DESKTOP_WALLPAPER_OFF_PENDING]: false };
  let writes = Promise.all([
    storage.local.get([DESKTOP_WALLPAPER_AVAILABLE, DESKTOP_WALLPAPER_OFF_PENDING]),
    permissions.contains(NATIVE_WALLPAPER_PERMISSION)
  ]).then(([local, granted]) => {
    if (local[DESKTOP_WALLPAPER_OFF_PENDING] === true ||
        (!granted && local[DESKTOP_WALLPAPER_AVAILABLE] === true)) return storage.local.set(cleared);
  }).catch(() => {});

  function publish(nextStatus) {
    status = nextStatus;
    runtime.sendMessage({ type: 'desktopWallpaperStatusChanged', status }).catch(() => {});
  }

  function writeAvailability(available, signal, beforeWrite) {
    const write = Promise.allSettled([writes, beforeWrite]).then(([, before]) => {
      if (before.status === 'rejected') throw before.reason;
      if (!signal?.aborted) {
        return storage.local.set(available ? { [DESKTOP_WALLPAPER_AVAILABLE]: true } : cleared);
      }
    });
    writes = write.catch(() => {});
    return write;
  }

  function turnOff(nextStatus) {
    activeCheck?.controller.abort();
    activeCheck = undefined;
    const revision = ++intentRevision;
    // An earlier positive write can finish after Off, even if this worker stops.
    const blocked = storage.local.set({ [DESKTOP_WALLPAPER_OFF_PENDING]: true }).then(() => {
      if (revision === intentRevision) publish(nextStatus);
    });
    return writeAvailability(false, undefined, blocked);
  }

  function requestPermission() {
    pendingPermission ??= permissions.request(NATIVE_WALLPAPER_PERMISSION).finally(() => {
      pendingPermission = undefined;
    });
    return pendingPermission;
  }

  async function check(attempt) {
    const { signal } = attempt;
    let result;
    try {
      const granted = await requestPermission();
      if (signal.aborted) return;
      result = granted ? await verifyWallpaperHelper(runtime, signal) : 'denied';
    } catch {
      result = 'failed';
    }
    if (signal.aborted) return;
    try {
      await writeAvailability(result === 'verified', signal);
    } catch {
      result = 'failed';
    }
    if (signal.aborted) return;
    activeCheck = undefined;
    publish(result);
  }

  async function apply({ downloadId, downloadUrl }) {
    if (!Number.isInteger(downloadId) || typeof downloadUrl !== 'string' || !downloadUrl.startsWith(blobPrefix)) {
      return 'save-unconfirmed';
    }
    const revision = intentRevision;
    let item;
    try {
      [item] = await chrome.downloads.search({ id: downloadId });
    } catch {
      return 'save-unconfirmed';
    }
    if (item?.id !== downloadId || item.state !== 'complete' || item.byExtensionId !== runtime.id ||
        item.url !== downloadUrl || !isAbsoluteDownloadFilename(item.filename)) return 'save-unconfirmed';

    const result = await permissions.contains(NATIVE_WALLPAPER_PERMISSION)
      ? await applyWallpaperWithHelper(runtime, item.filename) : 'denied';
    if (['denied', 'unavailable', 'incompatible'].includes(result)) {
      const current = () => revision === intentRevision && !activeCheck;
      const write = writes.then(() => current() && storage.local.set(cleared));
      writes = write.catch(() => {});
      await writes;
      if (current()) publish(result);
    }
    return result;
  }

  runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'applyDesktopWallpaper') {
      if (sender.url !== newTabUrl || sender.id !== runtime.id || sender.frameId !== 0 || !sender.tab) return;
      apply(message).then(respond, () => respond('unconfirmed'));
      return true;
    }
    if (sender.url !== optionsUrl || sender.frameId !== 0) return;
    if (message?.type === 'desktopWallpaperStatus') {
      respond(status);
    } else if (message?.type === 'checkDesktopWallpaper') {
      if (!activeCheck) {
        intentRevision++;
        const controller = new AbortController();
        // Chromium forwards the Setup click's activation to this message handler.
        activeCheck = { controller, finished: check(controller) };
        publish('checking');
      }
      activeCheck.finished.then(() => respond(true));
      return true;
    } else if (message?.type === 'disableDesktopWallpaper') {
      turnOff('off').then(() => respond(true), () => respond(false));
      return true;
    }
  });

  permissions.onRemoved.addListener(change => {
    if (changesNativeWallpaperPermission(change)) void turnOff('denied').catch(() => publish('failed'));
  });

  publish('idle');
}
