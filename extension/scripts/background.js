
// on install
chrome.runtime.onInstalled.addListener(function (object) {
	// open manual link
	if (chrome.runtime.OnInstalledReason.INSTALL === object.reason) {
		chrome.tabs.create({ url: "https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN" });
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

const LOST_QUOTES_URL = "https://bing-quotes.s3.ap-east-1.amazonaws.com/latest.json";
const LOST_QUOTES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let lostQuotesCache = null;
let lostQuotesFetchedAt = 0;

async function fetchLostQuotes(force = false) {
  const now = Date.now();
  if (!force && lostQuotesCache && (now - lostQuotesFetchedAt) < LOST_QUOTES_CACHE_TTL_MS) {
    return lostQuotesCache;
  }

  const response = await fetch(LOST_QUOTES_URL, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch lost quotes: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data || typeof data !== "object") {
    throw new Error("Lost quotes payload is invalid");
  }

  lostQuotesCache = data;
  lostQuotesFetchedAt = now;
  return data;
}

function normalizeQuotePayload(rawQuote) {
  if (!rawQuote || typeof rawQuote !== "object") {
    return null;
  }

  const text = rawQuote.text || "";
  if (!text) {
    return null;
  }

  const source = rawQuote.source || "";
  let link = rawQuote.link || "";
  if (!link && source) {
    link = `https://cn.bing.com/search?q=${encodeURIComponent(source)}&form=BTQUOT`;
  }

  return {
    text,
    source,
    caption: rawQuote.caption || "",
    link
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "getLostQuotes") {
    (async () => {
      try {
        const requestedDates = Array.isArray(message.dates)
          ? message.dates.filter(date => typeof date === "string" && date.trim().length > 0)
          : [];

        if (requestedDates.length === 0) {
          sendResponse({});
          return;
        }

        const allQuotes = await fetchLostQuotes();
        const responsePayload = {};

        requestedDates.forEach((date) => {
          const normalized = normalizeQuotePayload(allQuotes[date]);
          if (normalized) {
            responsePayload[date] = normalized;
          }
        });

        sendResponse(responsePayload);
      } catch (error) {
        console.error("Error handling getLostQuotes message:", error);
        sendResponse({});
      }
    })();

    return true; // keeps the message channel open for async response
  }

  return false;
});
