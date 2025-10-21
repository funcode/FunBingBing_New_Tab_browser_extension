function checkOnlineStatus() {
  return navigator.onLine;
}

function loadPage(page) {
  const content = document.getElementById('content');
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL(page);
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

// Initial navigation
navigate();
