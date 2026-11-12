const wallpaperActionSettingsReady = import(chrome.runtime.getURL('src/page/wallpaper-action-settings.js'))
	.then(({ mountWallpaperActionSettings }) => mountWallpaperActionSettings({
		document, window, chrome, readSetting: readConf, writeSetting: writeConf
	})).catch(error => console.warn('Wallpaper action settings unavailable:', error));
