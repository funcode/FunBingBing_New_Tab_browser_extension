import { buildCanonicalUrls } from '../helpers/image.js';
import { isUhdEnabled } from '../helpers/display-state.js';
import { saveCapturedImage } from '../helpers/wallpaper-download.js';
import { createTransientFeedback } from './transient-feedback.js';

export function captureVisibleFinal(visible, uhdSetting, offline) {
  if (!visible || offline) return null;
  const resolution = isUhdEnabled(uhdSetting) ? 'ultraHighDef' : 'highDef';
  if (visible.url !== buildCanonicalUrls(visible.imageId)[resolution]) return null;
  return Object.freeze({ date: visible.date, imageId: visible.imageId, resolution, blob: visible.blob });
}

// #156 supplies live availability; #157 supplies apply. Until both exist no
// production desktop control is enabled.
export function mountWallpaperActions({ document, window, chrome, readSetting, readVisibleFinal,
  subscribeVisibleFinal, desktopAvailability = { read: () => 'unavailable' } }) {
  const group = document.getElementById('wallpaper-actions');
  const download = document.getElementById('download-image-btn');
  const desktop = document.getElementById('desktop-wallpaper-btn');
  const status = document.getElementById('wallpaper-actions-status');
  const dialog = document.getElementById('wallpaper-download-permission-dialog');
  const proceed = document.getElementById('wallpaper-download-permission-continue');
  const cancel = document.getElementById('wallpaper-download-permission-cancel');
  let permissionGranted = false;
  let permissionRevision = 0;
  let pending = null;
  let saveState = 'idle';
  let statusMessage = '';
  const feedback = createTransientFeedback(window, text => {
    statusMessage = text;
    render();
  });
  const cleanup = [feedback.dispose];
  function listen(target, type, listener) {
    target.addEventListener(type, listener);
    cleanup.push(() => target.removeEventListener(type, listener));
  }
  function observe(event, listener) {
    event.addListener(listener);
    cleanup.push(() => event.removeListener(listener));
  }

  function setStatus(state, text) {
    saveState = state;
    group.dataset.saveState = state;
    feedback.show(text);
  }
  function dismissFeedback() {
    if (statusMessage) feedback.show();
  }
  function capture() {
    return captureVisibleFinal(readVisibleFinal(), readSetting('enable_uhd_wallpaper'),
      document.documentElement.dataset.networkStatus === 'offline');
  }
  function render() {
    const downloadOff = readSetting('enable_image_download') === 'no';
    const availability = desktopAvailability.read();
    const desktopOff = availability !== 'available';
    const ready = Boolean(capture());
    const busy = ['permission-explanation', 'requesting-permission', 'saving'].includes(saveState);
    group.hidden = downloadOff && desktopOff;
    group.dataset.sourceState = ready ? 'ready' : document.documentElement.dataset.networkStatus === 'offline'
      ? 'offline' : readVisibleFinal() ? 'resolution-pending'
        : document.getElementById('main-body').hasAttribute('data-wallpaper-fallback') ? 'fallback' : 'preview';
    download.hidden = downloadOff;
    download.disabled = downloadOff || !ready || busy;
    desktop.hidden = desktopOff;
    desktop.disabled = desktopOff || !desktopAvailability.apply || !ready || busy;
    if (statusMessage) group.dataset.feedback = 'true';
    else delete group.dataset.feedback;
    const message = statusMessage || (!ready && !busy
      ? chrome.i18n.getMessage(group.dataset.sourceState === 'offline' ? 'wallpaper_actions_offline' : 'wallpaper_actions_loading')
      : '');
    if (status.textContent !== message) status.textContent = message;
  }

  async function save(operation) {
    setStatus('saving');
    const outcome = await saveCapturedImage(operation.capture, operation.folder, {
      downloads: chrome.downloads, permissions: chrome.permissions
    }).catch(error => ({ kind: 'failed', reason: error.message }));
    if (outcome.kind === 'complete') {
      setStatus('complete');
      window.dispatchEvent(new window.CustomEvent('funbingbing:wallpapersaved', { detail: outcome.save }));
      if (operation.desktop) {
        try { await desktopAvailability.apply(outcome.save); }
        catch { feedback.show(chrome.i18n.getMessage('wallpaper_desktop_apply_failed')); }
      }
    } else {
      const text = outcome.kind === 'cancelled' ? ''
        : chrome.i18n.getMessage(outcome.kind === 'unconfirmed' ? 'wallpaper_save_unconfirmed' : 'wallpaper_save_failed');
      setStatus(outcome.kind, text);
    }
  }
  function start(desktopAction) {
    if (['permission-explanation', 'requesting-permission', 'saving'].includes(saveState)) return;
    const source = capture();
    if (!source) return;
    const operation = Object.freeze({ capture: source, folder: readSetting('wallpaper_download_folder') ?? '', desktop: desktopAction });
    if (permissionGranted) { void save(operation); return; }
    pending = operation;
    setStatus('permission-explanation');
    dialog.showModal();
  }
  listen(group, 'mouseenter', dismissFeedback);
  listen(group, 'focusin', dismissFeedback);
  listen(download, 'click', () => { if (!download.disabled) start(false); });
  listen(desktop, 'click', () => { if (!desktop.disabled) start(true); });
  listen(proceed, 'click', () => {
    if (!pending) return;
    const operation = pending;
    pending = null;
    // Keep request() in this button's gesture, before the first async step.
    let requested;
    try { requested = chrome.permissions.request({ permissions: ['downloads'] }); }
    catch (error) { requested = Promise.reject(error); }
    dialog.close();
    setStatus('requesting-permission');
    Promise.resolve(requested).then(granted => {
      permissionGranted = granted;
      if (granted) return save(operation);
      setStatus('denied', chrome.i18n.getMessage('wallpaper_permission_declined'));
    }).catch(() => setStatus('failed', chrome.i18n.getMessage('wallpaper_permission_failed')));
  });
  function cancelExplanation() {
    pending = null;
    setStatus('idle');
  }
  listen(cancel, 'click', () => { dialog.close(); cancelExplanation(); });
  listen(dialog, 'cancel', cancelExplanation);
  observe(chrome.permissions.onAdded, change => {
    if (change.permissions?.includes('downloads')) { permissionRevision++; permissionGranted = true; }
  });
  observe(chrome.permissions.onRemoved, change => {
    if (change.permissions?.includes('downloads')) { permissionRevision++; permissionGranted = false; }
  });
  const revisionAtRead = permissionRevision;
  chrome.permissions.contains({ permissions: ['downloads'] }).then(granted => {
    if (revisionAtRead === permissionRevision) permissionGranted = granted;
  }).catch(() => {});
  cleanup.push(subscribeVisibleFinal(render));
  cleanup.push(desktopAvailability.subscribe?.(render));
  listen(window, 'funbingbing:settingschange', render);
  listen(window, 'funbingbing:networkstatuschange', render);
  group.dataset.saveState = saveState;
  render();
  return { dispose() { for (const remove of cleanup) remove?.(); } };
}
