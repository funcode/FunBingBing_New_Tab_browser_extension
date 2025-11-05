// Configurable endpoint for actual network test
const NETWORK_TEST_URL = 'https://www.bing.com/favicon.ico';
const connectionCheckInterval = 15000; // 15 seconds
const MAX_FETCH_RETRIES = 2; // retry twice on failure -> total 3 attempts
const RETRY_DELAY_MS = 1500;

console.log('Current online status:', navigator.onLine);

/* window.addEventListener('online', function() {
    window.location.href = 'newtab.html';
    console.log('Network status changed to: online');
}); */

window.addEventListener('offline', function() {
  redirectToNewPageIfNeeded();
  console.log('Network status changed to: offline');
});

function redirectToNewPageIfNeeded(page) {
  if (!window.location.pathname.endsWith(page || 'offline.html')) {
    writeConf('wallpaper_date', '20000101');
    window.location.href = page || 'offline.html';
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check actual network connection by fetching a real resource
async function checkActualConnection() {
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
        redirectToNewPageIfNeeded('newtab.html');
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

  console.log('Actual network test: Disconnected after retries. Redirecting.');
  redirectToNewPageIfNeeded();
  return false;
}

// Periodically check the actual connection status
setInterval(checkActualConnection, connectionCheckInterval);

(async () => {
  if (!navigator.onLine) {
    redirectToNewPageIfNeeded();
  } else {
    await checkActualConnection();
  }
})();