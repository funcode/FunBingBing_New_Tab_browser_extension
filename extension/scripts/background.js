// functions executed onInstall and onUninstall

// on install
chrome.runtime.onInstalled.addListener(function (object) {
	// open manual link
	if (chrome.runtime.OnInstalledReason.INSTALL === object.reason) {
		// open Welcome page
		chrome.tabs.create({
			url: chrome.runtime.getURL('options.html')
		}, function (tab) {
			console.log("Fun Bingbing newtab is installed.");
		});
		chrome.tabs.create({ url: "https://www.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN" }, (tab) => {
			// Close it after 3 seconds
			setTimeout(() => {
				chrome.tabs.remove(tab.id);
			}, 3000);
		});
		fetch('https://www.bing.com/favicon.ico', {
			method: "GET",
			cache: 'no-store'
		});
	}
});

// on uninstall

