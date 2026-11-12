const wallpaperActionSettingsReady = Promise.all([
	import(chrome.runtime.getURL('src/page/wallpaper-action-settings.js')),
	import(chrome.runtime.getURL('src/page/desktop-wallpaper-availability.js'))
]).then(([{ mountWallpaperActionSettings }, { desktopWallpaperAvailability }]) => mountWallpaperActionSettings({
		document, window, chrome, readSetting: readConf, writeSetting: writeConf,
		desktopAvailability: desktopWallpaperAvailability(chrome)
	})).catch(error => console.warn('Wallpaper action settings unavailable:', error));
