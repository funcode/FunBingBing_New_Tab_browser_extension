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
	const historyLabel = i18n('quick_link_history_today');
	const bingLabel = i18n('quick_link_random_bing_wallpaper');

	var bookmarks = [
			{
				name: historyLabel,
				action: "bing_on_this_day",
				icon: '<path d="M15.999 7.985V8a7.999 7.999 0 0 1-13.034 6.216l.015.012a.775.775 0 0 1-.06-1.149l.363-.363a.776.776 0 0 1 1.031-.062l-.001-.001A5.9 5.9 0 0 0 8 13.936 5.935 5.935 0 1 0 3.932 3.679l.003-.003 1.637 1.637a.516.516 0 0 1-.365.881H.518a.516.516 0 0 1-.516-.516V.989A.516.516 0 0 1 .883.624l1.593 1.593A7.97 7.97 0 0 1 8.002.002a8 8 0 0 1 7.999 7.984v.001zm-5.835 2.541.317-.407a.773.773 0 0 0-.134-1.085l-.002-.001-1.313-1.021V4.647a.776.776 0 0 0-.775-.775h-.516a.776.776 0 0 0-.775.775V9.02l2.11 1.641a.774.774 0 0 0 1.086-.131z"/>'
			},
			{
				name: bingLabel,
				action: "random_bing_wallpaper",
				icon: '<path d="M2.403 0 5.6 1.124v11.249l4.502-2.597-2.207-1.037-1.393-3.467 7.093 2.492v3.623L5.602 16l-3.198-1.78V0z"/>'
			}
		];
	if (bookmarks != null && bookmarks.length > 0) {
		var popupDiv = document.getElementById('top-sites-div');
		var ul = popupDiv.appendChild(document.createElement('ul'));
		for (var i = 0; i < bookmarks.length; i++) {
			var li = ul.appendChild(document.createElement('li'));
			var a = li.appendChild(document.createElement('a'));

			// Add SVG icon at the beginning
			var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("class", "icon-inline");
			svg.setAttribute("viewBox", "0 0 16 16");
			svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
			svg.innerHTML = bookmarks[i].icon;
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
				a.title = bookmarks[i].name;
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
	let wallpaper_idx = readConf("wallpaper_idx");
	if (wallpaper_idx === "") {
		wallpaper_idx = 0;
	}
	wallpaper_idx = parseInt(wallpaper_idx);

	const bing_images = readConf("bing_images");
	let isoDate="";

	const image = bing_images && bing_images[wallpaper_idx];
	isoDate = image?.isoDate || isoDate;
	if (!isoDate) {
		//format a Date object as YYYYMMDD
		isoDate = (new Date()).toISOString().slice(0,10).replace(/-/g,'');
	}

	const yearMin = 2010;
	const yearMax = isoDate.slice(0, 4) - 1;
	const randomYear = Math.floor(Math.random() * (yearMax - yearMin + 1)) + yearMin;

	const mm = isoDate.slice(4, 6);
	const dd = isoDate.slice(6, 8);

	switch (action) {
		case 'random_bing_wallpaper': {
			const url = `https://bing.ee123.net/detail/${randomYear}${mm}${dd}`;
			window.open(url, '_blank');
			break;
		}
		case 'bing_on_this_day': {
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



