

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
		chrome.permissions.contains({permissions:['topSites']}, function(result) {
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
			
			// Handle custom actions
			if (bookmarks[i].action) {
				a.href = '#';
				a.addEventListener('click', (function(action) {
					return function(e) {
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
}

// Handle custom actions for bookmarks
function handleCustomAction(action) {
	switch(action) {
		case 'random_bing_wallpaper':
			var today = new Date();
			var yearMin = 2010;
			var yearMax = today.getFullYear() - 1;
			var randomYear = Math.floor(Math.random() * (yearMax - yearMin + 1)) + yearMin;
			var mm = String(today.getMonth() + 1).padStart(2, '0');
			var dd = String(today.getDate()).padStart(2, '0');
			var url = `https://bing.ee123.net/detail/${randomYear}${mm}${dd}`;
			window.location.href = url;
			break;
		default:
			console.warn('Unknown custom action:', action);
			break;
	}
}


// --------------------------------------------------

initTopSites();

initCustomBookmarks();



