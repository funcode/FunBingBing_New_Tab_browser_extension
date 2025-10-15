const WALLPAPER_CACHE_NAME = 'funbingbing-wallpaper-cache-v1';
let currentWallpaperObjectUrl = null;

function revokeCurrentWallpaperObjectUrl() {
	if (currentWallpaperObjectUrl) {
		URL.revokeObjectURL(currentWallpaperObjectUrl);
		currentWallpaperObjectUrl = null;
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

async function applyWallpaperFromBlob(blob, originalUrl, image) {
	const body = document.getElementById('main-body');
	if (!body) return;
	const objectUrl = URL.createObjectURL(blob);
	revokeCurrentWallpaperObjectUrl();
	currentWallpaperObjectUrl = objectUrl;
	body.style.backgroundImage = `url('${objectUrl}')`;
	setContents(image);
	writeConf('wallpaper_url', originalUrl);
	const existingIframe = body.querySelector('iframe[src="newtab.html"]');
	if (existingIframe) {
		body.removeChild(existingIframe);
	}
}

// set wallpaper to default
async function showDefaultWallpaper() {
	function loadNewTabIframe() {
		revokeCurrentWallpaperObjectUrl();
		let existingIframe = body.querySelector('iframe[src="newtab.html"]');
		if (!existingIframe) {
			existingIframe = document.createElement('iframe');
			existingIframe.src = 'newtab.html';
			existingIframe.style.cssText = 'width: 100%; height: 100%; border: none; position: absolute; top: 0; left: 0; z-index: 0;';
			body.appendChild(existingIframe);
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
					loadNewTabIframe();
				}
			}
			const blob = await fetchWallpaperBlob(wallpaperUrl);
			await applyWallpaperFromBlob(blob, wallpaperUrl, imageForContent);
			return;
		} catch (err) {
			console.error('Failed to load cached wallpaper via Cache Storage:', err);
		}
	}
	loadNewTabIframe();
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
		return;
	}
	if (!Number.isFinite(idx) || idx < 0) {
		idx = 0;
	}
	if (idx >= images.length) {
		idx = 0;
	}
	const image = images[idx];
	const baseurl = 'https://cn.bing.com';
	const landscape = image?.imageUrls?.landscape;
	const path = readConf('enable_uhd_wallpaper') == 'yes'
		? landscape?.ultraHighDef
		: landscape?.highDef;
	const imgurl = path ? baseurl + path : null;
	if (!imgurl) {
		console.warn('Unable to resolve wallpaper URL for index', idx);
		await showDefaultWallpaper();
		return;
	}
	try {
		const blob = await fetchWallpaperBlob(imgurl);
		await applyWallpaperFromBlob(blob, imgurl, image);
	} catch (error) {
		console.error('Failed to load wallpaper image:', error);
		await showDefaultWallpaper();
	}
}

// get latest wallpaper url from bing.com 
// then load and change wallpaper
async function updateWallpaper(idx) {
	try {
		await changeWallpaper(idx);
		writeConf('wallpaper_idx', idx.toString());
	} catch (e) {
		console.error('Failed to update wallpaper:', e);
		await showDefaultWallpaper();
	}
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
		// No cache match, fetch new data		
		setFooterText(i18n('updating_wallpaper'));
		await showDefaultWallpaper();
		try {
			const results = await collectBingDataInParallel();
			await handleBingDataResults(results);
			await updateWallpaper(0); // guaranteed after data + writeConf
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
			fetch("https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN", {
				"body": null,
				"method": "GET",
				"mode": "cors",
				"cache": 'no-store',
				"credentials": "include"
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
		return;
	}

	// --- Async task: Handle Quote of the Day ---
	const quoteTask = async () => {
		images[0].quoteData = {
			text: '',
			source: i18n('quote_of_the_day_search'),
			link: 'https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN',
			caption: ''
		};
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
			'.qotd_quote'
			]);
			const text = textElement ? textElement.textContent.trim() : null;

			const authorElement = selectFirst(doc, [
			'#bt_qotdText .bt_author .b_mText a',
			'.qotd_author a'
			]);
			const author = authorElement ? authorElement.textContent.trim() : null;
			const authorHref = authorElement ? authorElement.getAttribute('href') : '';

			const captionElement = selectFirst(doc, [
			'#bt_qotdText .bt_authorCaption',
			'.qotd_desc'
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
					images[0].quoteData = {
						text: quoteText,
						source: authorText,
						link: authorHref,
						caption: authorCaption
					};
				}
			} catch (e) {
				console.error("Error parsing quote of the day HTML:", e);
			}
		} else {//Fallback: request from background.js
/* 			chrome.runtime.sendMessage({ type: "getQuote" }, (response) => {
				if (chrome.runtime.lastError) {
					console.debug('getQuote message had no response:', chrome.runtime.lastError.message);
					return;
				}
				console.log('Received quote response:', response);
				if (response) {
					images[0].quoteData = response;
				} 
			}); */
		}

		// Function to cache a new quote and backfill others
		function addQuote(key, value) {
			// Quotes storage (main data)
			let allQuotes = readConf("cache_quote_of_the_day") || {};

			// Helper object (circular buffer for keys)
			let tracker = readConf("cache_quote_tracker") || {
				last: 0, // points to the most recently used slot
				"1": null, "2": null, "3": null, "4": null,
				"5": null, "6": null, "7": null, "8": null
			};

			// If today's quote is new and valid, add it and manage the cache
			if (value && value.text && !allQuotes[key]) {
				// Advance "last" in circular fashion
				tracker.last = (tracker.last % 8) + 1; 
				const slot = tracker.last;
				const oldKey = tracker[slot];

				// If there was an old key in this slot, delete it
				if (oldKey && allQuotes[oldKey]) {
					delete allQuotes[oldKey];
				}

				// Store new quote
				allQuotes[key] = value;
				// Update tracker slot with the new key
				tracker[slot] = key;
				
				writeConf("cache_quote_tracker", tracker);
				writeConf("cache_quote_of_the_day", allQuotes);
			}
			let lostQuotes = {};
			// Backfill quoteData for other images from the full cache
			for (let i = 0; i < images.length; i++) {
				const date = images[i].isoDate;
				if (allQuotes[date]) {
					images[i].quoteData = allQuotes[date];
				}else if(i>0||!images[i].quoteData.text){
					lostQuotes[date] = true;
				}
			}
			if(Object.keys(lostQuotes).length>0){
				writeConf("lost_quotes",Object.keys(lostQuotes));
				chrome.runtime.sendMessage({ type: "getLostQuotes", dates: Object.keys(lostQuotes) }, (response) => {
					if (chrome.runtime.lastError) {
						console.debug('getLostQuotes message had no response:', chrome.runtime.lastError.message);
						return;
					}
					console.log('Received lost quotes response:', response);
					if (response) {
						writeConf("s3_quote_of_the_day", { response });
					}
				});
			}
			// Also backfill today's quote if it was missing text
			// This can happen if scraping failed (may due to clearing the browser cache)
			// but we have a cached quote
/* 			const today = images[0].isoDate;
			if ((!images[0].quoteData || !images[0].quoteData.text) && allQuotes[today]) {
				images[0].quoteData = allQuotes[today];
			} */
		}

		addQuote(images[0].isoDate, images[0].quoteData);
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

	// --- Execute both async tasks in parallel ---
	await Promise.all([triviaFetch(), quickFactsUpdate(), quoteTask()]);

	// --- Save merged images ---
	writeConf("bing_images", images);
	writeConf("wallpaper_date", images[0].isoDate);
	console.log("Saved bing_images with merged contents.");

	// --- Log errors ---
	if (results.errors?.length > 0) {
		console.error("Errors during parallel data collection:", results.errors);
		writeConf("bing_data_errors", results.errors);
	}
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

function setContents(image) {
	if (!image) return;

	// --- Format date helper ---
	const formatDate = (isoDate) => {
		if (!isoDate) return '';
		if (/^\d{8}$/.test(isoDate)) return `${isoDate.slice(0, 4)}/${isoDate.slice(4, 6)}/${isoDate.slice(6, 8)}`;
		if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate.replace(/-/g, '/');
		return isoDate;
	};

	// --- Set footer and headline link ---
	setFooterText(image.headline);
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
			a.setAttribute('data-h', 'ID=HpApp,28281.1');
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
	if (image.quoteData) {
		// Normalize and wrap quote text with curly quotes
		const qt = document.getElementById('quote-text');
		const qf = document.getElementById('quote-full-text');
		if (image.quoteData.text) {
			let raw = image.quoteData.text.trim();
			// Remove any existing wrapping straight or curly quotes to prevent doubling
			if (/^["'“”‘’].+["'“”‘’]$/.test(raw)) {
				// Strip only one level if first and last are quote-like
				const first = raw[0];
				const last = raw[raw.length - 1];
				if (/["'“”‘’]/.test(first) && /["'“”‘’]/.test(last)) {
					raw = raw.substring(1, raw.length - 1).trim();
				}
			}
			const wrapped = `“${raw}”`;
			if (qt) qt.textContent = wrapped;
			if (qf) qf.textContent = wrapped;
			document.getElementById('quote-source-link').removeEventListener('click', handleQuoteLinkClick);
		}
		else if (qt) {
			function handleQuoteLinkClick() {
				//Refetch data when opening a new tab
				localStorage.removeItem('wallpaper_date');
			}
			document.getElementById('quote-source-link').addEventListener('click', handleQuoteLinkClick);
		}
		const qsLinkElem = document.getElementById('quote-source-link');
		if (qsLinkElem) {
			if (image.quoteData.source) {
				qsLinkElem.textContent = image.quoteData.source;
				qsLinkElem.style.display = 'inline';
			} else {
				qsLinkElem.textContent = '';
				qsLinkElem.style.display = 'none';
			}
			// Manage navigable link attributes
			let href = image.quoteData.link;
			if (!href && image.quoteData.source) {
				const encodedSource = encodeURIComponent(image.quoteData.source);
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
		const qc = document.getElementById('quote-caption');
		if (qc && image.quoteData.caption) qc.textContent = image.quoteData.caption || '';

	}
}

// --------------------------------------------------

// init wallpaper
initWallpaper().catch((err) => console.error('initWallpaper() failed:', err));

var left_nav_btn = document.getElementById('leftNav');
left_nav_btn.onclick = switchPrevWallpaper;
var right_nav_btn = document.getElementById('rightNav');
right_nav_btn.onclick = switchNextWallpaper;