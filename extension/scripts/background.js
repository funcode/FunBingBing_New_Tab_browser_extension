
importScripts('base.js');

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

const DEFAULT_LOST_QUOTES_URL = null;
const LOST_QUOTES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let lostQuotesCache = null;
let lostQuotesFetchedAt = 0;
let lostQuotesCacheUrl = null;

async function getLostQuotesUrl() {
  await confReadyPromise;
  const configuredUrl = readConf("qotd_url");
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return configuredUrl.trim();
  }
  return DEFAULT_LOST_QUOTES_URL;
}

async function fetchLostQuotes(force = false) {
  const lostQuotesUrl = await getLostQuotesUrl();
  if (!lostQuotesUrl) {
    return {};
  }
  const now = Date.now();
  if (!force && lostQuotesCache && lostQuotesCacheUrl === lostQuotesUrl && (now - lostQuotesFetchedAt) < LOST_QUOTES_CACHE_TTL_MS) {
    return lostQuotesCache;
  }

  const response = await fetch(lostQuotesUrl, {
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
  lostQuotesCacheUrl = lostQuotesUrl;
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

function getLatestAvailableQuote(allQuotes) {
  if (!allQuotes || typeof allQuotes !== "object") {
    return { date: null, quote: null };
  }

  const latestDate = Object.keys(allQuotes)
    .filter((date) => /^\d{8}$/.test(date))
    .sort()
    .at(-1) || null;

  if (!latestDate) {
    return { date: null, quote: null };
  }

  return {
    date: latestDate,
    quote: normalizeQuotePayload(allQuotes[latestDate])
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && (message.type === "getQuotes" || message.type === "getLostQuotes")) {
    (async () => {
      try {
        const requestedDates = Array.isArray(message.dates)
          ? message.dates.filter(date => typeof date === "string" && date.trim().length > 0)
          : [];

        const allQuotes = await fetchLostQuotes();
        const responsePayload = {};

        if (requestedDates.length > 0) {
          requestedDates.forEach((date) => {
            const normalized = normalizeQuotePayload(allQuotes[date]);
            if (normalized) {
              responsePayload[date] = normalized;
            }
          });
        }

        // For "today" flow, return a latest quote when the requested date is missing.
        const wantsLatestFallback = Boolean(message.includeLatestFallback);
        if (wantsLatestFallback && requestedDates.length > 0) {
          const hasAnyHit = Object.keys(responsePayload).length > 0;
          if (!hasAnyHit) {
            const { date, quote } = getLatestAvailableQuote(allQuotes);
            if (date && quote) {
              responsePayload[date] = quote;
            }
          }
        } else if (requestedDates.length === 0) {
          // If no dates provided, return only latest available quote.
          const { date, quote } = getLatestAvailableQuote(allQuotes);
          if (date && quote) {
            responsePayload[date] = quote;
          }
        }

        sendResponse(responsePayload);
      } catch (error) {
        //TODO: Retry logic could be added here
        console.error("Error handling getQuotes message:", error);
        sendResponse({});
      }
    })();

    return true; // keeps the message channel open for async response
  }

  return false;
});
