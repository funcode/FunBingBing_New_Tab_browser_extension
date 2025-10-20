(window.confReadyPromise || Promise.resolve())
  .then(() => {
    const scriptsToLoad = [
      "scripts/main/top_sites.js",
      "scripts/option_page/main.js",
      "scripts/option_page/i18n.js"
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
    console.error('Error loading option page scripts after configuration ready:', err);
  });
