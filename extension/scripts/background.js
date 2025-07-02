// functions executed onInstall and onUninstall

// on install
chrome.runtime.onInstalled.addListener(function (object) {
	// open manual link
	if (chrome.runtime.OnInstalledReason.INSTALL === object.reason ) {
		// open Welcome page
		chrome.tabs.create({  
			url: chrome.runtime.getURL('options.html')  
		  }, function (tab) {
	        console.log("Fun Bingbing newtab is installed.");
		});

	}
});

// on uninstall

