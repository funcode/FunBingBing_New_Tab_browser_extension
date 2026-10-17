
// javascript code for option operations in OPTIONS page

// Some default settings.
const defaultSearchEngines = (window.DEFAULT_SEARCH_ENGINES || []).map(engine => ({ ...engine }));

// search engine settings

function initSearchEngineConf() {
	// show search box
	if(readConf('display_search_box') == 'no') {
		document.getElementById('show-search-engine-checkbox').checked = false;
	}
	else {
		document.getElementById('show-search-engine-checkbox').checked = true;
	}
	// search engine list
	document.getElementById('search-engine-textarea').value = JSON.stringify(readConf('search_engine_list'), null, 4);
}

function changeSearchEngineConf() {
	// update search box conf
	if (document.getElementById('show-search-engine-checkbox').checked == true) {
		writeConf('display_search_box', 'yes');
	}
	else {
		writeConf('display_search_box', 'no');
	}

	// update engine list conf
	var newConf = document.getElementById('search-engine-textarea').value;
	// check validaty 
	var obj = null;
	try {
		obj = JSON.parse(newConf);
		writeConf('search_engine_list', obj);
		alert(i18n('op_saved_alert'));
	} 
	catch (e) {
		alert(i18n('op_bad_json_alert') +'\n' + e);
	}
}

function recoverDefaultSearchEngineConf() {
	var cfm = confirm(i18n('op_reset_default_confirm_alert'));
	if (cfm == true) {
		// default show search box conf
		writeConf('display_search_box', 'yes');
		document.getElementById('show-search-engine-checkbox').checked = true;
		// default search engine list conf
		writeConf('search_engine_list', defaultSearchEngines);
		document.getElementById('search-engine-textarea').value = JSON.stringify(defaultSearchEngines, null, 4);
		alert(i18n('op_reset_default_done_alert'));
	}
}


// quick link settings

// top sites

function refreshTopSitesButtons() {
	var close_btn = document.getElementById('close-top-sites-btn');
	var open_btn = document.getElementById('open-top-sites-btn');

	TopSites.hasPermission(function (hasPermission) {
		if (hasPermission) {
			if (TopSites.isEnabled()) {
				open_btn.style.display = 'none';
				close_btn.style.display = 'inline-block';
			} else {
				open_btn.style.display = 'inline-block';
				close_btn.style.display = 'none';
			}
		} else {
			// Shown as closed on this device; the shared preference is kept.
			open_btn.style.display = 'inline-block';
			close_btn.style.display = 'none';
		}
	});
}

function initTopSitesBtn() {
	refreshTopSitesButtons();
}

function openTopSites() {
	TopSites.hasPermission(function (hasPermission) {
		if (hasPermission) {
			TopSites.setEnabled(true);
			refreshTopSitesButtons();
			return;
		}

		var cfm = confirm(i18n('op_top_site_require_perm'));
		if (cfm == true) {
			TopSites.requestPermission(function (granted) {
				if (granted) {
					TopSites.setEnabled(true);
					refreshTopSitesButtons();
				} else {
					alert(i18n('op_top_site_perm_fail'));
				}
			});
		}
	});
}

function closeTopSites() {
	TopSites.removePermission(function (removed) {
		if (removed) {
			refreshTopSitesButtons();
		}
	});
}


// wallpaper settings


function initWallpaperConf() {
	// show search box
	if(readConf('enable_uhd_wallpaper') == 'no') {
		document.getElementById('use-uhd-wallpaper-checkbox').checked = false;
	}
	else {
		document.getElementById('use-uhd-wallpaper-checkbox').checked = true;
	}
	// show clock
	if(readConf('show_clock') == 'no') {
		document.getElementById('show-clock-checkbox').checked = false;
		chrome.runtime.sendMessage({ type: 'clockVisibilityChange', visible: false }).catch(err => { /* ignore */ });
	}
	else {
		document.getElementById('show-clock-checkbox').checked = true;
		chrome.runtime.sendMessage({ type: 'clockVisibilityChange', visible: true }).catch(err => { /* ignore */ });
	}
	// show quote of the day
	if(readConf('show_quote') == 'no') {
		document.getElementById('show-quote-checkbox').checked = false;
	}
	else {
		document.getElementById('show-quote-checkbox').checked = true;
	}
}

// The worker retains the new resolution only once sync holds it, so the
// displayed date's final image is requested after the write settles.
async function requestDisplayedFinalImage(uhdWritten, enableUhd) {
	await uhdWritten;
	const displayState = await readStorageKey('wallpaper_display_state_v2');
	if (!displayState?.date) {
		return;
	}
	const resolution = enableUhd === 'yes' ? 'ultraHighDef' : 'highDef';
	await chrome.runtime.sendMessage({ type: 'ensureWallpaperCached', date: displayState.date, resolution });
}

async function changeWallpaperConf() {
	// update uhd wallpaper conf
	const previousUhd = readConf('enable_uhd_wallpaper');
	const enableUhd = document.getElementById('use-uhd-wallpaper-checkbox').checked == true ? 'yes' : 'no';
	const uhdWritten = writeConf('enable_uhd_wallpaper', enableUhd);
	// update show clock conf
	if (document.getElementById('show-clock-checkbox').checked == true) {
		writeConf('show_clock', 'yes');
		chrome.runtime.sendMessage({ type: 'clockVisibilityChange', visible: true }).catch(err => { /* ignore */ });
	}
	else {
		writeConf('show_clock', 'no');
		chrome.runtime.sendMessage({ type: 'clockVisibilityChange', visible: false }).catch(err => { /* ignore */ });
	}
	// update show quote of the day conf
	if (document.getElementById('show-quote-checkbox').checked == true) {
		writeConf('show_quote', 'yes');
	}
	else {
		writeConf('show_quote', 'no');
	}
	alert(i18n('op_saved_alert'));
	if (enableUhd !== previousUhd) {
		await requestDisplayedFinalImage(uhdWritten, enableUhd).catch(err => {
			console.warn('Requesting the displayed wallpaper in the new resolution failed:', err);
		});
	}
}


// ------------- exec --------------


// read search engine conf
initSearchEngineConf();

// bind save search engine conf
document.getElementById('save-search-engine-conf').onclick = changeSearchEngineConf;
document.getElementById('recover-search-engine-conf').onclick = recoverDefaultSearchEngineConf;

// init top sites
initTopSitesBtn();

// bind open / close top sites btn
document.getElementById('open-top-sites-btn').onclick = openTopSites;
document.getElementById('close-top-sites-btn').onclick = closeTopSites;


// init wallpaper
initWallpaperConf();

// bind save wallpaper conf btn
document.getElementById('save-wallpaper-conf-btn').onclick = changeWallpaperConf;

// generate url of check update
document.getElementById('check-update-btn').href = 'https://idealland.app/ataraxia/update.html?platform=' + CURRENT_BROWSER + '&current=' + CURRENT_VERSION + '&locale=' + CURRENT_LOCALE;
document.getElementById('version-code-span').innerHTML = CURRENT_VERSION;


