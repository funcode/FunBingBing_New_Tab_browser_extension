const wallpaperActionsReady = Promise.all([
	import(chrome.runtime.getURL('src/page/wallpaper-actions.js')),
	import(chrome.runtime.getURL('src/page/desktop-wallpaper-availability.js'))
]).then(([{ mountWallpaperActions }, { desktopWallpaperAvailability }]) => mountWallpaperActions({
		document, window, chrome, readSetting: readConf,
		readVisibleFinal: () => visibleWallpaperFinal,
		subscribeVisibleFinal(listener) {
			visibleWallpaperListeners.add(listener);
			return () => visibleWallpaperListeners.delete(listener);
		},
		desktopAvailability: desktopWallpaperAvailability(chrome)
	})).catch(error => console.warn('Wallpaper actions unavailable:', error));
