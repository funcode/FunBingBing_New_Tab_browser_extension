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
    loadPage('blank.html');
  } else {
    loadPage('newtab.html');
  }
}

window.addEventListener('online', () => loadPage('blank.html'));
window.addEventListener('offline', () => loadPage('newtab.html'));

// Initial navigation
navigate();
