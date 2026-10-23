// Paint the committed display snapshot's preview before wallpaper.js loads.
// The snapshot is trusted as an atomic unit; its identity is never inferred
// from the data URL bytes.
function paintCommittedPreview() {
  if (finishEarlyWallpaperPreview()) return;
  try {
    const body = document.getElementById('main-body');
    if (!body || typeof readConf !== 'function') return;
    const snapshot = readConf(DISPLAY_STATE_KEY);
    const preloadDataUrl = snapshot?.preloadDataUrl;
    if (typeof preloadDataUrl === 'string' && preloadDataUrl.startsWith('data:image/')) {
      body.style.backgroundImage = `url('${preloadDataUrl}')`;
      body.style.backgroundColor = '';
    }
  } catch (err) {
    console.warn('Unable to paint cached wallpaper preload:', err);
  }
}

function startApp() {
  (window.confReadyPromise || Promise.resolve())
    .then(() => {
    paintCommittedPreview();

    const scriptsToLoad = [
      "scripts/main/i18n.js",
      "scripts/main/top_sites.js",
      "scripts/main/search.js",
      "scripts/main/wallpaper.js",
      "scripts/main/options.js",
      "scripts/main/quick_links.js",
      "scripts/main/desc_hover.js",
      "scripts/main/trivia_hover.js",
      "scripts/main/clock.js",
      "scripts/main/quote.js"
    ];

    const parent = document.body || document.head;

    const loadScriptSequentially = (srcs) => srcs.reduce((promise, src) => {
      return promise.then(() => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => {
          console.error('Failed to load script:', src);
          reject(new Error('Failed to load ' + src));
        };
        parent.appendChild(script);
      }));
    }, Promise.resolve());

      return loadScriptSequentially(scriptsToLoad);
    })
    .catch((err) => {
      console.error('Error loading dependent scripts after configuration ready:', err);
    });
}

// Started whatever the network status: cached wallpaper is displayed offline too.
startApp();
