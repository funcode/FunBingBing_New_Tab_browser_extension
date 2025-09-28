// Configurable endpoint for actual network test
const NETWORK_TEST_URL = 'https://cn.bing.com/favicon.ico';
const connectionCheckInterval = 30000; // 30 seconds

console.log('Current online status:', navigator.onLine);

window.addEventListener('online', function() {
    window.location.href = 'blank.html';
    console.log('Network status changed to: online');
});

window.addEventListener('offline', function() {
  redirectToNewPageIfNeeded();
  console.log('Network status changed to: offline');
});

function redirectToNewPageIfNeeded(page) {
  if (!window.location.pathname.endsWith(page || 'newtab.html')) {
    localStorage.removeItem('wallpaper_date');
    window.location.href = page || 'newtab.html';
  }
}

// Check actual network connection by fetching a real resource
async function checkActualConnection() {
  try {
    const response = await fetch(NETWORK_TEST_URL, {
      method: "HEAD",
      cache: 'no-store'
    });
    if (response.ok) {
      console.log('Actual network test: Connected');
      redirectToNewPageIfNeeded('blank.html');
      return true;
    } else {
      console.log('Actual network test: Disconnected (bad status)');
      redirectToNewPageIfNeeded();
      return false;
    }
  } catch (error) {
    console.log('Actual network test: Disconnected');
    redirectToNewPageIfNeeded();
    return false;
  }
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