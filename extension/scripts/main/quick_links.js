

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

			// Add SVG icon at the beginning
			var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			svg.setAttribute("viewBox", "0 0 3.04 3.04");
			svg.setAttribute("class", "icon");
			svg.innerHTML = '<path fill="#ffffff" d="M16.417 9.5a7.919 7.919 0 0 1-15.212 3.082A7.87 7.87 0 0 1 .584 9.5a.554.554 0 0 1 1.109 0 6.81 6.81 0 0 0 13.081 2.65 6.811 6.811 0 0 0-9.66-8.557 6.859 6.859 0 0 0-1.847 1.554h1.276a.554.554 0 0 1 0 1.108h-2.61a.554.554 0 0 1-.555-.554V3.09a.554.554 0 0 1 1.109 0v1.262A7.898 7.898 0 0 1 8.5 1.583 7.911 7.911 0 0 1 16.417 9.5zm-5.181 3a.554.554 0 0 1-.784 0l-2.42-2.42a.552.552 0 0 1-.22-.441V5.168a.554.554 0 1 1 1.11 0v4.234l2.314 2.315a.554.554 0 0 1 0 .784z"/>';
			a.appendChild(svg);

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



