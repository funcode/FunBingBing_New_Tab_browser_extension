// set wallpaper to default
function showDefaultWallpaper() {
	// set wallpaper
	var body = document.getElementById('main-body');
	var wallpaperUrl = readConf('wallpaper_url');
	if (wallpaperUrl) {
		//Use wallpaper_url as the background image
		body.style.backgroundImage = "url('" + wallpaperUrl + "')";
		var wallpaperTitle = readConf("wallpaper_text");
		if (wallpaperTitle) {
			setFooterText(wallpaperTitle);
		}
		setWallpaperContentsFromCache(wallpaperTitle);
		var existingIframe = body.querySelector('iframe[src="newtab.html"]');
		if (existingIframe) {
			body.removeChild(existingIframe);
		}
	}
	else {
		var existingIframe = body.querySelector('iframe[src="newtab.html"]');
		if (!existingIframe) {
			var iframe = document.createElement('iframe');
			iframe.src = 'newtab.html';
			iframe.style.cssText = 'width: 100%; height: 100%; border: none; position: absolute; top: 0; left: 0; z-index: 0;';
			body.appendChild(iframe);
		}
	}
}

// set footer text
function setFooterText(text) {
	var headline_text = document.getElementById('headline');
	headline_text.innerHTML = text;
}

// display loading animation
function showLoadingAnim() {
	var circle = document.getElementById('loading-circle');
	circle.style.display = 'inline-block';
	setFooterText(i18n('updating_wallpaper'));
}

// hide loading animation
function hideLoadingAnim() {
	var circle = document.getElementById('loading-circle');
	circle.style.display = 'none';
}

// pre-load image from url
// then change background image and footer text after loading is finished
function loadAndChangeOnlineWallpaper(url, text, headline) {
	//showDefaultWallpaper();
	hideLoadingAnim();
	setFooterText(i18n('updating_wallpaper'));
	var tmp_img = new Image();
	tmp_img.src = url;
	tmp_img.onload = function () {
		var body = document.getElementById('main-body');
		body.style.backgroundImage = "url('" + url + "')";
		hideLoadingAnim();
		setFooterText(text);
		var headline_link = document.getElementById('headline-link');
		headline_link.href = headline;
		setWallpaperContentsFromCache(text);
		writeConf("wallpaper_date", getDateString());
		writeConf("wallpaper_url", url);
		writeConf("wallpaper_text", text);
		writeConf("headline_link", headline);
		var existingIframe = body.querySelector('iframe[src="newtab.html"]');
		if (existingIframe) {
			body.removeChild(existingIframe);
		}

	};
}

// get latest wallpaper url from bing.com 
// then load and change wallpaper
function updateWallpaper(idx) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (xhr.readyState == 4) {
			var obj = JSON.parse(xhr.responseText);
			var url = 'https://bing.com' + obj.images[0].url;
			// if UHD enabled
			if (readConf('enable_uhd_wallpaper') == 'yes') {
				url = url.replaceAll('1920x1080', 'UHD');
			}

			// Append the filter string to the copyright link
			var headlineLink = obj.images[0].copyrightlink;
			var fullstartdate = obj.images[0].fullstartdate;
			var dateTimeStr = fullstartdate.slice(0, 8) + '_' + fullstartdate.slice(8);
			if (!headlineLink.includes('?')) {
				headlineLink += `?filters=HpDate:"${dateTimeStr}"`;
			} else {
				headlineLink += `&filters=HpDate:"${dateTimeStr}"`;
			}

			loadAndChangeOnlineWallpaper(url, obj.images[0].title, headlineLink);
		}
		else {
			//showDefaultWallpaper();
		}
	}
	var current_lang = window.navigator.language;
	//todo: Save information using https://cn.bing.com/HPImageArchive.aspx?format=js&n=8&mkt=zh-CN' at first
	xhr.open('get', 'https://www.bing.com/HPImageArchive.aspx?format=js&n=1&mkt=' + current_lang + '&idx=' + idx);
	xhr.send(null);
}

// initialize wallpaper on page load
function initWallpaper() {
	// get cache date
	var cache_date = readConf("wallpaper_date");
	if (cache_date == getDateString()) {
		// if today matches cache date, get cache url and text
		var cache_url = readConf("wallpaper_url");
		var cache_text = readConf("wallpaper_text");
		var cache_link = readConf("headline_link");
		if (cache_url && cache_text) {
			loadAndChangeOnlineWallpaper(cache_url, cache_text, cache_link);
		}
		else {
			// cache is broken, update wallpaper
			showDefaultWallpaper();
			updateWallpaper(0);
		}
	}
	else {
		// if today does not match cache date, update wallpaper
		showDefaultWallpaper();
		updateWallpaper(0);
		// get bing image info and write to cache
		getBingImageInfo(null);
		// reset old wallpaper days offset conf
		writeConf("offset_idx", "0");
	}
}

// if user want to show old wallpapers.
function switchPrevWallpaper() {
	var MAX_OLD_DAYS = 8;
	// calculate idx
	var cache_idx = readConf("offset_idx");
	if (cache_idx === "") {
		cache_idx = 0;
	}
	cache_idx = parseInt(cache_idx);
	cache_idx = (cache_idx + 1) % MAX_OLD_DAYS;
	writeConf("offset_idx", cache_idx.toString());
	// reload wallpaper
	updateWallpaper(cache_idx);
}

function switchNextWallpaper() {
	var MAX_OLD_DAYS = 8;
	// calculate idx
	var cache_idx = readConf("offset_idx");
	if (cache_idx === "") {
		cache_idx = 0;
	}
	cache_idx = parseInt(cache_idx);
	cache_idx = (cache_idx - 1 + MAX_OLD_DAYS) % MAX_OLD_DAYS;
	writeConf("offset_idx", cache_idx.toString());
	// reload wallpaper
	updateWallpaper(cache_idx);
}

// set wallpaper download link
function setDownloadLink() {
	var downloadLink = document.getElementById('wallpaper-download-link');
	downloadLink.href = document.getElementById('main-body').style.backgroundImage.replace('url("', '').replace('")', '');
	downloadLink.download = 'bing-wallpaper-' + getDateString();
}

// Fetch wallpaper information of the recent days when the new tab is loaded the first time in a day
function getBingImageInfo(callback) {
	//todo: Fetch headline text of the recent 8 days using HPImageArchive API
	// Fetch wallpaper with descriptions of the recent 8 days
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (xhr.readyState == 4 && xhr.status == 200) {
			try {
				var obj2 = JSON.parse(xhr.responseText);
				if (obj2 && obj2.data && obj2.data.images) {
					var images = obj2.data.images;
					writeConf('bing_images', JSON.stringify(images));
					if (callback) {
						callback(images);
					}
				}
			} catch (e) {
				console.error('Failed to parse the response', e);
			}
		}
	};
	xhr.open('get', 'https://www.bing.com/hp/api/v1/imageoftheday?format=json&mkt=zh-CN');
	xhr.send(null);
	// Fetch quick fact and quiz information from Bing's model API
	var mediaXhr = new XMLHttpRequest();
	mediaXhr.onreadystatechange = function () {
		if (mediaXhr.readyState == 4 && mediaXhr.status == 200) {
			try {
				var mediaObj = JSON.parse(mediaXhr.responseText);
				console.log("MediaContents returned:", mediaObj)
				//todo: Save the 6th item to the 7th position
				var mediaContents = (mediaObj && mediaObj.MediaContents) ? mediaObj.MediaContents.map(function (item) {
					return {
						quickFact: item.ImageContent && item.ImageContent.QuickFact ? item.ImageContent.QuickFact.MainText : undefined,
						triviaId: item.ImageContent && item.ImageContent.TriviaId,
					};
				}) : [];
				console.log("MediaContents saved:", mediaContents);

				var processedCount = 0;
				var totalCount = mediaContents.length;

				if (totalCount === 0) {
					writeConf('bing_media_contents', JSON.stringify(mediaContents));
					return;
				}

				for (var i = 0; i < mediaContents.length; i++) {
					var mediaContent = mediaContents[i];
					var triviaId = mediaContent.triviaId;

					if (!triviaId) {
						processedCount++;
						if (processedCount === totalCount) {
							writeConf('bing_media_contents', JSON.stringify(mediaContents));
						}
						continue;
					}

					(function (contentIndex, currentTriviaId) {
						var triviaXhr = new XMLHttpRequest();
						triviaXhr.onreadystatechange = function () {
							if (triviaXhr.readyState == 4 && triviaXhr.status == 200) {
								try {
									var triviaData = JSON.parse(triviaXhr.responseText);
									mediaContents[contentIndex].triviaData = triviaData.data;
								} catch (e) {
									console.error('Failed to parse trivia data:', e);
								} finally {
									processedCount++;
									if (processedCount === totalCount) {
										writeConf('bing_media_contents', JSON.stringify(mediaContents));
									}
								}
							} else if (triviaXhr.readyState == 4 && triviaXhr.status !== 200) {
								console.error('Failed to fetch trivia data:', triviaXhr.status);
								processedCount++;
								if (processedCount === totalCount) {
									writeConf('bing_media_contents', JSON.stringify(mediaContents));
								}
							}
						};

						triviaXhr.open('get', 'https://cn.bing.com/hp/api/v1/trivia?format=json&id=' + currentTriviaId + '&mkt=zh-CN');
						triviaXhr.send(null);
					})(i, triviaId);
				}
			} catch (e) {
				console.error("Failed to parse MediaContents JSON:", e);
			}
		}
	};
	mediaXhr.open('get', 'https://cn.bing.com/hp/api/model?mkt=zh-CN');
	mediaXhr.send(null);
}

function setWallpaperContentsFromCache(text) {
	var idx = readConf("offset_idx");
	if (typeof idx === 'undefined' || idx === "") {
		idx = 0;
	}
	idx = parseInt(idx);
	var cache_media = readConf("bing_media_contents");
	var media = cache_media ? JSON.parse(cache_media) : [];
	var bing_images = readConf("bing_images");
	if (bing_images) {
		var images = JSON.parse(bing_images);
		setContents(images, media, text, idx);
	}
}

function setContents(images = {}, media = {}, headline = '', idx = 0) {
	// format date as yyyy/mm/dd
	function formatDate(isoDate) {
		if (!isoDate) return '';
		// Support 2025-06-29 或 20250629
		if (/^\d{8}$/.test(isoDate)) {
			return isoDate.slice(0, 4) + '/' + isoDate.slice(4, 6) + '/' + isoDate.slice(6, 8);
		}
		if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
			return isoDate.replace(/-/g, '/');
		}
		return isoDate;
	}
	if (!images) return;
	var contents = {
		text: headline,
		title: images[idx]?.title || '',
		copyright: images[idx]?.copyright || '',
		isoDate: images[idx]?.isoDate || '',
		description: images[idx]?.description || '',
		descriptionPara2: images[idx]?.descriptionPara2 || '',
		descriptionPara3: images[idx]?.descriptionPara3 || ''
	};
	var descDiv = document.getElementById('description');
	if (!descDiv) return;
	// Set the title
	var titleP = descDiv.querySelector('p.title');
	if (titleP) {
		titleP.innerHTML = `${contents.text}&nbsp;|&nbsp;${contents.title} (${contents.copyright})&nbsp;-&nbsp;${formatDate(contents.isoDate)}`;
	}
	// Set the descriptions
	var subSpan = descDiv.querySelector('span.sub');
	if (subSpan) {
		let html = '';
		if (contents.description) html += `<p>${contents.description}</p>`;
		if (contents.descriptionPara2) html += `<p>${contents.descriptionPara2}</p>`;
		if (contents.descriptionPara3) html += `<p>${contents.descriptionPara3}</p>`;
		//todo: Find another place to show the quick fact
		if (media) {
			let quickFact = (media[idx] && media[idx].quickFact) ? media[idx].quickFact : '';
			if (quickFact)
				html += `<p style="font-style: italic;"><svg width="16" height="16" viewBox="0 0 0.48 0.48" fill="#fff" xmlns="http://www.w3.org/2000/svg">
  <path d="M.18.345V.39a.03.03 0 0 0 .03.03h.06A.03.03 0 0 0 .3.39V.349M.24.015v.03m-.21.18h.03m.015-.15.022.021M.45.225H.42M.405.075.383.096M.178.345h.123A.13.13 0 0 0 .374.226.137.137 0 0 0 .24.09a.137.137 0 0 0-.135.135.13.13 0 0 0 .073.12M.24.42v.045m0-.195v.075" stroke="#71717A" stroke-width=".03" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M.195.225.24.271.285.225" stroke="#71717A" stroke-width=".03" stroke-linecap="round" stroke-linejoin="round"/>
</svg>${quickFact}</p>`;
		}
		subSpan.innerHTML = html;
	}
	//Set Bing Quiz
	var quizDiv = document.getElementById('daily-quiz-title');
	if (quizDiv && media && media[idx] && media[idx].triviaData && media[idx].triviaData.question) {
		quizDiv.innerHTML = media[idx].triviaData.question;
	}
	// Render the quzi options
	var optionsUl = document.getElementById('daily-quiz-options');
	if (optionsUl && media && media[idx] && media[idx].triviaData && Array.isArray(media[idx].triviaData.options)) {
		optionsUl.innerHTML = '';
		var options = media[idx].triviaData.options;
		for (var i = 0; i < options.length; i++) {
			var option = options[i];
			var optionLetter = option.bullet;
			var li = document.createElement('li');
			li.className = 'option';
			var a = document.createElement('a');
			a.href = 'https://cn.bing.com' + option.url;
			a.setAttribute('data-h', 'ID=HpApp,28281.1');
			a.target = '_blank';
			a.setAttribute('aria-label', 'Answer: ' + optionLetter);
			var bullet = document.createElement('span');
			bullet.className = 'bullet';
			bullet.textContent = optionLetter;
			var answer = document.createElement('span');
			answer.className = 'answer';
			answer.textContent = option.text;
			a.appendChild(bullet);
			a.appendChild(answer);
			li.appendChild(a);
			optionsUl.appendChild(li);
		}
	}
}

// --------------------------------------------------

// init wallpaper
initWallpaper();

var left_nav_btn = document.getElementById('leftNav');
left_nav_btn.onclick = switchPrevWallpaper;
var right_nav_btn = document.getElementById('rightNav');
right_nav_btn.onclick = switchNextWallpaper;
