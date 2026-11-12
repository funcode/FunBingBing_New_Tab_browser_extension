const wallpaperActionsReady = import(chrome.runtime.getURL('src/page/wallpaper-actions.js'))
	.then(({ mountWallpaperActions }) => mountWallpaperActions({
		document, window, chrome, readSetting: readConf,
		readVisibleFinal: () => visibleWallpaperFinal,
		subscribeVisibleFinal(listener) {
			visibleWallpaperListeners.add(listener);
			return () => visibleWallpaperListeners.delete(listener);
		},
		desktopAvailability: {
			read: () => readConf('desktop_wallpaper_available') === true ? 'available' : 'unavailable',
			subscribe(listener) {
				const changed = (changes, area) => {
					if (area === 'local' && 'desktop_wallpaper_available' in changes) listener();
				};
				chrome.storage.onChanged.addListener(changed);
				return () => chrome.storage.onChanged.removeListener(changed);
			}
		}
	})).catch(error => console.warn('Wallpaper actions unavailable:', error));
