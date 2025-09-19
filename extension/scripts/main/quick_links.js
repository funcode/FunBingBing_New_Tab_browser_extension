function buildTopSitesList(mostVisitedURLs) {
	var popupDiv = document.getElementById('top-sites-div');
	var ul = popupDiv.appendChild(document.createElement('ul'));

	for (var i = 0; i < mostVisitedURLs.length; i++) {
		var li = ul.appendChild(document.createElement('li'));
		var a = li.appendChild(document.createElement('a'));
		a.href = mostVisitedURLs[i].url;
		a.title = mostVisitedURLs[i].url;
		a.appendChild(document.createTextNode(mostVisitedURLs[i].title));
	}
	popupDiv.appendChild(document.createElement('hr'));
}

// read top sites and show it in page
function showTopSites() {
	chrome.topSites.get(buildTopSitesList);
}

// init topSites 
function initTopSites() {
	// check switch
	if (readConf('show_top_sites') == 'yes') {
		// check permission
		chrome.permissions.contains({ permissions: ['topSites'] }, function (result) {
			if (result) {
				// if have permission
				showTopSites();
			} else {
				// if no permission
				writeConf('show_top_sites', 'no');
			}
		});
	}

}

// load custom bookmarks
function initCustomBookmarks() {
	var bookmarks = readConf('custom_bkmk_list');
	if (bookmarks != null && bookmarks.length > 0) {
		var popupDiv = document.getElementById('top-sites-div');
		var ul = popupDiv.appendChild(document.createElement('ul'));
		for (var i = 0; i < bookmarks.length; i++) {
			var li = ul.appendChild(document.createElement('li'));
			var a = li.appendChild(document.createElement('a'));

			// Add SVG icon at the beginning
			var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			svg.setAttribute("viewBox", "0 0 0.32 0.32");
			svg.setAttribute("style", "margin-right: 6px; vertical-align: -2px;");
			svg.innerHTML = '<path fill="#fff" d="M0.214 0.009a0.16 0.16 0 1 1 -0.199 0.219 0.02 0.02 0 1 1 0.036 -0.017 0.12 0.12 0 1 0 0.028 -0.14l0.015 0.015A0.02 0.02 0 0 1 0.08 0.12H0V0.04A0.02 0.02 0 0 1 0.034 0.026l0.017 0.017a0.16 0.16 0 0 1 0.163 -0.033M0.16 0.08a0.02 0.02 0 0 1 0.02 0.02v0.052l0.034 0.034a0.02 0.02 0 0 1 -0.028 0.028L0.14 0.168V0.1A0.02 0.02 0 0 1 0.16 0.08"/>';
			a.appendChild(svg);

			// Handle custom actions
			if (bookmarks[i].action) {
				a.href = '#';
				a.addEventListener('click', (function (action) {
					return function (e) {
						e.preventDefault();
						handleCustomAction(action);
					};
				})(bookmarks[i].action));
				a.title = 'Custom Action: ' + bookmarks[i].name;
			} else if (bookmarks[i].url) {
				a.href = bookmarks[i].url;
				a.title = bookmarks[i].url;
			} else {
				// Fallback for invalid bookmark entries
				a.href = '#';
				a.title = 'Invalid bookmark';
			}

			a.appendChild(document.createTextNode(bookmarks[i].name));
		}
		popupDiv.appendChild(document.createElement('hr'));
	}
	console.log('quick_links.js: initCustomBookmarks done');
}

// Handle custom actions for bookmarks
function handleCustomAction(action) {
	switch (action) {
		case 'random_bing_wallpaper': {
			let wallpaper_idx = readConf("wallpaper_idx");
			if (wallpaper_idx === "") {
				wallpaper_idx = 0;
			}
			wallpaper_idx = parseInt(wallpaper_idx);

			const bing_images = readConf("bing_images");
			let today = new Date();

			if (bing_images) {
				const image = bing_images[wallpaper_idx];
				if (image) {
					today = new Date(
						+image.isoDate.slice(0, 4),
						+image.isoDate.slice(4, 6) - 1,
						+image.isoDate.slice(6, 8)
					);
				}
			}

			const yearMin = 2010;
			const yearMax = today.getFullYear() - 1;
			const randomYear = Math.floor(Math.random() * (yearMax - yearMin + 1)) + yearMin;

			const mm = String(today.getMonth() + 1).padStart(2, '0');
			const dd = String(today.getDate()).padStart(2, '0');

			const url = `https://bing.ee123.net/detail/${randomYear}${mm}${dd}`;
			window.open(url, '_blank');
			break;
		}
		case 'bing_on_this_day': {
			const today = new Date();
			const mm = String(today.getMonth() + 1).padStart(2, '0');
			const dd = String(today.getDate()).padStart(2, '0');
			const osKey = `OnThisDay${mm}${dd}`;
			const url = `https://cn.bing.com/search?q=on+this+day&filters=IsConversation%3A%22True%22+OsKey%3A%22${osKey}%22+Id%3A%223%22+dw_answerstobesuppressed%3A%22taskpanepromotionanswer%22+mgzv3configlist%3A%22BingQA_Trivia_Layout%22&FORM=BESBTB`;
			window.open(url, '_blank');
			break;
		}
		default:
			console.warn('Unknown custom action:', action);
			break;
	}
}


// --------------------------------------------------

initTopSites();

initCustomBookmarks();



