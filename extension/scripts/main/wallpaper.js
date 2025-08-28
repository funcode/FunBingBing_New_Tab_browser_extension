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

// --- Main entry point ---
async function initWallpaper() {
  const cache_date = readConf("wallpaper_date");

  if (cache_date == getDateString()) {
    // Cached wallpaper for today
    const cache_idx = readConf("wallpaper_idx");
    if (cache_idx) {
      changeWallpaper(parseInt(cache_idx));
    } else {
      showDefaultWallpaper();
      updateWallpaper(0);
    }
  } else {
    // No cache match, fetch new data
    showDefaultWallpaper();

    try {
      const results = await collectBingDataInParallel();
      await handleBingDataResults(results);
      updateWallpaper(0); // guaranteed after data + writeConf
    } catch (err) {
      console.error("Error initializing wallpaper:", err);
      updateWallpaper(0); // fallback
    }

    // reset old wallpaper days offset conf
    writeConf("wallpaper_idx", "0");
  }
}

// --- Collect Bing Data (with fetch) ---
async function collectBingDataInParallel() {
  const results = { imageArchive: null, imageOfTheDay: null, model: null, errors: [] };

  try {
    // Kick off all 3 requests in parallel
    const [archiveRes, dayRes, modelRes] = await Promise.allSettled([
      fetch("https://www.bing.com/HPImageArchive.aspx?format=js&n=1&mkt=zh-CN&idx=7"),
      fetch("https://www.bing.com/hp/api/v1/imageoftheday?format=json&mkt=zh-CN"),
      fetch("https://www.bing.com/hp/api/model?mkt=zh-CN")
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
      const mediaContents = mediaObj?.MediaContents?.map(item => ({
        headline: item.ImageContent?.Headline,
        quickFact: item.ImageContent?.QuickFact?.MainText,
        triviaId: item.ImageContent?.TriviaId,
        ssd: item.ssd
      })) || [];

      // Fetch trivia data for those with triviaId
      const triviaPromises = mediaContents.map(async (mc) => {
        if (!mc.triviaId) return mc;
        try {
          const res = await fetch(`https://www.bing.com/hp/api/v1/trivia?format=json&id=${mc.triviaId}&mkt=zh-CN`);
          if (res.ok) {
            mc.triviaData = (await res.json()).data;
          }
        } catch (err) {
          console.error("Failed trivia fetch:", err);
        }
        return mc;
      });

      results.processedMediaContents = await Promise.all(triviaPromises);
    } else {
      results.errors.push("Model request failed");
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
    let lastQuickFact = readConf("last_quick_fact");
    let oldestQuickFact = {};

    if (results.processedMediaContents?.length > 0) {
      const lastMC = results.processedMediaContents.at(-1);
      oldestQuickFact = { date: parseInt(lastMC.ssd), quickfact: lastMC.quickFact };
    }

    if (!lastQuickFact && oldestQuickFact) {
      lastQuickFact = { "7th": oldestQuickFact, "8th": { date: 0, quickfact: "" } };
    } else if (lastQuickFact) {
      const lastImageDate = parseInt(images.at(-1).isoDate);
      lastQuickFact["8th"] = lastQuickFact["7th"]?.date === lastImageDate
        ? lastQuickFact["7th"]
        : { date: 0, quickfact: "" };
      if (oldestQuickFact) lastQuickFact["7th"] = oldestQuickFact;
    }

    images.at(-1).quickFact = lastQuickFact ? lastQuickFact["8th"].quickfact : "";
    writeConf("last_quick_fact", JSON.stringify(lastQuickFact));
  };

  // --- Execute both async tasks in parallel ---
  await Promise.all([triviaFetch(), quickFactsUpdate()]);

  // --- Save merged images ---
  writeConf("bing_images", JSON.stringify(images));
  console.log("Saved bing_images with merged contents.");

  // --- Log errors ---
  if (results.errors?.length > 0) {
    console.error("Errors during parallel data collection:", results.errors);
    writeConf("bing_data_errors", JSON.stringify(results.errors));
  }
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
  if (!image) return;

  // --- Format date helper ---
  const formatDate = (isoDate) => {
    if (!isoDate) return '';
    if (/^\d{8}$/.test(isoDate)) return `${isoDate.slice(0,4)}/${isoDate.slice(4,6)}/${isoDate.slice(6,8)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate.replace(/-/g, '/');
    return isoDate;
  };

  // --- Set footer and headline link ---
  setFooterText(image.headline);
  const headlineLink = document.getElementById('headline-link');
  if (headlineLink) headlineLink.href = `https://bing.com${image.clickUrl}`;

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
        const isWindows = navigator.userAgentData
          ? navigator.userAgentData.platform.toLowerCase().startsWith('win')
          : navigator.userAgent.toLowerCase().includes('windows');
        const size = isWindows ? { w: 16, h: 16 } : { w: 24, h: 24 };

        html += `<p style="font-style: italic;">
          <svg fill="#fff" width="${size.w}" height="${size.h}" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
            <path d="M21.5 20a.488.488 0 0 0-.443.717l.99 1.984c.28.63 1.214.163.883-.44l-.99-1.985a.49.49 0 0 0-.44-.275zM6.49 7c-.48 0-.7.722-.226.946l1.992.984c.606.33 1.075-.6.443-.88l-1.993-.985A.44.44 0 0 0 6.49 7M30 10.5c0 .277-.223.5-.5.5h-2a.499.499 0 1 1 0-1h2c.277 0 .5.223.5.5M17.5 0c.277 0 .5.223.5.5v2a.499.499 0 1 1-1 0v-2c0-.277.223-.5.5-.5m-5.092 4.03c-.25-.05-.537-.055-.803.1-.265.153-.402.41-.476.655-.075.244-.1.5-.103.777-.007.554.072 1.19.162 1.834s.194 1.293.25 1.82c.1.954-.185 1.214-.75 1.696-.413.354-.986.707-1.528 1.092-.542.384-1.072.774-1.477 1.162a3 3 0 0 0-.503.605c-.13.22-.23.497-.157.8s.283.505.496.645c.215.14.457.24.726.328.538.176 1.19.3 1.852.416.662.114 1.333.217 1.873.333.952.205 1.16.507 1.46 1.217.207.49.393 1.123.605 1.74s.43 1.222.69 1.715c.13.246.266.467.44.652.176.186.412.354.716.38.305.025.562-.102.766-.255.205-.153.38-.345.55-.566.343-.442.667-1.002.986-1.574s.63-1.155.908-1.614c.41-.83.91-.906 1.66-.96.552-.023 1.23-.013 1.904-.016s1.337-.02 1.9-.104c.28-.042.536-.1.77-.2.235-.103.475-.263.6-.548s.077-.576-.012-.814c-.09-.24-.226-.46-.39-.684-.33-.45-.78-.92-1.247-1.39-.465-.468-.946-.933-1.312-1.33-.672-.697-.63-.89-.38-1.63.18-.51.446-1.13.698-1.75.254-.618.495-1.232.626-1.78.066-.272.107-.528.092-.786s-.098-.554-.342-.758c-.243-.204-.528-.24-.79-.232-.263.007-.53.062-.82.142-.574.16-1.226.428-1.88.71-.654.28-1.312.622-1.855.837-.864.366-1.314.245-2.01-.158-.46-.295-1.003-.8-1.55-1.18-.547-.378-1.09-.802-1.596-1.052a3 3 0 0 0-.746-.274zm.303 1.17c.414.205.936.61 1.472.98s1.082.88 1.58 1.2c.497.317.895.582 1.39.624.498.042.947-.15 1.528-.38.58-.23 1.24-.57 1.883-.847.64-.276 1.27-.53 1.753-.666.625-.206.684.066.618.44-.105.438-.33 1.027-.58 1.634-.246.606-.515 1.233-.713 1.79-.198.56-.38.873-.255 1.39.117.49.446.825.844 1.255.396.43.88.897 1.334 1.357.456.46.885.913 1.15 1.277.416.526-.094.626-.31.666-.46.07-1.096.088-1.756.092-.66.003-1.343-.007-1.94.017-.595.023-1.072.03-1.503.28s-.67.66-.97 1.16c-.303.497-.615 1.085-.926 1.645-.313.56-.628 1.093-.904 1.45-.406.435-.565.354-.795-.063-.207-.396-.422-.973-.63-1.576-.207-.603-.408-1.237-.617-1.778-.208-.54-.37-.983-.752-1.304-.382-.32-.85-.407-1.432-.53-.583-.122-1.26-.226-1.908-.34-.65-.113-1.27-.248-1.71-.382-.667-.203-.372-.528-.18-.705.33-.31.83-.69 1.36-1.067.53-.376 1.09-.757 1.56-1.115.467-.358.85-.63 1.054-1.092.202-.46.14-.925.082-1.5-.06-.574-.167-1.226-.256-1.855-.09-.63-.16-1.24-.153-1.682-.027-.45.232-.576.684-.375zM10.5 17a.5.5 0 0 0-.343.15L.64 26.652c-.895.893-.776 2.134-.105 2.81.672.674 1.913.795 2.81-.103l9.49-9.49c.492-.472-.25-1.182-.706-.708l-9.49 9.49c-.58.58-1.07.43-1.396.104-.325-.328-.47-.826.102-1.397l9.518-9.503c.325-.318.083-.857-.364-.857z"/>
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
}

// --------------------------------------------------

// init wallpaper
initWallpaper();

var left_nav_btn = document.getElementById('leftNav');
left_nav_btn.onclick = switchPrevWallpaper;
var right_nav_btn = document.getElementById('rightNav');
right_nav_btn.onclick = switchNextWallpaper;
