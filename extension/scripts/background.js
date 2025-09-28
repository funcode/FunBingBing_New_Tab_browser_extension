
// on install
chrome.runtime.onInstalled.addListener(function (object) {
	// open manual link
	if (chrome.runtime.OnInstalledReason.INSTALL === object.reason) {
		chrome.tabs.create({ url: "https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN" }, (tab) => {
			// Close it after 3 seconds
			setTimeout(() => {
				chrome.tabs.remove(tab.id);
			}, 3000);
		});
		fetch('https://www.bing.com/favicon.ico', {
			method: "GET",
			cache: 'no-store'
		});
		// open Welcome page
		chrome.tabs.create({
			url: chrome.runtime.getURL('options.html')
		}, function (tab) {
			console.log("Fun Bingbing newtab is installed.");
		});
	}
});

/* chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === "getQuote") {
    let quote = {};
    try {
      const s3Resp = await fetch("https://xxx.s3.ap-east-1.amazonaws.com/latest.json");
      if (!s3Resp.ok) throw new Error(`HTTP ${s3Resp.status}`);
      const data = await s3Resp.json();
      if (!data || (!data.text)) throw new Error("Invalid payload");
      quote = {
        text: data.text || '',
        source: data.source || i18n('quote_of_the_day_search'),
        link: 'https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN',
        caption: data.caption || ''
      };
    } catch (error) {
      console.error("Error fetching quote of the day:", error);
      quote = {
          text: '',
          source: i18n('quote_of_the_day_search'),
          link: 'https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN',
          caption: ''
        };
    }
      // 缓存到本地
    chrome.storage.local.set({ todayQuote: quote }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving quote to storage:", chrome.runtime.lastError);
          sendResponse({
            text: '',
            source: i18n('quote_of_the_day_search'),
            link: 'https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN',
          });
          return;
        }
        console.log("Quote of the day saved to storage:", quote);
        sendResponse(quote);
    });
  }
}); */
