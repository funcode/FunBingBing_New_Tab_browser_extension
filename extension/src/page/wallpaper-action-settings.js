import { parseWallpaperDownloadFolder } from '../helpers/wallpaper-download.js';
import { createTransientFeedback } from './transient-feedback.js';

const STATUS_MESSAGES = {
  checking: 'op_wallpaper_desktop_checking',
  denied: 'op_wallpaper_desktop_permission_required',
  unavailable: 'op_wallpaper_desktop_unavailable',
  incompatible: 'op_wallpaper_desktop_incompatible',
  timeout: 'op_wallpaper_desktop_timeout',
  failed: 'op_wallpaper_desktop_check_failed'
};

export function mountWallpaperActionSettings({ document, window, chrome, readSetting, writeSetting, desktopAvailability }) {
  const download = document.getElementById('enable-image-download-checkbox');
  const desktop = document.getElementById('enable-desktop-wallpaper-checkbox');
  const status = document.getElementById('desktop-wallpaper-setup-status');
  const checkAgain = document.getElementById('desktop-wallpaper-check-again');
  const cancelCheck = document.getElementById('desktop-wallpaper-cancel-check');
  const folder = document.getElementById('wallpaper-download-folder');
  const error = document.getElementById('wallpaper-download-folder-error');
  let checkStatus = 'idle';
  let statusRevision = 0;
  let intentRevision = 0;
  const feedback = createTransientFeedback(window, text => {
    if (error.textContent !== text) error.textContent = text;
  });
  const cleanup = [feedback.dispose];
  function listen(target, type, listener) {
    target.addEventListener(type, listener);
    cleanup.push(() => target.removeEventListener(type, listener));
  }
  function refreshSwitches() {
    download.checked = readSetting('enable_image_download') !== 'no';
    const availability = desktopAvailability.read();
    const checking = checkStatus === 'checking';
    desktop.checked = availability === 'available';
    desktop.disabled = availability === 'loading' || (checking && !desktop.checked);
    checkAgain.disabled = availability === 'loading' || checking;
    cancelCheck.hidden = !checking || desktop.checked;
    folder.disabled = !download.checked && !desktop.checked;
    const message = chrome.i18n.getMessage(STATUS_MESSAGES[checkStatus] ??
      (desktop.checked ? 'op_wallpaper_desktop_verified' : 'op_wallpaper_desktop_unavailable'));
    if (status.textContent !== message) status.textContent = message;
  }
  function showCheckStatus(nextStatus) {
    statusRevision++;
    checkStatus = nextStatus;
    status.dataset.state = nextStatus;
    refreshSwitches();
  }
  function sendIntent(type) {
    const revision = statusRevision;
    const intent = ++intentRevision;
    const failed = () => {
      if (intent === intentRevision && (revision === statusRevision || checkStatus === 'checking')) {
        showCheckStatus('failed');
      }
    };
    chrome.runtime.sendMessage({ type }).then(ok => {
      if (ok !== true) failed();
    }, failed);
  }
  function clearFolderError() {
    feedback.show();
    folder.setAttribute('aria-invalid', 'false');
  }
  function refreshFolder() {
    folder.value = readSetting('wallpaper_download_folder') ?? '';
    clearFolderError();
  }
  listen(download, 'change', () => {
    void writeSetting('enable_image_download', download.checked ? 'yes' : 'no');
    refreshSwitches();
  });
  listen(desktop, 'change', () => {
    sendIntent(desktop.checked ? 'checkDesktopWallpaper' : 'disableDesktopWallpaper');
    desktop.checked = desktopAvailability.read() === 'available';
  });
  listen(checkAgain, 'click', () => sendIntent('checkDesktopWallpaper'));
  listen(cancelCheck, 'click', () => sendIntent('disableDesktopWallpaper'));
  listen(folder, 'mouseenter', () => feedback.show());
  listen(folder, 'focus', () => feedback.show());
  listen(folder, 'input', clearFolderError);
  listen(folder, 'change', () => {
    const parsed = parseWallpaperDownloadFolder(folder.value);
    if (parsed === null) {
      folder.setAttribute('aria-invalid', 'true');
      feedback.show(chrome.i18n.getMessage('op_wallpaper_download_folder_invalid'));
      return;
    }
    clearFolderError();
    folder.value = parsed;
    void writeSetting('wallpaper_download_folder', parsed);
  });
  listen(window, 'funbingbing:settingschange', event => {
    refreshSwitches();
    if (event.detail.keys.includes('wallpaper_download_folder')) refreshFolder();
  });
  const changed = message => {
    if (message?.type === 'desktopWallpaperStatusChanged') showCheckStatus(message.status);
  };
  chrome.runtime.onMessage.addListener(changed);
  cleanup.push(() => chrome.runtime.onMessage.removeListener(changed));
  cleanup.push(desktopAvailability.subscribe(refreshSwitches));
  chrome.runtime.sendMessage({ type: 'desktopWallpaperStatus' }).then(initialStatus => {
    if (statusRevision === 0) showCheckStatus(initialStatus);
  }).catch(() => {});
  refreshSwitches();
  refreshFolder();
  return { dispose() { for (const remove of cleanup) remove?.(); } };
}
