// Shared with boot.js and wallpaper.js in the page's classic-script scope.
const DISPLAY_STATE_KEY = 'wallpaper_display_state_v2';

// This phase owns only the first preview. boot.js closes it before the app starts.
const finishEarlyWallpaperPreview = (() => {
  let active = true;
  let painted = false;
  let observer;

  chrome.storage.local.get(DISPLAY_STATE_KEY).then((items) => {
    if (!active) return;
    const preloadDataUrl = items?.[DISPLAY_STATE_KEY]?.preloadDataUrl;
    if (typeof preloadDataUrl !== 'string' || !preloadDataUrl.startsWith('data:image/')) return;

    // Prepare the image while parsing continues; painting never waits for decode.
    const image = new Image();
    image.src = preloadDataUrl;
    if (typeof image.decode === 'function') image.decode().catch(() => {});

    const paint = () => {
      if (!active) return;
      const body = document.getElementById('main-body');
      if (!body) return;
      body.style.backgroundImage = `url('${preloadDataUrl}')`;
      body.style.backgroundColor = '';
      painted = true;
      active = false;
      observer?.disconnect();
    };
    paint();
    if (active) {
      observer = new MutationObserver(paint);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }).catch((err) => {
    console.warn('Unable to read early wallpaper preview:', err);
  });

  return () => {
    active = false;
    observer?.disconnect();
    return painted;
  };
})();
