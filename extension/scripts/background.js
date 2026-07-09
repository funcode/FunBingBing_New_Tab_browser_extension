
importScripts('base.js');

// on install
chrome.runtime.onInstalled.addListener(function (object) {
	// open manual link
	if (chrome.runtime.OnInstalledReason.INSTALL === object.reason) {
		chrome.tabs.create({ url: "https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN&form=QBRE" });
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
const QUOTE_CACHE_SLOTS = 8;
const LOST_QUOTES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let latestQuoteSyncRequestId = 0;

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

function getDefaultQuoteState() {
  return {
    quotes: {}
  };
}

function getQuoteState() {
  const quoteState = readConf("cache_quote_state");
  if (!quoteState || typeof quoteState !== "object") {
    return getDefaultQuoteState();
  }
  if (!quoteState.quotes || typeof quoteState.quotes !== "object") {
    quoteState.quotes = {};
  }
  return quoteState;
}

function pruneQuoteCache(allQuotes) {
  const dates = Object.keys(allQuotes);
  if (dates.length <= QUOTE_CACHE_SLOTS) return;

  const keep = new Set(
    dates
      .sort()
      .reverse()
      .slice(0, QUOTE_CACHE_SLOTS)
  );

  dates.forEach((date) => {
    if (!keep.has(date)) {
      delete allQuotes[date];
    }
  });
}

function insertQuoteIntoCache(date, quote, quoteState) {
  const normalizedQuote = normalizeQuotePayload(quote);
  if (!date || !normalizedQuote) return null;
  const allQuotes = quoteState.quotes;
  allQuotes[date] = normalizedQuote;
  pruneQuoteCache(allQuotes);
  return normalizedQuote;
}

function computeMissingDates(imageDates, allQuotes) {
  const missing = new Set();
  const quoteMap = allQuotes || {};

  (imageDates || []).forEach((date) => {
    if (typeof date !== "string" || !date.trim()) return;
    const cachedQuote = normalizeQuotePayload(quoteMap[date]);
    if (cachedQuote) return;
    missing.add(date);
  });

  return Array.from(missing);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "syncQuotesForImages") {
    (async () => {
      try {
        const { requestId, todayDate, todayQuote, imageDates } = message;
        if (!Number.isFinite(requestId)) {
          sendResponse({ ok: false, error: "invalid requestId" });
          return;
        }

        if (requestId <= latestQuoteSyncRequestId) {
          sendResponse({ ok: false, stale: true });
          return;
        }
        console.log(`[${new Date().toISOString()}] Handling syncQuotesForImages requestId=${requestId}, todayDate=${todayDate}, imageDates=${JSON.stringify(imageDates)}`);
        latestQuoteSyncRequestId = Math.max(latestQuoteSyncRequestId, requestId);

        await confReadyPromise;

        const quoteState = getQuoteState();
        const allQuotes = quoteState.quotes;

        const quoteMapForPatch = {};

        if (todayDate) {
          const todayCandidate = insertQuoteIntoCache(todayDate, todayQuote, quoteState);
          if (todayCandidate) {
            quoteMapForPatch[todayDate] = todayCandidate;
          }
        }

        const dates = Array.isArray(imageDates) ? imageDates.filter(d => typeof d === "string" && d.trim()) : [];
        const missingDates = computeMissingDates(dates, allQuotes);

        if (missingDates.length > 0) {
          try {
            console.log(`[${new Date().toISOString()}] Fetching lost quotes for missing dates: ${missingDates.join(", ")}`);
            const remote = await fetchLostQuotes();
            missingDates.forEach((date) => {
              const candidate = insertQuoteIntoCache(date, remote[date], quoteState);
              if (candidate) {
                quoteMapForPatch[date] = candidate;
              }
            });
          } catch (err) {
            console.error("Failed to fetch lost quotes:", err);
          }
        }

        // Include cached quotes for dates that had them already
        dates.forEach((date) => {
          if (!quoteMapForPatch[date]) {
            const cached = normalizeQuotePayload(allQuotes[date]);
            if (cached) {
              quoteMapForPatch[date] = cached;
            }
          }
        });

        // Prevent an older syncQuotesForImages request from writing results after a newer request has already started.
        if (requestId !== latestQuoteSyncRequestId) {
          sendResponse({ ok: false, stale: true });
          return;
        }

        await writeConf("cache_quote_state", quoteState);

        //It is useless now. Kept for debugging purposes. May drop it in future.
        const unresolved = computeMissingDates(dates, allQuotes);
        writeConf("lost_quotes", unresolved);

        const updatedDates = Object.keys(quoteMapForPatch);
        if (updatedDates.length > 0) {
          chrome.runtime.sendMessage({ type: "quotesUpdated", requestId, updatedDates });
        }

        sendResponse({ ok: true, stale: false, updatedDates, missingDates: unresolved });
      } catch (error) {
        console.error("Error handling syncQuotesForImages:", error);
        sendResponse({ ok: false, error: error.message });
      }
    })();

    return true;
  }

  return false;
});
