
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
    quotes: {},
    tracker: {
      //0 is the initial value, meaning no quotes cached yet. It will be set to 1-8 as quotes are cached, indicating the current slot to overwrite next.
      last: 0,
      "1": null, "2": null, "3": null, "4": null,
      "5": null, "6": null, "7": null, "8": null
    }
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
  if (!quoteState.tracker || typeof quoteState.tracker !== "object") {
    quoteState.tracker = getDefaultQuoteState().tracker;
  }
  return quoteState;
}

function insertQuoteIntoCache(date, quote, quoteState, options = {}) {
  const normalizedQuote = normalizeQuotePayload(quote);
  if (!date || !normalizedQuote) return false;
  const allQuotes = quoteState.quotes;
  const tracker = quoteState.tracker;
  if (allQuotes[date]) {
    if (options.replaceExisting) {
      allQuotes[date] = normalizedQuote;
      return true;
    }
    return false;
  } else {
    tracker.last = (tracker.last % QUOTE_CACHE_SLOTS) + 1;
    const slot = tracker.last;
    const oldKey = tracker[slot];
    if (oldKey && allQuotes[oldKey]) {
      delete allQuotes[oldKey];
    }
    allQuotes[date] = normalizedQuote;
    tracker[slot] = date;
    return true;
  }
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
        latestQuoteSyncRequestId = Math.max(latestQuoteSyncRequestId, requestId);

        await confReadyPromise;

        const quoteState = getQuoteState();
        const allQuotes = quoteState.quotes;

        const quoteMapForPatch = {};

        if (todayDate) {
          const inserted = insertQuoteIntoCache(todayDate, todayQuote, quoteState, { replaceExisting: true });
          const normalizedTodayQuote = normalizeQuotePayload(todayQuote);
          if (inserted || normalizedTodayQuote) {
            quoteMapForPatch[todayDate] = normalizedTodayQuote || allQuotes[todayDate];
          }
        }

        const dates = Array.isArray(imageDates) ? imageDates.filter(d => typeof d === "string" && d.trim()) : [];
        const missingDates = computeMissingDates(dates, allQuotes);

        if (missingDates.length > 0) {
          try {
            const remote = await fetchLostQuotes();
            missingDates.forEach((date) => {
              const candidate = normalizeQuotePayload(remote[date]);
              if (candidate) {
                quoteMapForPatch[date] = candidate;
                insertQuoteIntoCache(date, candidate, quoteState);
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

        if (requestId !== latestQuoteSyncRequestId) {
          sendResponse({ ok: false, stale: true });
          return;
        }

        await writeConf("cache_quote_state", quoteState);

        const unresolved = computeMissingDates(dates, allQuotes);
        await writeConf("lost_quotes", unresolved);

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
