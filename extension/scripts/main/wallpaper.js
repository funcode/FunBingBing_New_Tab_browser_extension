// set wallpaper to default
function showDefaultWallpaper() {
	// set wallpaper
	var body = document.getElementById('main-body');
	body.style.backgroundImage = "url('./images/john-reign-abarintos-369080-unsplash.jpg')";
	// set download link
	setDownloadLink();
}

// set footer text
function setFooterText(text) {
	// 直接设置headline内容，无需footer相关逻辑
	var headline_text = document.getElementById('headline');
	headline_text.innerHTML = text;
}

// display loading animation
function showLoadingAnim() {
	var circle = document.getElementById('loading-circle');
	circle.style.display = 'inline-block';
	// 仅设置headline内容，无footer相关逻辑
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
		var cache_idx = readConf("offset_idx");
		if (cache_idx === "") {
			cache_idx = 0;
		}
		var cache_info = readConf("bing_images");
		if (cache_info != "") {
			var images = JSON.parse(cache_info);
			var title = images[cache_idx].title;
			var copyright = images[cache_idx].copyright;
			var description = images[cache_idx].description;
			var descriptionPara2 = images[cache_idx].descriptionPara2;
			var descriptionPara3 = images[cache_idx].descriptionPara3;
			var isoDate = images[cache_idx].isoDate;
			// console.log(cache_idx, title, copyright, description, descriptionPara2, descriptionPara3, isoDate);
			setDescriptions(text, title, copyright, isoDate, description, descriptionPara2, descriptionPara3);
		}

		writeConf("wallpaper_date", getDateString());
		writeConf("wallpaper_url", url);
		writeConf("wallpaper_text", text);
		writeConf("headline_link", headline);
		// setDownloadLink(); // 已无footer相关下载链接
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
		if (cache_url != "" && cache_text != "") {
			loadAndChangeOnlineWallpaper(cache_url, cache_text, cache_link);
		}
		else {
			// cache is broken, update wallpaper
			updateWallpaper(0);
		}
	}
	else {
		// if today does not match cache date, update wallpaper
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

// 获取新版Bing壁纸信息
function getBingImageInfo(callback) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (xhr.readyState == 4 && xhr.status == 200) {
			try {
				var obj2 = JSON.parse(xhr.responseText);
				if (obj2 && obj2.data && obj2.data.images) {
					var images = obj2.data.images;
					// 写入缓存
					writeConf('bing_images', JSON.stringify(images));
					if (callback) {
						callback(images);
					}
				}
			} catch (e) {
				console.error('新版API解析失败', e);
			}
		}
	};
	xhr.open('get', 'https://www.bing.com/hp/api/v1/imageoftheday?format=json&mkt=zh-CN');
	xhr.send(null);
}

// 设置描述信息
function setDescriptions(text, title, copyright, isoDate, description, descriptionPara2, descriptionPara3) {
	// 格式化日期为 yyyy/mm/dd
	function formatDate(isoDate) {
		if (!isoDate) return '';
		// 支持 2025-06-29 或 20250629
		if (/^\d{8}$/.test(isoDate)) {
			return isoDate.slice(0,4) + '/' + isoDate.slice(4,6) + '/' + isoDate.slice(6,8);
		}
		if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
			return isoDate.replace(/-/g, '/');
		}
		return isoDate;
	}
	var descDiv = document.getElementById('description');
	if (!descDiv) return;
	// 设置标题
	var titleP = descDiv.querySelector('p.title');
	if (titleP) {
		titleP.innerHTML = `${text}&nbsp;&nbsp;|&nbsp;&nbsp;${title} (${copyright})&nbsp;&nbsp;-&nbsp;&nbsp;${formatDate(isoDate)}`;
	}
	// 设置副描述
	var subSpan = descDiv.querySelector('span.sub');
	if (subSpan) {
		let html = '';
		if (description) html += `<p>\n${description}\n</p>`;
		if (descriptionPara2) html += `<p>\n${descriptionPara2}\n</p>`;
		if (descriptionPara3) html += `<p>\n${descriptionPara3}\n</p>`;
		subSpan.innerHTML = html;
	}
}

// --------------------------------------------------

// init wallpaper
initWallpaper();

var left_nav_btn = document.getElementById('leftNav');
left_nav_btn.onclick = switchPrevWallpaper;
var right_nav_btn = document.getElementById('rightNav');
right_nav_btn.onclick = switchNextWallpaper;
