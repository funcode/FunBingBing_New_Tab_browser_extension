(window.confReadyPromise || Promise.resolve())
  .then(() => {
    try {
      const body = document.getElementById('main-body');
      const preloadDataUrl = typeof readConf === 'function'
        ? readConf('wallpaper_preload_data_url')
        : null;
      if (body && preloadDataUrl) {
        body.style.backgroundImage = `url('${preloadDataUrl}')`;
        body.style.backgroundColor = '';
      }
    } catch (err) {
      console.warn('Unable to paint cached wallpaper preload:', err);
    }

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
