const NETWORK_TEST_URL = 'https://www.bing.com/favicon.ico';
const connectionCheckInterval = 15000;
const MAX_FETCH_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

console.log('Current online status:', navigator.onLine);

let currentView = null;
let connectionCheckPromise = null;

async function loadView(view) {
  const previousMainBody = document.getElementById('main-body');
  if (previousMainBody) {
    if (typeof window !== 'undefined' && typeof window.revokeCurrentWallpaperObjectUrl === 'function') {
      try {
        window.revokeCurrentWallpaperObjectUrl();
      } catch (err) {
        console.warn('Failed to revoke wallpaper object URL:', err);
      }
    }
    // Make sure the wallpaper blob is released and the visual background is cleared.
    // Use explicit assignments instead of removeProperty because some browsers
    // may keep computed/background sizing when only the image is removed which
    // can lead to unexpected sizing. Setting to 'none' and clearing related
    // properties ensures a clean reset.
    previousMainBody.style.backgroundImage = 'none';
    previousMainBody.style.backgroundSize = '';
    previousMainBody.style.backgroundRepeat = '';
    previousMainBody.style.backgroundPosition = '';
    previousMainBody.style.backgroundAttachment = '';
  }

  const res = await fetch(chrome.runtime.getURL(`${view}.html`));
  const html = await res.text();
  const app = document.getElementById('content');
  app.innerHTML = html;

  currentView = view;

  loadScript(`scripts/${view}.js`, view);
}

function loadScript(path, key) {
  document
    .querySelectorAll(`script[data-view="${key}"]`)
    .forEach((existing) => existing.remove());

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(path);
  script.type = 'module';
  script.dataset.view = key;
  document.body.appendChild(script);
}

function showView(view = 'offline') {
  if (currentView === view) {
    return;
  }

  if (view === 'offline') {
    localStorage.removeItem('wallpaper_date');
  }

  loadView(view).catch((err) => {
    console.error(`Failed to load view "${view}":`, err);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performActualConnectionCheck() {
  const totalAttempts = MAX_FETCH_RETRIES + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const attemptNumber = attempt + 1;
    const isLastAttempt = attempt === MAX_FETCH_RETRIES;

    try {
      const response = await fetch(NETWORK_TEST_URL, {
        method: 'HEAD',
        cache: 'no-store',
      });

      if (response.ok) {
        console.log(
          `Actual network test: Connected (attempt ${attemptNumber}/${totalAttempts})`
        );
        showView('newtab');
        return true;
      }

      console.log(
        `Actual network test: Disconnected (bad status) (attempt ${attemptNumber}/${totalAttempts})`
      );
    } catch (error) {
      console.log(
        `Actual network test: Disconnected (error) (attempt ${attemptNumber}/${totalAttempts})`,
        error
      );
    }

    if (!isLastAttempt) {
      await delay(RETRY_DELAY_MS);
    }
  }

  console.log('Actual network test: Disconnected after retries. Redirecting.');
  showView('offline');
  return false;
}

async function checkActualConnection() {
  if (!connectionCheckPromise) {
    connectionCheckPromise = (async () => {
      try {
        return await performActualConnectionCheck();
      } finally {
        connectionCheckPromise = null;
      }
    })();
  }
  return connectionCheckPromise;
}

function handleOffline() {
  showView('offline');
}

function handleOnline() {
  checkActualConnection().catch((err) => {
    console.error('Online connectivity check failed:', err);
    showView('offline');
  });
}

if (!navigator.onLine) {
  showView('offline');
} else {
  checkActualConnection().catch((err) => {
    console.error('Initial connectivity check failed:', err);
    showView('offline');
  });
}

window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);

setInterval(() => {
  if (navigator.onLine) {
    checkActualConnection().catch((err) => {
      console.error('Periodic connectivity check failed:', err);
    });
  }
}, connectionCheckInterval);


