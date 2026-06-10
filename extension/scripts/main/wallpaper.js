const WALLPAPER_CACHE_NAME = 'funbingbing-wallpaper-cache-v1';
const WALLPAPER_FETCH_LOCK_KEY = 'wallpaper_fetch_lock';
const WALLPAPER_FETCH_LOCK_TTL_MS = 30_000;
let currentWallpaperObjectUrl = null;
let currentImageDate = null;
let currentTransientQuoteDate = null;
let currentTransientQuote = null;

function paintPreloadedWallpaperIfAvailable() {
	try {
		const body = document.getElementById('main-body');
		if (!body || typeof readConf !== 'function') return;
		const preloadDataUrl = readConf('wallpaper_preload_data_url');
		if (!preloadDataUrl) return;
		body.style.backgroundImage = `url('${preloadDataUrl}')`;
		body.style.backgroundColor = '';
		body.classList.remove('wallpaper-fallback-active');
		body.removeAttribute('data-wallpaper-fallback');
	} catch (err) {
		console.warn('Unable to paint cached wallpaper preload:', err);
	}
}

paintPreloadedWallpaperIfAvailable();

function revokeCurrentWallpaperObjectUrl() {
	if (currentWallpaperObjectUrl) {
		URL.revokeObjectURL(currentWallpaperObjectUrl);
		currentWallpaperObjectUrl = null;
	}
}

async function preloadWallpaperObjectUrl(objectUrl) {
	// Wait for the blob-backed image to decode so switching backgrounds does not flash.
	const img = new Image();
	img.src = objectUrl;
	if (typeof img.decode === 'function') {
		await img.decode();
		return;
	}
	await new Promise((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('Wallpaper image failed to load'));
	});
}

async function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error || new Error('Failed converting blob to data URL'));
		reader.readAsDataURL(blob);
	});
}

async function cachePreloadWallpaper(blob) {
	if (!blob) return;
	try {
		const dataUrl = await blobToDataUrl(blob);
		chrome.storage.local.set({ 'wallpaper_preload_data_url': dataUrl });
	} catch (err) {
		console.warn('Failed to cache preload wallpaper:', err);
	}
}

async function fetchWallpaperBlob(url) {
	if (!url) {
		throw new Error('Invalid wallpaper url');
	}

	const fetchFromNetwork = async () => {
		const response = await fetch(url, {
			mode: 'cors',
			cache: 'no-store'
		});
		if (!response.ok) {
			throw new Error(`Wallpaper request failed with status ${response.status}`);
		}
		return response;
	};

	if (!('caches' in window)) {
		const networkResponse = await fetchFromNetwork();
		return networkResponse.blob();
	}

	const cache = await caches.open(WALLPAPER_CACHE_NAME);
	let response = await cache.match(url);
	if (!response) {
		response = await fetchFromNetwork();
		await cache.put(url, response.clone());
	}
	return response.blob();
}

async function applyWallpaperFromBlob(blob, originalUrl, image, options = {}) {
	const body = document.getElementById('main-body');
	if (!body) return;
	const objectUrl = URL.createObjectURL(blob);
	revokeCurrentWallpaperObjectUrl();
	currentWallpaperObjectUrl = objectUrl;
	try {
		await preloadWallpaperObjectUrl(objectUrl);
	} catch (preloadError) {
		console.warn('Wallpaper preloading failed, applying immediately:', preloadError);
	}
	setContents(image, options);
	body.style.backgroundImage = `url('${objectUrl}')`;
	body.removeAttribute('data-wallpaper-fallback');
	body.classList.remove('wallpaper-fallback-active');
	body.style.backgroundColor = '';
	writeConf('wallpaper_url', originalUrl);
	const existingIframe = body.querySelector('iframe[src="offline.html"]');
	if (existingIframe) {
		body.removeChild(existingIframe);
	}
}

// set wallpaper to default
async function showDefaultWallpaper(options = {}) {
	function activateFallbackPlaceholder() {
		revokeCurrentWallpaperObjectUrl();
		body.style.backgroundImage = '';
		body.style.backgroundColor = '#000';
		body.setAttribute('data-wallpaper-fallback', 'visible');
		body.classList.add('wallpaper-fallback-active');
		const leftoverOfflineIframe = body.querySelector('iframe[src="offline.html"]');
		if (leftoverOfflineIframe) {
			body.removeChild(leftoverOfflineIframe);
		}
	}
	const body = document.getElementById('main-body');
	if (!body) return;
	const wallpaperUrl = readConf('wallpaper_url');
	if (wallpaperUrl) {
		let imageForContent;
		const bingImages = readConf('bing_images');
		let idx = readConf('wallpaper_idx');
		idx = Number.parseInt(idx, 10);
		if (!Number.isFinite(idx) || idx < 0) {
			idx = 0;
		}
		if (Array.isArray(bingImages) && bingImages.length > 0) {
			if (idx >= bingImages.length) {
				idx = 0;
			}
			imageForContent = bingImages[idx];
		}
		try {
			if ('caches' in window) {
				const cache = await caches.open(WALLPAPER_CACHE_NAME);
				const cachedResponse = await cache.match(wallpaperUrl);
				if (!cachedResponse) {
					activateFallbackPlaceholder();
				}
			}
			const blob = await fetchWallpaperBlob(wallpaperUrl);
			await applyWallpaperFromBlob(blob, wallpaperUrl, imageForContent, options);
			return;
		} catch (err) {
			console.error('Failed to load cached wallpaper via Cache Storage:', err);
		}
	}
	activateFallbackPlaceholder();
}

// set footer text
function setFooterText(text) {
	var headline_text = document.getElementById('headline');
	headline_text.innerHTML = text;
}

// pre-load image from url
// then change background image and footer text after loading is finished
async function changeWallpaper(idx) {
	setFooterText(i18n('updating_wallpaper'));
	const images = readConf('bing_images');
	if (!Array.isArray(images) || images.length === 0) {
		await showDefaultWallpaper();
		return false;
	}
	if (!Number.isFinite(idx) || idx < 0) {
		idx = 0;
	}
	if (idx >= images.length) {
		idx = 0;
	}
	const image = images[idx];
	currentImageDate = image?.isoDate || null;
	//TODO: scrape this baseurl from modelResult in collectBingDataInParallel
	const baseurl = 'https://ts1.tc.mm.bing.net';
	const landscape = image?.imageUrls?.landscape;
	const path = readConf('enable_uhd_wallpaper') == 'yes'
		? landscape?.ultraHighDef
		: landscape?.highDef;
	const imgurl = path ? baseurl + path : null;
	const path_640x360 = readConf('enable_uhd_wallpaper') == 'yes'
		? landscape?.ultraHighDef?.replace('UHD', '640x360')
		: landscape?.highDef.replace('1920x1080', '640x360');
	const img_640x360 = path_640x360 ? baseurl + path_640x360 : null;
	if (!imgurl) {
		console.warn('Unable to resolve wallpaper URL for index', idx);
		await showDefaultWallpaper();
		return false;
	}
	try {
		const hdPromise = (async () => {
			const hdBlob = await fetchWallpaperBlob(imgurl);
			await applyWallpaperFromBlob(hdBlob, imgurl, image);
		})();
		const previewPromise = (async () => {
			let previewBlob = null;
			if (img_640x360) {
				try {
					previewBlob = await fetchWallpaperBlob(img_640x360);
					// Reduce the flash when opening a new tab
					cachePreloadWallpaper(previewBlob);
					/* await applyWallpaperFromBlob(previewBlob, img_640x360, image);
					// slight delay to ensure smooth transition
					await delay(100); */
				} catch (previewError) {
					console.warn('Failed to load preview resolution wallpaper, skipping preload cache:', previewError);
				}
			}
		})();
		await Promise.all([hdPromise, previewPromise]);
		return true;
	} catch (error) {
		console.error('Failed to load wallpaper image:', error);
		await showDefaultWallpaper();
		return false;
	}
}

// get latest wallpaper url from bing.com 
// then load and change wallpaper
async function updateWallpaper(idx) {
	try {
		const changed = await changeWallpaper(idx);
		if (!changed) return false;
		await writeConf('wallpaper_idx', idx.toString());
		return true;
	} catch (e) {
		console.error('Failed to update wallpaper:', e);
		await showDefaultWallpaper();
		return false;
	}
}

async function refreshConfCacheIfAvailable() {
		await initConfCache();
}

async function isTodayWallpaperReady() {
	return await readStorageKey('wallpaper_date') === getDateString();
}

function isFreshWallpaperFetchLock(lockValue) {
	const lockTime = Number(lockValue);
	return Number.isFinite(lockTime)
		&& lockTime > 0
		&& Date.now() - lockTime < WALLPAPER_FETCH_LOCK_TTL_MS;
}

async function waitForTodayWallpaperReady(timeoutMs = WALLPAPER_FETCH_LOCK_TTL_MS) {
	return new Promise((resolve) => {
		let settled = false;
		let timeoutId;

		const finish = (ready) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			chrome.storage.onChanged.removeListener(onChanged);
			resolve(Boolean(ready));
		};

		const onChanged = (changes, area) => {
			if (area === 'local' && changes.wallpaper_date?.newValue === getDateString()) {
				finish(true);
			}
		};

		chrome.storage.onChanged.addListener(onChanged);
		timeoutId = setTimeout(() => finish(false), timeoutMs);

		readStorageKey('wallpaper_date')
			.then((wallpaperDate) => {
				if (wallpaperDate === getDateString()) {
					finish(true);
				}
			})
			.catch((err) => {
				console.warn('Failed to check wallpaper_date while waiting:', err);
			});
	});
}

async function runWallpaperFetchRefresh() {
	setFooterText(i18n('updating_wallpaper'));
	await showDefaultWallpaper({ preserveUpdatingHeadline: true });

	const results = await collectBingDataInParallel();
	const todayDate = await handleBingDataResults(results);
	if (!todayDate) {
		await showDefaultWallpaper();
		return false;
	}

	const updated = await updateWallpaper(0);
	if (!updated) return false;

	await writeConf('wallpaper_date', todayDate);
	return true;
}

// --- Main entry point ---
async function initWallpaper() {
	const cache_date = readConf("wallpaper_date");
	if (cache_date == getDateString()) {
		// Cached wallpaper for today
		const cache_idx = readConf("wallpaper_idx");
		if (cache_idx !== undefined && cache_idx !== null) {
			await changeWallpaper(Number.parseInt(cache_idx, 10));
		} else {
			setFooterText(i18n('updating_wallpaper'));
			await showDefaultWallpaper();
			await updateWallpaper(0);
		}
	} else {
		try {
			if (await isTodayWallpaperReady()) {
				await refreshConfCacheIfAvailable();
				if (await changeWallpaper(0)) return;
			}

			const lockValue = await readStorageKey(WALLPAPER_FETCH_LOCK_KEY);
			if (isFreshWallpaperFetchLock(lockValue)) {
				setFooterText(i18n('updating_wallpaper'));
				await showDefaultWallpaper({ preserveUpdatingHeadline: true });
				const ready = await waitForTodayWallpaperReady();
				if (ready || await isTodayWallpaperReady()) {
					await refreshConfCacheIfAvailable();
					if (await changeWallpaper(0)) return;
					console.warn('Today wallpaper became ready, but display failed; refreshing.');
				}
			}

			// Best-effort cross-tab throttle; storage get/set is not atomic.
			await writeConf(WALLPAPER_FETCH_LOCK_KEY, Date.now());
			try {
				await runWallpaperFetchRefresh();
			} finally {
				await writeConf(WALLPAPER_FETCH_LOCK_KEY, 0);
			}
		} catch (err) {
			console.error("Error initializing wallpaper:", err);
			await showDefaultWallpaper();
		}
	}
}

// --- Collect Bing Data (with fetch) ---
async function collectBingDataInParallel() {
	const results = { imageArchive: null, imageOfTheDay: null, model: null, quoteOfTheDay: null, errors: [] };

	try {
		// Kick off all 4 requests in parallel
		const [archiveRes, dayRes, modelRes, quoteRes] = await Promise.allSettled([
			fetch("https://www.bing.com/HPImageArchive.aspx?format=js&n=1&mkt=zh-CN&idx=7"),
			fetch("https://www.bing.com/hp/api/v1/imageoftheday?format=json&mkt=zh-CN"),
			fetch("https://www.bing.com/hp/api/model?mkt=zh-CN"),
			fetch("https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN&form=QBRE", {
				body: null,
				method: "GET",
				mode: "cors",
				cache: "no-store",
				credentials: "include"
			})
		]);

		// Parse archive
		if (archiveRes.status === "fulfilled" && archiveRes.value.ok) {
			results.imageArchive = await archiveRes.value.json();
		} else {
			results.errors.push("HPImageArchive request failed");
		}

		// Parse imageOfTheDay
		if (dayRes.status === "fulfilled" && dayRes.value.ok) {
			results.imageOfTheDay = await dayRes.value.json();
		} else {
			results.errors.push("ImageOfTheDay request failed");
		}

		// Parse model + trivia expansion
		if (modelRes.status === "fulfilled" && modelRes.value.ok) {
			const mediaObj = await modelRes.value.json();
			const { quickFactsBySsd, triviaPromises } = (mediaObj?.MediaContents || []).reduce((acc, item) => {
				const mc = {
					headline: item.ImageContent?.Headline,
					quickFact: item.ImageContent?.QuickFact?.MainText,
					triviaId: item.ImageContent?.TriviaId,
					ssd: item.Ssd
				};

				if (mc.ssd && mc.quickFact) acc.quickFactsBySsd[mc.ssd] = mc.quickFact;

				acc.triviaPromises.push((async () => {
					if (mc.triviaId) {
						try {
							const res = await fetch(`https://www.bing.com/hp/api/v1/trivia?format=json&id=${mc.triviaId}&mkt=zh-CN`);
							if (res.ok) mc.triviaData = (await res.json()).data;
						} catch (e) { console.error("Failed trivia fetch:", e); }
					}
					return mc;
				})());

				return acc;
			}, { quickFactsBySsd: {}, triviaPromises: [] });

			results.quickFactsBySsd = quickFactsBySsd;
			results.processedMediaContents = await Promise.all(triviaPromises);
		} else {
			results.errors.push("Model request failed");
		}

		// Parse quote of the day
		if (quoteRes.status === "fulfilled" && quoteRes.value.ok) {
			results.quoteOfTheDay = await quoteRes.value.text();
		} else {
			results.errors.push("QuoteOfTheDay request failed");
		}
	} catch (err) {
		results.errors.push("Error collecting Bing data: " + err.message);
	}

	return results;
}

// --- Process Bing Results ---
async function handleBingDataResults(results) {
	// --- Safely access images ---
	const images = results.imageOfTheDay?.data?.images ?? [];
	if (images.length === 0) {
		console.error("No imageOfTheDay data found");
		return null;
	}

	// --- Async task: Handle Quote of the Day ---
	const quoteTask = async () => {
		// --- Scrape Quote of the Day ---
		// --- The 2 functions below are adapted from FunBingBing repo ---
		const selectFirst = (doc, selectors) => {
			for (const selector of selectors) {
				const element = doc.querySelector(selector);
				if (element) return element;
			}
			return null;
		};
		function extractQuote(doc) {
			const textElement = selectFirst(doc, [
				'#bt_qotdText .bt_quoteText',
				'.bt_quoteText',
				'.quoteText',
				'.qotd_quote[data-quote-text]',
				'.qotd_quote_clickable .qotd_quote',
				'.qotd_quote_clickable',
				'.qotd_quote'
			]);
			const text = textElement
				? (textElement.getAttribute('data-quote-text') || textElement.textContent).trim()
				: null;

			const authorElement = selectFirst(doc, [
				'#bt_qotdText .bt_author .b_mText a',
				'.qotd_author a',
				'.qotd_author',
				'.qotd_footer a'
			]);
			const author = authorElement ? authorElement.textContent.trim() : null;
			const authorLink = authorElement
				? (authorElement.closest('a') || authorElement.querySelector('a'))
				: null;
			const authorHref = authorLink ? authorLink.getAttribute('href') || '' : '';

			const captionElement = selectFirst(doc, [
				'#bt_qotdText .bt_authorCaption',
				'.qotd_desc',
				'.qotd_footer .qotd_desc'
			]);
			const caption = captionElement ? captionElement.textContent.trim() : null;

			return { text, author, authorHref, caption };
		}
		if (results.quoteOfTheDay) {
			try {
				const parser = new DOMParser();
				const doc = parser.parseFromString(results.quoteOfTheDay, "text/html");
				let { text: quoteText, author: authorText, authorHref, caption: authorCaption } = extractQuote(doc);
				if (quoteText && authorText) {
					return {
						text: quoteText,
						source: authorText,
						link: authorHref,
						caption: authorCaption
					};
				}
			} catch (e) {
				console.error("Error parsing quote of the day HTML:", e);
			}
		}
		return null;

	};

	// --- Merge processedMediaContents ---
	images.forEach((img, idx) => {
		const mc = results.processedMediaContents?.[idx];
		if (!mc) return;
		if (mc.headline) img.headline = mc.headline;
		if (mc.quickFact) img.quickFact = mc.quickFact;
		if (mc.triviaId) img.triviaId = mc.triviaId;
		if (mc.triviaData) img.triviaData = mc.triviaData;
	});

	// --- Async task: trivia for 8th image ---
	const triviaFetch = async () => {
		const archiveImages = results.imageArchive?.images;
		if (!archiveImages) return;

		const idx = images.length - 1;
		images[idx].headline = archiveImages[0].title;
		images[idx].triviaId = archiveImages[0].quiz;

		if (!images[idx].triviaId) return;

		const match = images[idx].triviaId.match(/HPQuiz_\d{8}_([^%]+)/);
		if (!match || !images[idx].isoDate) return;

		const quizName = match[1];
		images[idx].triviaId = `HPQuiz_${images[idx].isoDate}_${quizName}`;

		try {
			const res = await fetch(
				`https://www.bing.com/hp/api/v1/trivia?format=json&id=${images[idx].triviaId}&mkt=zh-CN`
			);
			if (res.ok) {
				images[idx].triviaData = (await res.json()).data;
			}
		} catch (err) {
			console.error("Failed trivia fetch for archive image:", err);
		}
	};

	// --- Async task: update quickFacts ---
	const quickFactsUpdate = async () => {
		const cachedQuickFacts = readConf("cache_quick_facts");
		const lastImageDate = images.at(-1).isoDate;

		if (cachedQuickFacts && lastImageDate && cachedQuickFacts[lastImageDate]) {
			images.at(-1).quickFact = cachedQuickFacts[lastImageDate];
			results.quickFactsBySsd[lastImageDate] = cachedQuickFacts[lastImageDate];
		} else {
			images.at(-1).quickFact = '';
		}
		// Always keep the 8 most recent quickFacts cached
		writeConf("cache_quick_facts", results.quickFactsBySsd);
	};

	// --- Execute all async tasks in parallel ---
	const [, , todayQuote] = await Promise.all([triviaFetch(), quickFactsUpdate(), quoteTask()]);

	setTransientQuote(images[0].isoDate, todayQuote);
	const quoteSyncPayload = buildQuoteSyncPayload(images, todayQuote);

	images.forEach((img) => {
		if (img && typeof img === 'object') {
			delete img.quoteData;
		}
	});

	// --- Save image metadata; quotes are persisted only in cache_quote_state ---
	await writeConf("bing_images", images);
	console.log("Saved bing_images with merged contents.");

	if (quoteSyncPayload) {
		fireQuoteSync(quoteSyncPayload);
	}

	// --- Log errors ---
	if (results.errors?.length > 0) {
		console.error("Errors during parallel data collection:", results.errors);
		writeConf("bing_data_errors", results.errors);
	}

	return images[0].isoDate || null;
}


// if user want to show old wallpapers.
async function switchPrevWallpaper() {
	var MAX_OLD_DAYS = 8;
	// calculate idx
	var cache_idx = readConf("wallpaper_idx");
	if (!cache_idx) {
		cache_idx = 0;
	}
	cache_idx = parseInt(cache_idx);
	cache_idx = (cache_idx + 1) % MAX_OLD_DAYS;
	// reload wallpaper
	await updateWallpaper(cache_idx);
}

async function switchNextWallpaper() {
	var MAX_OLD_DAYS = 8;
	// calculate idx
	var cache_idx = readConf("wallpaper_idx");
	if (!cache_idx) {
		cache_idx = 0;
	}
	cache_idx = parseInt(cache_idx);
	cache_idx = (cache_idx - 1 + MAX_OLD_DAYS) % MAX_OLD_DAYS;
	// reload wallpaper
	await updateWallpaper(cache_idx);
}

// set wallpaper download link
function setDownloadLink() {
	var downloadLink = document.getElementById('wallpaper-download-link');
	downloadLink.href = document.getElementById('main-body').style.backgroundImage.replace('url("', '').replace('")', '');
	downloadLink.download = 'bing-wallpaper-' + getDateString();
}

function handleQuoteLinkClick() {
	// Force a data refresh the next time a tab opens when the quote is missing
	writeConf('wallpaper_date', '20000101');
}

function getDefaultQuotePlaceholderData() {
	return {
		text: '',
		source: i18n('quote_of_the_day_search'),
		link: 'https://www.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN&form=QBRE',
		caption: ''
	};
}

function renderQuoteSection(quoteData) {
	const qt = document.getElementById('quote-text');
	const qf = document.getElementById('quote-full-text');
	const qsLinkElem = document.getElementById('quote-source-link');
	const qc = document.getElementById('quote-caption');
	if (!quoteData) {
		const hasExistingQuoteUiContent = Boolean(
			qt?.textContent?.trim() ||
			qf?.textContent?.trim() ||
			qsLinkElem?.textContent?.trim() ||
			qc?.textContent?.trim()
		);
		if (hasExistingQuoteUiContent) return;
		quoteData = getDefaultQuotePlaceholderData();
	}
	const hasQuoteText = typeof quoteData?.text === 'string' && quoteData.text.trim().length > 0;

	if (hasQuoteText) {
		let raw = quoteData.text.trim();
		if (/^["'“”‘’].+["'“”‘’]$/.test(raw)) {
			const first = raw[0];
			const last = raw[raw.length - 1];
			if (/["'“”‘’]/.test(first) && /["'“”‘’]/.test(last)) {
				raw = raw.substring(1, raw.length - 1).trim();
			}
		}
		const wrapped = `“${raw}”`;
		if (qt) qt.textContent = wrapped;
		if (qf) qf.textContent = wrapped;
	} else {
		if (qt) qt.textContent = '';
		if (qf) qf.textContent = '';
	}

	if (qsLinkElem) {
		qsLinkElem.removeEventListener('click', handleQuoteLinkClick);
		if (!hasQuoteText) {
			qsLinkElem.addEventListener('click', handleQuoteLinkClick);
		}
		if (quoteData && quoteData.source) {
			qsLinkElem.textContent = quoteData.source;
			qsLinkElem.style.display = 'inline';
		} else {
			qsLinkElem.textContent = '';
			qsLinkElem.style.display = 'none';
		}
		let href = quoteData?.link;
		if (!href && quoteData?.source) {
			const encodedSource = encodeURIComponent(quoteData.source);
			href = `https://cn.bing.com/search?q=${encodedSource}&form=BTQUOT`;
		}
		if (href) {
			qsLinkElem.setAttribute('href', href);
			qsLinkElem.setAttribute('rel', 'noopener noreferrer');
			qsLinkElem.setAttribute('target', '_blank');
		} else {
			qsLinkElem.removeAttribute('href');
			qsLinkElem.removeAttribute('rel');
			qsLinkElem.removeAttribute('target');
		}
	}

	if (qc) {
		qc.textContent = quoteData?.caption || '';
	}
}

function normalizeQuoteForRender(rawQuote) {
	if (!rawQuote || typeof rawQuote !== 'object') return null;
	const text = typeof rawQuote.text === 'string' ? rawQuote.text.trim() : '';
	if (!text) return null;
	return {
		text,
		source: typeof rawQuote.source === 'string' ? rawQuote.source : '',
		caption: typeof rawQuote.caption === 'string' ? rawQuote.caption : '',
		link: typeof rawQuote.link === 'string' && rawQuote.link.trim()
			? rawQuote.link
			: rawQuote.source
				? `https://cn.bing.com/search?q=${encodeURIComponent(rawQuote.source)}&form=BTQUOT`
				: ''
	};
}

function getCachedQuotesFromState(state = readConf('cache_quote_state')) {
	return state && typeof state === 'object' && state.quotes && typeof state.quotes === 'object'
		? state.quotes
		: {};
}

function setTransientQuote(date, quote) {
	const normalizedQuote = normalizeQuoteForRender(quote);
	if (!date || !normalizedQuote) {
		if (date && currentTransientQuoteDate === date) {
			currentTransientQuoteDate = null;
			currentTransientQuote = null;
		}
		return;
	}
	currentTransientQuoteDate = date;
	currentTransientQuote = normalizedQuote;
}

function clearTransientQuote(date) {
	if (date && currentTransientQuoteDate === date) {
		currentTransientQuoteDate = null;
		currentTransientQuote = null;
	}
}

function getQuoteForImage(image, quoteCache = getCachedQuotesFromState()) {
	if (!image || typeof image !== 'object') return null;
	if (image.isoDate && image.isoDate === currentTransientQuoteDate) {
		const transientQuote = normalizeQuoteForRender(currentTransientQuote);
		if (transientQuote) return transientQuote;
	}
	return normalizeQuoteForRender(quoteCache?.[image.isoDate]);
}

function buildQuoteSyncPayload(images, todayQuote) {
	if (!Array.isArray(images) || images.length === 0) return null;
	const imageDates = images
		.map((img) => (img && typeof img.isoDate === 'string' ? img.isoDate : null))
		.filter((date) => typeof date === 'string' && date.trim());
	if (imageDates.length === 0) return null;
	return {
		type: 'syncQuotesForImages',
		requestId: Date.now(),
		todayDate: images[0]?.isoDate,
		todayQuote,
		imageDates
	};
}

let latestForegroundQuoteRequestId = 0;

function fireQuoteSync(payload) {
	if (!payload) return;
	latestForegroundQuoteRequestId = Math.max(latestForegroundQuoteRequestId, payload.requestId);
	try {
		chrome.runtime.sendMessage(payload, (response) => {
			if (chrome.runtime.lastError) {
				console.debug('syncQuotesForImages failed:', chrome.runtime.lastError.message);
				return;
			}
			if (response && response.stale && payload.requestId === latestForegroundQuoteRequestId) {
				console.debug('syncQuotesForImages skipped stale response');
			}
		});
	} catch (err) {
		console.error('Failed to send syncQuotesForImages:', err);
	}
}

function setContents(image, options = {}) {
	if (!image) return;
	const quoteData = getQuoteForImage(image);
	const preserveUpdatingHeadline = Boolean(options?.preserveUpdatingHeadline);

	// --- Format date helper ---
	const formatDate = (isoDate) => {
		if (!isoDate) return '';
		if (/^\d{8}$/.test(isoDate)) return `${isoDate.slice(0, 4)}/${isoDate.slice(4, 6)}/${isoDate.slice(6, 8)}`;
		if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate.replace(/-/g, '/');
		return isoDate;
	};

	// --- Set footer and headline link ---
	if (!preserveUpdatingHeadline) {
		setFooterText(image.headline);
	}
	const headlineLink = document.getElementById('headline-link');
	if (headlineLink) headlineLink.href = `https://cn.bing.com${image.clickUrl}`;

	// --- Prepare content ---
	const contents = {
		text: image.headline || '',
		title: image.title || '',
		copyright: image.copyright || '',
		isoDate: image.isoDate || '',
		description: image.description || '',
		descriptionPara2: image.descriptionPara2 || '',
		descriptionPara3: image.descriptionPara3 || ''
	};

	// --- Update description block ---
	const descDiv = document.getElementById('description');
	if (descDiv) {
		// Title
		const titleP = descDiv.querySelector('p.title');
		if (titleP) {
			titleP.innerHTML = `${contents.text}&nbsp;|&nbsp;${contents.title} (${contents.copyright})&nbsp;-&nbsp;${formatDate(contents.isoDate)}`;
		}

		// Descriptions + QuickFact
		const subSpan = descDiv.querySelector('span.sub');
		if (subSpan) {
			let html = [contents.description, contents.descriptionPara2, contents.descriptionPara3]
				.filter(Boolean)
				.map(text => `<p>${text}</p>`)
				.join('');

			// QuickFact
			if (image.quickFact) {
/* 				const isWindows = navigator.userAgentData
					? navigator.userAgentData.platform.toLowerCase().startsWith('win')
					: navigator.userAgent.toLowerCase().includes('windows');
				const size = isWindows ? { w: 16, h: 16 } : { w: 24, h: 24 }; */
				html += `<p style="font-style: italic;">
						<!-- License: CC Attribution. Made by Mobirise: https://mobiriseicons.com/ -->
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-quick-fact" preserveAspectRatio="xMidYMid meet">
  							<path vector-effect="non-scaling-stroke" d="M17.2 16c-.3 0-.49.31-.35.57l.79 1.59c.22.5.97.13.71-.35l-.79-1.59c-.06-.13-.2-.22-.35-.22zM5.19 5.6c-.38 0-.56.58-.18.76l1.59.79c.48.26.86-.48.35-.7l-1.59-.79zM24 8.4c0 .22-.18.4-.4.4h-1.6c-.22 0-.4-.18-.4-.4s.18-.4.4-.4h1.6c.22 0 .4.18.4.4zM14 0c.22 0 .4.18.4.4v1.6c0 .22-.18.4-.4.4s-.4-.18-.4-.4V.4c0-.22.18-.4.4-.4zm-4.07 3.22c-.2-.04-.43-.04-.64.08-.21.12-.32.33-.38.52-.06.2-.08.4-.08.62-.01.44.06.95.13 1.47s.16 1.03.2 1.46c.08.76-.15.97-.6 1.36-.33.28-.79.57-1.22.92-.43.31-.86.62-1.18.93-.13.12-.25.24-.4.48-.1.18-.18.4-.13.64s.23.4.4.52c.17.11.37.19.58.26.43.14.95.24 1.48.33.53.09 1.07.17 1.5.27.76.16.93.41 1.17.97.17.39.31.9.48 1.37s.34.98.55 1.37c.1.2.21.37.35.52.14.15.33.28.57.3.24.02.45-.08.61-.2.16-.12.3-.28.44-.45.27-.35.53-.8.79-1.26s.5-.92.73-1.29c.33-.66.73-.72 1.33-.77.44-.02.98-.01 1.52-.01.67 0 1.07-.02 1.52-.08.22-.03.43-.08.62-.16.19-.08.38-.21.48-.44s.06-.46-.01-.65c-.07-.19-.18-.37-.31-.55-.26-.36-.62-.74-.99-1.11-.37-.37-.76-.75-1.05-1.06-.54-.56-.5-.71-.3-1.3.14-.41.36-.9.56-1.4.2-.49.39-.99.5-1.42.05-.22.09-.42.07-.63s-.08-.44-.27-.61c-.19-.16-.42-.19-.63-.18-.21 0-.42.05-.66.11-.46.13-.98.34-1.5.57-.52.22-1.05.5-1.48.67-.69.29-1.05.2-1.61-.13-.37-.23-.8-.64-1.24-.94-.44-.3-.87-.64-1.28-.84a2.4 2.4 0 0 0-.6-.22zm.24.94c.33.16.75.49 1.18.78.43.3.87.7 1.26.96.4.25.72.47 1.11.5.4.03.76-.12 1.22-.3.46-.18.99-.46 1.5-.68.51-.22 1.02-.42 1.4-.53.5-.16.55.05.49.35-.08.35-.26.82-.46 1.31-.2.48-.41.98-.57 1.43-.16.45-.3.7-.2 1.11.09.39.36.66.68 1.0.32.34.7.72 1.07 1.09.37.36.71.73.92 1.02.33.42-.08.5-.25.53-.37.06-.88.07-1.4.07-.53 0-1.07 0-1.55.01-.48.02-.86.02-1.2.22s-.54.53-.77.93c-.24.4-.49.87-.74 1.32-.25.45-.5.87-.72 1.16-.33.35-.45.28-.64-.05-.17-.32-.34-.78-.5-1.26-.17-.48-.33-.99-.49-1.42-.17-.43-.3-.78-.6-1.04-.31-.26-.68-.33-1.15-.42-.46-.1-1.01-.18-1.53-.27-.52-.09-1.02-.2-1.37-.31-.53-.16-.3-.42-.14-.56.26-.25.66-.55 1.09-.85.42-.3.87-.6 1.25-.89.37-.28.68-.5.84-.87.16-.37.11-.74.07-1.2-.05-.46-.13-.98-.2-1.48-.07-.5-.13-.99-.12-1.35-.02-.36.18-.46.55-.3zM8.4 13.6c-.1 0-.2.05-.27.12L.51 21.32c-.72.71-.62 1.71-.08 2.25.54.54 1.53.63 2.25-.08l7.59-7.59c.39-.38-.2-.95-.56-.57l-7.59 7.59c-.46.46-.86.34-1.12.08-.26-.26-.38-.66.08-1.12l7.61-7.6c.26-.25.07-.69-.29-.69z"/>
						</svg>${image.quickFact}</p>`;
			}
			subSpan.innerHTML = html;
		}
	}

	// --- Set daily quiz question ---
	const quizDiv = document.getElementById('daily-quiz-title');
	if (quizDiv && image.triviaData?.question) {
		quizDiv.textContent = image.triviaData.question;
	}

	// --- Render daily quiz options ---
	const optionsUl = document.getElementById('daily-quiz-options');
	if (optionsUl && Array.isArray(image.triviaData?.options)) {
		optionsUl.innerHTML = ''; // clear previous
		image.triviaData.options.forEach(option => {
			const li = document.createElement('li');
			li.className = 'option';

			const a = document.createElement('a');
			a.href = `https://cn.bing.com${option.url}`;
			a.target = '_blank';
			//a.setAttribute('data-h', 'ID=HpApp,28281.1');
			a.setAttribute('aria-label', `Answer: ${option.bullet}`);

			const bullet = document.createElement('span');
			bullet.className = 'bullet';
			bullet.textContent = option.bullet;

			const answer = document.createElement('span');
			answer.className = 'answer';
			answer.textContent = option.text;

			a.append(bullet, answer);
			li.appendChild(a);
			optionsUl.appendChild(li);
		});
	}
	// --- Populate quote of the day blocks ---
	renderQuoteSection(quoteData || null);
}

function updateQuoteOnly(image, quoteCache) {
	if (!image) return;
	renderQuoteSection(getQuoteForImage(image, quoteCache));
}

async function refreshCurrentQuoteFromStorage() {
	const images = readConf('bing_images');
	if (!Array.isArray(images) || images.length === 0) return;
	// quotesUpdated can arrive before this page's confCache sees storage.onChanged.
	// Fresh-read the quote state written by background before repainting.
	const quoteCache = getCachedQuotesFromState(await readStorageKey('cache_quote_state'));
	let image = null;
	if (currentImageDate) {
		if (normalizeQuoteForRender(quoteCache[currentImageDate])) {
			clearTransientQuote(currentImageDate);
		}
		image = images.find(img => img && img.isoDate === currentImageDate) || null;
	}
	//TODO: Remove fallback to current index once we have a more robust way to correlate quote updates with the correct image
	//Bug Fix: An old wallpaper is displayed with the latest quote, but the wallpaper is not changed， probably due to the image is not successfully loaded.
	//TODO: Nicely handle the situation when loading the new wallpaper is interupted by opening a web page, the new image loading is aborted, and the wallpaper_idx is not changed
	if (!image) {
		let idx = readConf('wallpaper_idx');
		idx = Number.parseInt(idx, 10);
		if (!Number.isFinite(idx) || idx < 0 || idx >= images.length) {
			idx = 0;
		}
		image = images[idx];
	}
	updateQuoteOnly(image, quoteCache);
}

chrome.runtime.onMessage.addListener((message) => {
	if (message && message.type === 'quotesUpdated') {
		if (!Array.isArray(message.updatedDates) || message.updatedDates.length === 0) return;
		const activeDate = currentImageDate;
		if (activeDate && message.updatedDates.includes(activeDate)) {
			refreshCurrentQuoteFromStorage().catch((err) => {
				console.error('Failed to refresh quote from storage:', err);
			});
		}
	}
});

// --------------------------------------------------

// init wallpaper
initWallpaper().catch((err) => console.error('initWallpaper() failed:', err));

var left_nav_btn = document.getElementById('leftNav');
left_nav_btn.onclick = switchPrevWallpaper;
var right_nav_btn = document.getElementById('rightNav');
right_nav_btn.onclick = switchNextWallpaper;
