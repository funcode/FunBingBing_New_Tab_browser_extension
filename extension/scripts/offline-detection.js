// Configurable endpoint for actual network test
const NETWORK_TEST_URL = 'https://www.bing.com/favicon.ico';
const connectionCheckInterval = 15000; // 15 seconds
const MAX_FETCH_RETRIES = 2; // retry twice on failure -> total 3 attempts
const RETRY_DELAY_MS = 1000;
const NETWORK_STATUS_EVENT = 'funbingbing:networkstatuschange';

let networkStatus = navigator.onLine ? 'online' : 'offline';
let connectionCheckPromise = null;

document.documentElement.dataset.networkStatus = networkStatus;

console.log('Current online status:', navigator.onLine);

function setNetworkStatus(nextStatus) {
  if (networkStatus === nextStatus) return;

  const previousStatus = networkStatus;
  networkStatus = nextStatus;
  document.documentElement.dataset.networkStatus = nextStatus;

  if (nextStatus === 'offline') {
    chrome.storage.local.set({ 'wallpaper_date': '20000101' });
  }

  window.dispatchEvent(new CustomEvent(NETWORK_STATUS_EVENT, {
    detail: { status: nextStatus, previousStatus }
  }));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check actual network connection by fetching a real resource
async function runActualConnectionCheck() {
  const totalAttempts = MAX_FETCH_RETRIES + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const attemptNumber = attempt + 1;
    const isLastAttempt = attempt === MAX_FETCH_RETRIES;

    try {
      const response = await fetch(NETWORK_TEST_URL, {
        method: 'HEAD',
        cache: 'no-store'
      });

      if (response.ok) {
        console.log(`Actual network test: Connected (attempt ${attemptNumber}/${totalAttempts})`);
        setNetworkStatus('online');
        return true;
      }

      console.log(`Actual network test: Disconnected (bad status) (attempt ${attemptNumber}/${totalAttempts})`);
    } catch (error) {
      console.log(`Actual network test: Disconnected (error) (attempt ${attemptNumber}/${totalAttempts})`, error);
    }

    if (!isLastAttempt) {
      await delay(RETRY_DELAY_MS);
    }
  }

  console.log('Actual network test: Disconnected after retries.');
  setNetworkStatus('offline');
  return false;
}

function checkActualConnection() {
  if (!connectionCheckPromise) {
    connectionCheckPromise = runActualConnectionCheck()
      .finally(() => {
        connectionCheckPromise = null;
      });
  }
  return connectionCheckPromise;
}

window.addEventListener('online', function() {
  setNetworkStatus('online');
  checkActualConnection();
  console.log('Network status changed to: online');
});

window.addEventListener('offline', function() {
  setNetworkStatus('offline');
  console.log('Network status changed to: offline');
});

// Periodically check the actual connection status
setInterval(checkActualConnection, connectionCheckInterval);

if (!navigator.onLine) {
  chrome.storage.local.set({ 'wallpaper_date': '20000101' });
} else {
  checkActualConnection();
}
