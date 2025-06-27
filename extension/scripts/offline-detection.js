// Offline detection script
if (!navigator.onLine) {
  window.location.href = 'newtab.html';
}

window.addEventListener('offline', function() {
  window.location.href = 'newtab.html';
}); 