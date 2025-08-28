// set wallpaper to default
function showDefaultWallpaper() {
	// set wallpaper
	var body = document.getElementById('main-body');
	var wallpaperUrl = readConf('wallpaper_url');
	if (wallpaperUrl) {
		//Use wallpaper_url as the background image
		body.style.backgroundImage = "url('" + wallpaperUrl + "')";
		var bing_images = readConf("bing_images");
		var idx = readConf("wallpaper_idx");
		idx = parseInt(idx);
		if (bing_images && Array.isArray(bing_images) && bing_images.length > 0) {
			bing_images = JSON.parse(bing_images);
			if (idx >= bing_images.length) {
				idx = 0;
			}
			setContents(bing_images[idx]);
		}
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

/* // hide loading animation
function hideLoadingAnim() {
	var circle = document.getElementById('loading-circle');
	circle.style.display = 'none';
} */

// pre-load image from url
// then change background image and footer text after loading is finished
function changeWallpaper(idx) {
	//showDefaultWallpaper();
	// hideLoadingAnim();
	var images = readConf("bing_images");
	images = images ? JSON.parse(images) : null;
	if (!images || !Array.isArray(images) || images.length === 0) {
		showDefaultWallpaper();
		return;
	}
	// Ensure idx is within bounds
	if (idx >= images.length) {
		idx = 0;
	}
	var image = images[idx];
	var imgurl = '';
	var baseurl = 'https://bing.com';
	if (readConf('enable_uhd_wallpaper') == 'yes') {
		imgurl = baseurl + image.imageUrls.landscape.ultraHighDef;
	} else {
		imgurl = baseurl + image.imageUrls.landscape.highDef;
	}
	setFooterText(i18n('updating_wallpaper'));
	var tmp_img = new Image();
	tmp_img.src = imgurl;
	tmp_img.onload = function () {
		var body = document.getElementById('main-body');
		body.style.backgroundImage = "url('" + imgurl + "')";
		//hideLoadingAnim();
		setContents(image);
		writeConf("wallpaper_date", getDateString());
		writeConf("wallpaper_url", imgurl);
		writeConf("wallpaper_text", image.headline);
		var existingIframe = body.querySelector('iframe[src="newtab.html"]');
		if (existingIframe) {
			body.removeChild(existingIframe);
		}
	};
}

// get latest wallpaper url from bing.com 
// then load and change wallpaper
function updateWallpaper(idx) {
	try {
		changeWallpaper(idx);
	} catch (e) {
		console.error('Failed to parse bing_images from config:', e);
		showDefaultWallpaper();
	}
}

// initialize wallpaper on page load
function initWallpaper() {
	// get cache date
	var cache_date = readConf("wallpaper_date");
	if (cache_date == getDateString()) {
		// if today matches cache date, get cache url and text
		var cache_idx = readConf("wallpaper_idx");
		if (cache_idx) {
			changeWallpaper(parseInt(cache_idx));
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
		// get bing image info and write to cache
		collectBingDataInParallel(handleBingDataResults,updateWallpaper);
		
		// reset old wallpaper days offset conf
		writeConf("wallpaper_idx", "0");
	}
}

// Collect data from multiple Bing APIs in parallel
function collectBingDataInParallel(callback, updateWallpaper) {
	var completedRequests = 0;
	var totalRequests = 3;
	var results = {
		imageArchive: null,
		imageOfTheDay: null,
		model: null,
		errors: []
	};

	// Function to handle completion of individual requests
	function handleRequestCompletion() {
		completedRequests++;
		if (completedRequests === totalRequests && callback) {
			callback(results,updateWallpaper);
		}
	}

	// Request 1: HPImageArchive API (8 days of wallpaper data)
	var xhr1 = new XMLHttpRequest();
	xhr1.onreadystatechange = function () {
		if (xhr1.readyState === 4) {
			if (xhr1.status === 200) {
				try {
					results.imageArchive = JSON.parse(xhr1.responseText);
				} catch (e) {
					results.errors.push('Failed to parse HPImageArchive response: ' + e.message);
				}
			} else {
				results.errors.push('HPImageArchive request failed with status: ' + xhr1.status);
			}
			handleRequestCompletion();
		}
	};
	// Only need the 8th image from this API. Others are retrieved by xhr2
	xhr1.open('GET', 'https://www.bing.com/HPImageArchive.aspx?format=js&n=1&mkt=zh-CN&idx=7');
	xhr1.send();

	// Request 2: Image of the Day API
	var xhr2 = new XMLHttpRequest();
	xhr2.onreadystatechange = function () {
		if (xhr2.readyState === 4) {
			if (xhr2.status === 200) {
				try {
					results.imageOfTheDay = JSON.parse(xhr2.responseText);
				} catch (e) {
					results.errors.push('Failed to parse imageOfTheDay response: ' + e.message);
				}
			} else {
				results.errors.push('ImageOfTheDay request failed with status: ' + xhr2.status);
			}
			handleRequestCompletion();
		}
	};
	xhr2.open('GET', 'https://www.bing.com/hp/api/v1/imageoftheday?format=json&mkt=zh-CN');
	xhr2.send();

	// Request 3: Model API
	var xhr3 = new XMLHttpRequest();
	xhr3.onreadystatechange = function () {
		if (xhr3.readyState === 4) {
			if (xhr3.status === 200) {
				try {
					results.model = JSON.parse(xhr3.responseText);
					var mediaObj = results.model;
					console.log("MediaContents returned:", mediaObj)
					//todo: Save the 6th item to the 7th position
					var mediaContents = (mediaObj && mediaObj.MediaContents) ? mediaObj.MediaContents.map(function (item) {
						return {
							headline: item.ImageContent && item.ImageContent.Headline ? item.ImageContent.Headline : undefined,
							quickFact: item.ImageContent && item.ImageContent.QuickFact ? item.ImageContent.QuickFact.MainText : undefined,
							triviaId: item.ImageContent && item.ImageContent.TriviaId,
							ssd: item.ssd ? item.ssd : undefined
						};
					}) : [];
					console.log("MediaContents saved:", mediaContents);

					var processedCount = 0;
					var totalCount = mediaContents.length;

					if (totalCount === 0) {
						results.processedMediaContents = mediaContents;
						handleRequestCompletion();
						return;
					}

					for (var i = 0; i < mediaContents.length; i++) {
						var mediaContent = mediaContents[i];
						var triviaId = mediaContent.triviaId;

						if (!triviaId) {
							processedCount++;
							if (processedCount === totalCount) {
								results.processedMediaContents = mediaContents;
								handleRequestCompletion();
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
											results.processedMediaContents = mediaContents;
											handleRequestCompletion();
										}
									}
								} else if (triviaXhr.readyState == 4 && triviaXhr.status !== 200) {
									console.error('Failed to fetch trivia data:', triviaXhr.status);
									processedCount++;
									if (processedCount === totalCount) {
										results.processedMediaContents = mediaContents;
										handleRequestCompletion();
									}
								}
							};

							triviaXhr.open('get', 'https://www.bing.com/hp/api/v1/trivia?format=json&id=' + currentTriviaId + '&mkt=zh-CN');
							triviaXhr.send(null);
						})(i, triviaId);
					}
				} catch (e) {
					results.errors.push('Failed to parse model response: ' + e.message);
					console.error("Failed to parse MediaContents JSON:", e);
					handleRequestCompletion();
				}
			} else {
				results.errors.push('Model request failed with status: ' + xhr3.status);
				handleRequestCompletion();
			}
		}
	};
	xhr3.open('GET', 'https://www.bing.com/hp/api/model?mkt=zh-CN');
	xhr3.send();
}

// Callback function to handle collectBingDataInParallel results
function handleBingDataResults(results,updateWallpaper) {
	console.log('Parallel data collection completed:', results);
	// Save HPImageArchive data (only 8th day of wallpaper data)
	/* 	if (results.imageArchive && results.imageArchive.images) {
			writeConf('bing_archive_images', JSON.stringify(results.imageArchive.images));
			console.log('Saved HPImageArchive data');
		} */
	// Process and merge Image of the Day data with media contents
	if (results.imageOfTheDay && results.imageOfTheDay.data && results.imageOfTheDay.data.images) {
		var images = results.imageOfTheDay.data.images;
		// Iterate through images and merge with processedMediaContents if available
		for (var idx = 0; idx < images.length; idx++) {
			if (results.processedMediaContents && results.processedMediaContents[idx]) {
				var mediaContent = results.processedMediaContents[idx];
				// Add headline if it exists
				if (mediaContent.headline) {
					images[idx].headline = mediaContent.headline;
				}
				// Add quickFact if it exists
				if (mediaContent.quickFact) {
					images[idx].quickFact = mediaContent.quickFact;
				}
				// Add triviaId if it exists (note: corrected spelling from "traviaId")
				if (mediaContent.triviaId) {
					images[idx].triviaId = mediaContent.triviaId;
				}
				// Add triviaData if it exists (note: corrected spelling from "traviaData")
				if (mediaContent.triviaData) {
					images[idx].triviaData = mediaContent.triviaData;
				}
			}
		}
		// Steal from HPImageArchive.images[7]
		var triviaCompleted = false;
		var quickFactsCompleted = false;

		function checkCompletion() {
			console.log('Checking completion: triviaCompleted=', triviaCompleted, ', quickFactsCompleted=', quickFactsCompleted);
			if (triviaCompleted && quickFactsCompleted) {
				writeConf('bing_images', JSON.stringify(images));
				console.log('Saved bing_images data with merged contents.');
				updateWallpaper(0);
			}
		}

		// Execute handleTriviaData with completion tracking
		(function () {
			if (results.imageArchive && results.imageArchive.images) {
				var idx = images.length - 1;
				images[idx].headline = results.imageArchive.images[0].title;
				images[idx].triviaId = results.imageArchive.images[0].quiz;
				// Extract and modify triviaId
				if (images[idx].triviaId) {
					var match = images[idx].triviaId.match(/HPQuiz_\d{8}_([^%]+)/);
					if (match && images[idx].isoDate) {
						var quizName = match[1];
						images[idx].triviaId = 'HPQuiz_' + images[idx].isoDate + '_' + quizName;

						// Fetch trivia data using the same pattern as collectBingDataInParallel
						(function (imageIndex, currentTriviaId) {
							var triviaXhr = new XMLHttpRequest();
							triviaXhr.onreadystatechange = function () {
								if (triviaXhr.readyState == 4 && triviaXhr.status == 200) {
									try {
										var triviaData = JSON.parse(triviaXhr.responseText);
										images[imageIndex].triviaData = triviaData.data;
									} catch (e) {
										console.error('Failed to parse trivia data:', e);
									} finally {
										triviaCompleted = true;
										checkCompletion();
										console.log('Updated trivia data for image index:', imageIndex);
									}
								} else if (triviaXhr.readyState == 4 && triviaXhr.status !== 200) {
									console.error('Failed to fetch trivia data:', triviaXhr.status);
								}
							};

							triviaXhr.open('get', 'https://www.bing.com/hp/api/v1/trivia?format=json&id=' + currentTriviaId + '&mkt=zh-CN');
							triviaXhr.send(null);
						})(idx, images[idx].triviaId);
					}
				}
			}
		})();

		// Execute handleQuickFacts with completion tracking
		(function () {
			var lastQuickFactConfig = readConf("last_quick_fact");
			var lastQuickFact = lastQuickFactConfig ? JSON.parse(lastQuickFactConfig) : null;
			// Get the quick fact from the last item of processedMediaContents
			var oldestQuickFact = {};
			if (results.processedMediaContents && results.processedMediaContents.length > 0) {
				var lastMediaContent = results.processedMediaContents[results.processedMediaContents.length - 1];
				oldestQuickFact = {
					"date": parseInt(lastMediaContent.ssd),
					"quickfact": lastMediaContent.quickFact
				};
			}
			// If last_quick_fact doesn't exist, initialize it and exit
			if (!lastQuickFact) {
				if (oldestQuickFact) {
					var newLastQuickFact = {
						"7th": oldestQuickFact,
						"8th": {
							"date": 0,
							"quickfact": ""
						}
					};
					writeConf("last_quick_fact", JSON.stringify(newLastQuickFact));
					console.log('Initialized last_quick_fact config');
				}
			} else {
				// Check if 7th.date equals isoDate of the 7th image (index 6, which is images.length - 2)
				var lastImageDate = parseInt(images[images.length - 1].isoDate);

				if (lastQuickFact["7th"] && lastQuickFact["7th"].date === lastImageDate) {
					// Save "7th" to "8th" first
					lastQuickFact["8th"] = lastQuickFact["7th"];
				} else {
					lastQuickFact["8th"] = {
						"date": 0,
						"quickfact": ""
					};
				}
				// Save current quick fact as "7th"
				if (oldestQuickFact) {
					lastQuickFact["7th"] = oldestQuickFact;
				}
				writeConf("last_quick_fact", JSON.stringify(lastQuickFact));
				console.log('Updated last_quick_fact config');
			}
			images[images.length - 1].quickFact = lastQuickFact ? lastQuickFact["8th"].quickfact : "";
			quickFactsCompleted = true;
			checkCompletion();
		})();
	}
	// Save processed media contents with trivia data
/* 	if (results.processedMediaContents) {
		writeConf('bing_media_contents', JSON.stringify(results.processedMediaContents));
		console.log('Saved processed media contents with trivia data');
	} */
	// Save raw model data as backup
	/* 	if (results.model) {
			writeConf('bing_model_data', JSON.stringify(results.model));
			console.log('Saved raw model data');
		} */

	// Log any errors that occurred
	if (results.errors && results.errors.length > 0) {
		console.error('Errors during parallel data collection:', results.errors);
		writeConf('bing_data_errors', JSON.stringify(results.errors));
	}
	console.log('All Bing data saved to configuration successfully');

}

// if user want to show old wallpapers.
function switchPrevWallpaper() {
	var MAX_OLD_DAYS = 8;
	// calculate idx
	var cache_idx = readConf("wallpaper_idx");
	if (!cache_idx) {
		cache_idx = 0;
	}
	cache_idx = parseInt(cache_idx);
	cache_idx = (cache_idx + 1) % MAX_OLD_DAYS;
	writeConf("wallpaper_idx", cache_idx.toString());
	// reload wallpaper
	updateWallpaper(cache_idx);
}

function switchNextWallpaper() {
	var MAX_OLD_DAYS = 8;
	// calculate idx
	var cache_idx = readConf("wallpaper_idx");
	if (!cache_idx) {
		cache_idx = 0;
	}
	cache_idx = parseInt(cache_idx);
	cache_idx = (cache_idx - 1 + MAX_OLD_DAYS) % MAX_OLD_DAYS;
	writeConf("wallpaper_idx", cache_idx.toString());
	// reload wallpaper
	updateWallpaper(cache_idx);
}

// set wallpaper download link
function setDownloadLink() {
	var downloadLink = document.getElementById('wallpaper-download-link');
	downloadLink.href = document.getElementById('main-body').style.backgroundImage.replace('url("', '').replace('")', '');
	downloadLink.download = 'bing-wallpaper-' + getDateString();
}

function setContents(image) {
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
	if (!image) return;

	setFooterText(image.headline);
	var headline_link = document.getElementById('headline-link');
	var baseurl = 'https://bing.com';
	headline_link.href = baseurl + image.clickUrl;

	var contents = {
		text: image.headline || '',
		title: image.title || '',
		copyright: image.copyright || '',
		isoDate: image.isoDate || '',
		description: image.description || '',
		descriptionPara2: image.descriptionPara2 || '',
		descriptionPara3: image.descriptionPara3 || ''
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
		// Set quick fact
		let quickFact = (image.quickFact) ? image.quickFact : '';
		if (quickFact) {
			// The svg icon seems smaller on Mac
			var isWindows = navigator.userAgentData
				? navigator.userAgentData.platform.toLowerCase().indexOf('win') === 0
				: navigator.userAgent.toLowerCase().indexOf('windows') !== -1;
			var svgSize = isWindows ? { w: 16, h: 16 } : { w: 24, h: 24 };
			html += `<p style="font-style: italic;"><svg fill="#fff" width="${svgSize.w}" height="${svgSize.h}" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
<path d="M21.5 20a.488.488 0 0 0-.443.717l.99 1.984c.28.63 1.214.163.883-.44l-.99-1.985a.49.49 0 0 0-.44-.275zM6.49 7c-.48 0-.7.722-.226.946l1.992.984c.606.33 1.075-.6.443-.88l-1.993-.985A.44.44 0 0 0 6.49 7M30 10.5c0 .277-.223.5-.5.5h-2a.499.499 0 1 1 0-1h2c.277 0 .5.223.5.5M17.5 0c.277 0 .5.223.5.5v2a.499.499 0 1 1-1 0v-2c0-.277.223-.5.5-.5m-5.092 4.03c-.25-.05-.537-.055-.803.1-.265.153-.402.41-.476.655-.075.244-.1.5-.103.777-.007.554.072 1.19.162 1.834s.194 1.293.25 1.82c.1.954-.185 1.214-.75 1.696-.413.354-.986.707-1.528 1.092-.542.384-1.072.774-1.477 1.162a3 3 0 0 0-.503.605c-.13.22-.23.497-.157.8s.283.505.496.645c.215.14.457.24.726.328.538.176 1.19.3 1.852.416.662.114 1.333.217 1.873.333.952.205 1.16.507 1.46 1.217.207.49.393 1.123.605 1.74s.43 1.222.69 1.715c.13.246.266.467.44.652.176.186.412.354.716.38.305.025.562-.102.766-.255.205-.153.38-.345.55-.566.343-.442.667-1.002.986-1.574s.63-1.155.908-1.614c.41-.83.91-.906 1.66-.96.552-.023 1.23-.013 1.904-.016s1.337-.02 1.9-.104c.28-.042.536-.1.77-.2.235-.103.475-.263.6-.548s.077-.576-.012-.814c-.09-.24-.226-.46-.39-.684-.33-.45-.78-.92-1.247-1.39-.465-.468-.946-.933-1.312-1.33-.672-.697-.63-.89-.38-1.63.18-.51.446-1.13.698-1.75.254-.618.495-1.232.626-1.78.066-.272.107-.528.092-.786s-.098-.554-.342-.758c-.243-.204-.528-.24-.79-.232-.263.007-.53.062-.82.142-.574.16-1.226.428-1.88.71-.654.28-1.312.622-1.855.837-.864.366-1.314.245-2.01-.158-.46-.295-1.003-.8-1.55-1.18-.547-.378-1.09-.802-1.596-1.052a3 3 0 0 0-.746-.274zm.303 1.17c.414.205.936.61 1.472.98s1.082.88 1.58 1.2c.497.317.895.582 1.39.624.498.042.947-.15 1.528-.38.58-.23 1.24-.57 1.883-.847.64-.276 1.27-.53 1.753-.666.625-.206.684.066.618.44-.105.438-.33 1.027-.58 1.634-.246.606-.515 1.233-.713 1.79-.198.56-.38.873-.255 1.39.117.49.446.825.844 1.255.396.43.88.897 1.334 1.357.456.46.885.913 1.15 1.277.416.526-.094.626-.31.666-.46.07-1.096.088-1.756.092-.66.003-1.343-.007-1.94.017-.595.023-1.072.03-1.503.28s-.67.66-.97 1.16c-.303.497-.615 1.085-.926 1.645-.313.56-.628 1.093-.904 1.45-.406.435-.565.354-.795-.063-.207-.396-.422-.973-.63-1.576-.207-.603-.408-1.237-.617-1.778-.208-.54-.37-.983-.752-1.304-.382-.32-.85-.407-1.432-.53-.583-.122-1.26-.226-1.908-.34-.65-.113-1.27-.248-1.71-.382-.667-.203-.372-.528-.18-.705.33-.31.83-.69 1.36-1.067.53-.376 1.09-.757 1.56-1.115.467-.358.85-.63 1.054-1.092.202-.46.14-.925.082-1.5-.06-.574-.167-1.226-.256-1.855-.09-.63-.16-1.24-.153-1.682-.027-.45.232-.576.684-.375zM10.5 17a.5.5 0 0 0-.343.15L.64 26.652c-.895.893-.776 2.134-.105 2.81.672.674 1.913.795 2.81-.103l9.49-9.49c.492-.472-.25-1.182-.706-.708l-9.49 9.49c-.58.58-1.07.43-1.396.104-.325-.328-.47-.826.102-1.397l9.518-9.503c.325-.318.083-.857-.364-.857z"/>
</svg>${quickFact}</p>`;
		}
		subSpan.innerHTML = html;
	}
	//Set Bing Quiz
	var quizDiv = document.getElementById('daily-quiz-title');
	if (quizDiv && image.triviaData && image.triviaData.question) {
		quizDiv.innerHTML = image.triviaData.question;
	}
	// Render the quzi options
	var optionsUl = document.getElementById('daily-quiz-options');
	if (optionsUl && image.triviaData && Array.isArray(image.triviaData.options)) {
		optionsUl.innerHTML = '';
		var options = image.triviaData.options;
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
