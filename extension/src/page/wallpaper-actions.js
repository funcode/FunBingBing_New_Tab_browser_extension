import { buildCanonicalUrls } from '../helpers/image.js';
import { isUhdEnabled } from '../helpers/display-state.js';
import { saveCapturedImage } from '../helpers/wallpaper-download.js';
import { createTransientFeedback } from './transient-feedback.js';

const DESKTOP_RESULT_MESSAGES = {
  applied: 'wallpaper_desktop_applied',
  partial: 'wallpaper_desktop_partial',
  failed: 'wallpaper_desktop_apply_failed',
  'file-error': 'wallpaper_desktop_file_error',
  unconfirmed: 'wallpaper_desktop_unconfirmed',
  'save-unconfirmed': 'wallpaper_save_unconfirmed',
  denied: 'wallpaper_desktop_setup_required',
  unavailable: 'wallpaper_desktop_setup_required',
  incompatible: 'wallpaper_desktop_setup_required'
};

export function captureVisibleFinal(visible, uhdSetting, offline) {
  if (!visible || offline) return null;
  const resolution = isUhdEnabled(uhdSetting) ? 'ultraHighDef' : 'highDef';
  if (visible.url !== buildCanonicalUrls(visible.imageId)[resolution]) return null;
  return Object.freeze({ date: visible.date, imageId: visible.imageId, resolution, blob: visible.blob });
}

export function mountWallpaperActions({ document, window, chrome, readSetting, readVisibleFinal,
  subscribeVisibleFinal, desktopAvailability = { read: () => 'unavailable' } }) {
  const group = document.getElementById('wallpaper-actions');
  const download = document.getElementById('download-image-btn');
  const desktop = document.getElementById('desktop-wallpaper-btn');
  const status = document.getElementById('wallpaper-actions-status');
  const dialog = document.getElementById('wallpaper-download-permission-dialog');
  const proceed = document.getElementById('wallpaper-download-permission-continue');
  const cancel = document.getElementById('wallpaper-download-permission-cancel');
  const desktopConfirmation = document.getElementById('wallpaper-desktop-confirmation-dialog');
  const confirmDesktop = document.getElementById('wallpaper-desktop-confirmation-confirm');
  const cancelDesktop = document.getElementById('wallpaper-desktop-confirmation-cancel');
  let permissionGranted = false;
  let permissionRevision = 0;
  let pending = null;
  let saveState = 'idle';
  let desktopState = 'idle';
  let statusMessage = '';
  let desktopMessage = '';
  const feedback = createTransientFeedback(window, text => {
    statusMessage = text;
    render();
  });
  const desktopFeedback = createTransientFeedback(window, text => {
    desktopMessage = text;
    render();
  });
  const cleanup = [feedback.dispose, desktopFeedback.dispose];
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
    if (desktopMessage) desktopFeedback.show();
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
    desktop.disabled = desktopOff || !desktopAvailability.apply || !ready || busy || desktopState === 'applying';
    group.dataset.desktopState = desktopState;
    const progress = desktopState === 'applying' ? 'wallpaper_desktop_applying'
      : desktopState === 'saving' ? 'wallpaper_desktop_saving' : '';
    const desktopText = desktopMessage || (progress && chrome.i18n.getMessage(progress));
    const actionText = [desktopText, statusMessage].filter(Boolean).join(' ');
    if (actionText) group.dataset.feedback = 'true';
    else delete group.dataset.feedback;
    const message = actionText || (!ready && !busy
      ? chrome.i18n.getMessage(group.dataset.sourceState === 'offline' ? 'wallpaper_actions_offline' : 'wallpaper_actions_loading')
      : '');
    if (status.textContent !== message) status.textContent = message;
  }

  async function save(operation) {
    if (operation.desktop) desktopState = 'saving';
    setStatus('saving');
    const outcome = await saveCapturedImage(operation.capture, operation.folder, {
      downloads: chrome.downloads, permissions: chrome.permissions
    }).catch(error => ({ kind: 'failed', reason: error.message }));
    if (outcome.kind === 'complete') {
      if (operation.desktop) desktopState = 'applying';
      setStatus('complete');
      window.dispatchEvent(new window.CustomEvent('funbingbing:wallpapersaved', { detail: outcome.save }));
      if (operation.desktop) {
        let result;
        try { result = await desktopAvailability.apply(outcome.save, outcome.url); }
        catch { result = 'unconfirmed'; }
        desktopState = Object.hasOwn(DESKTOP_RESULT_MESSAGES, result) ? result : 'unconfirmed';
        desktopFeedback.show(chrome.i18n.getMessage(DESKTOP_RESULT_MESSAGES[desktopState]));
      }
    } else {
      if (operation.desktop) desktopState = outcome.kind;
      const text = outcome.kind === 'cancelled' ? (operation.desktop ? chrome.i18n.getMessage('wallpaper_desktop_save_cancelled') : '')
        : chrome.i18n.getMessage(outcome.kind === 'unconfirmed' ? 'wallpaper_save_unconfirmed' : 'wallpaper_save_failed');
      setStatus(outcome.kind, operation.desktop ? '' : text);
      if (operation.desktop) desktopFeedback.show(text);
    }
  }
  function requestSave(operation) {
    if (permissionGranted) { void save(operation); return; }
    pending = operation;
    setStatus('permission-explanation');
    dialog.showModal();
  }
  function start(desktopAction) {
    if (pending || ['requesting-permission', 'saving'].includes(saveState)) return;
    const source = capture();
    if (!source) return;
    const operation = Object.freeze({ capture: source, folder: readSetting('wallpaper_download_folder') ?? '', desktop: desktopAction });
    if (desktopAction) {
      dismissFeedback();
      pending = operation;
      desktopConfirmation.showModal();
    } else {
      requestSave(operation);
    }
  }
  listen(group, 'pointermove', event => {
    if (event.pointerType !== 'touch') dismissFeedback();
  });
  listen(group, 'focusin', dismissFeedback);
  listen(download, 'click', () => { if (!download.disabled) start(false); });
  listen(desktop, 'click', () => { if (!desktop.disabled) start(true); });
  listen(confirmDesktop, 'click', () => {
    if (!desktopConfirmation.open || !pending) return;
    const operation = pending;
    pending = null;
    desktopConfirmation.close();
    const current = capture();
    const source = operation.capture;
    if (!desktop.disabled && current && current.blob === source.blob && current.date === source.date &&
        current.imageId === source.imageId && current.resolution === source.resolution) requestSave(operation);
  });
  listen(cancelDesktop, 'click', () => {
    pending = null;
    desktopConfirmation.close();
  });
  listen(desktopConfirmation, 'cancel', () => { pending = null; });
  listen(proceed, 'click', () => {
    if (!dialog.open || !pending) return;
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
