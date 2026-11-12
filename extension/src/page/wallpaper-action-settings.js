import { parseWallpaperDownloadFolder } from '../helpers/wallpaper-download.js';
import { createTransientFeedback } from './transient-feedback.js';

export function mountWallpaperActionSettings({ document, window, chrome, readSetting, writeSetting, desktopAvailability }) {
  const download = document.getElementById('enable-image-download-checkbox');
  const desktop = document.getElementById('enable-desktop-wallpaper-checkbox');
  const folder = document.getElementById('wallpaper-download-folder');
  const error = document.getElementById('wallpaper-download-folder-error');
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
    const availability = desktopAvailability?.read() ?? (readSetting('desktop_wallpaper_available') === true ? 'available' : 'unavailable');
    desktop.checked = availability === 'available';
    // Enabling needs explicit verified setup (#156). A remembered availability
    // may be turned off, but cannot be fabricated by checking an ordinary box.
    desktop.disabled = availability === 'loading' || (!desktopAvailability?.setEnabled && !desktop.checked);
    folder.disabled = !download.checked && !desktop.checked;
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
  listen(desktop, 'change', async () => {
    if (desktopAvailability?.setEnabled) await desktopAvailability.setEnabled(desktop.checked);
    else if (!desktop.checked) await writeSetting('desktop_wallpaper_available', false);
    refreshSwitches();
  });
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
  const changed = (changes, area) => {
    if (area === 'local' && 'desktop_wallpaper_available' in changes) refreshSwitches();
  };
  chrome.storage.onChanged.addListener(changed);
  cleanup.push(() => chrome.storage.onChanged.removeListener(changed));
  cleanup.push(desktopAvailability?.subscribe?.(refreshSwitches));
  refreshSwitches();
  refreshFolder();
  return { dispose() { for (const remove of cleanup) remove?.(); } };
}
