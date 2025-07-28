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
				html += `<p style="font-style: italic;"><svg width="16" height="16" viewBox="0 0 0.6 0.6" fill="#fff" xmlns="http://www.w3.org/2000/svg">
  <path d="M.43.4a.01.01 0 0 0-.009.014l.02.04C.447.467.465.457.459.445l-.02-.04A.01.01 0 0 0 .43.399zM.13.14C.12.14.116.154.125.159l.04.02C.177.186.186.167.174.161l-.04-.02zM.6.21Q.6.22.59.22H.55a.01.01 0 1 1 0-.02h.04Q.6.2.6.21M.35 0q.01 0 .01.01v.04a.01.01 0 1 1-.02 0V.01Q.34 0 .35 0M.248.081a.02.02 0 0 0-.016.002.03.03 0 0 0-.01.013Q.219.103.22.112l.003.037.005.036C.23.204.224.209.213.219L.182.241l-.03.023-.01.012Q.137.283.139.292c.002.009.006.01.01.013l.015.007.037.008.037.007c.019.004.023.01.029.024l.012.035.014.034.009.013a.03.03 0 0 0 .014.008q.009 0 .015-.005L.342.425l.02-.031L.38.362C.388.345.398.344.413.343h.038q.02 0 .038-.002L.504.337Q.511.335.516.326C.521.317.518.314.516.31L.508.296.483.268.457.241C.444.227.444.223.449.208L.463.173.476.137.478.121A.02.02 0 0 0 .471.106.03.03 0 0 0 .455.101L.439.104.401.118.364.135C.347.142.338.14.324.132L.293.108Q.276.095.261.087L.246.082zm.006.023q.013.007.029.02c.016.013.022.018.032.024q.014.01.028.012.014 0 .031-.008L.412.135.447.122C.46.118.461.123.459.131Q.455.145.447.164L.433.2C.429.211.425.217.428.228q.004.014.017.025L.472.28q.014.014.023.026C.503.317.493.319.489.319L.454.321H.415q-.017 0-.03.006C.372.333.372.34.366.35L.347.383.329.412Q.319.424.313.411L.3.379.288.343Q.283.326.273.317.261.309.244.306L.206.299.172.291C.159.287.165.28.168.277L.195.256.226.234Q.24.224.247.212.252.199.249.182L.244.145.241.111q0-.014.014-.007zM.21.34.203.343l-.19.19C-.005.551-.003.576.011.589A.04.04 0 0 0 .067.587l.19-.19C.267.388.252.373.243.383l-.19.19C.041.585.032.582.025.575Q.013.564.027.547l.19-.19C.224.351.219.34.21.34"/>
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
