function checkOnlineStatus() {
  return navigator.onLine;
}

let cachedWallpaperDataUrl = null;

function applyWallpaperBackground(target, dataUrl) {
  if (!target) return;
  if (!dataUrl) {
    target.style.backgroundImage = '';
    return;
  }
  target.style.backgroundImage = `url('${dataUrl}')`;
  target.style.backgroundSize = 'cover';
  target.style.backgroundPosition = 'center';
  target.style.backgroundRepeat = 'no-repeat';
}

function applyCachedWallpaperShell() {
  applyWallpaperBackground(document.body, cachedWallpaperDataUrl);
  const content = document.getElementById('content');
  //applyWallpaperBackground(content, cachedWallpaperDataUrl);
}

function loadPage(page) {
  const content = document.getElementById('content');
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL(page);
  //applyWallpaperBackground(iframe, cachedWallpaperDataUrl);
  content.innerHTML = '';
  content.appendChild(iframe);
}

function navigate() {
  const online = checkOnlineStatus();
  if (online) {
    loadPage('newtab.html');
  } else {
    loadPage('offline.html');
  }
}

window.addEventListener('online', () => loadPage('newtab.html'));
window.addEventListener('offline', () => loadPage('offline.html'));

chrome.storage.local.get('wallpaper_preload_data_url', (result) => {
  if (chrome.runtime.lastError) {
    console.warn('Failed to load cached wallpaper preload:', chrome.runtime.lastError);
  } else {
    cachedWallpaperDataUrl = result.wallpaper_preload_data_url || null;
    applyCachedWallpaperShell();
  }
  navigate();
});

/* chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!Object.prototype.hasOwnProperty.call(changes, 'wallpaper_preload_data_url')) return;
  cachedWallpaperDataUrl = changes.wallpaper_preload_data_url.newValue || null;
  applyCachedWallpaperShell();
  const iframe = document.querySelector('#content iframe');
  if (iframe) {
    applyWallpaperBackground(iframe, cachedWallpaperDataUrl);
  }
}); */
