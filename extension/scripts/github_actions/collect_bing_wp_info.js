const fs = require('fs');
const path = require('path');
const { JSDOM } = require("jsdom");

const ARCHIVES_DIR = path.join(__dirname, '../../../archives');

// Ensure the archives directory exists
if (!fs.existsSync(ARCHIVES_DIR)) {
    fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
}

function writeConf(key, value) {
    const filePath = path.join(ARCHIVES_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    console.log(`Wrote ${key} to ${filePath}`);
}

function readConf(key) {
    const filePath = path.join(ARCHIVES_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.log(`::error::Error reading or parsing ${filePath}:`, e);
            return undefined;
        }
    }
    return undefined;
}

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
						} catch (e) { console.log("::error::Failed trivia fetch:", e); }
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
	} catch (err) {
		results.errors.push("Error collecting Bing data: " + err.message);
	}

	return results;
}

async function handleBingDataResults(results) {
	// --- Safely access images ---
	const images = results.imageOfTheDay?.data?.images ?? [];
	if (images.length === 0) {
		console.log("::error::No imageOfTheDay data found");
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
			console.log("::error::Failed trivia fetch for archive image:", err);
		}
	};

	// --- Async task: update quickFacts ---
	const quickFactsUpdate = async () => {
		const cachedQuickFacts = readConf("cache_quick_facts");
		const lastImageDate = images.at(-1).isoDate;

		if (cachedQuickFacts && lastImageDate && cachedQuickFacts[lastImageDate]) {
			images.at(-1).quickFact = cachedQuickFacts[lastImageDate];
		} else {
			images.at(-1).quickFact = '';
		}
		const mergedQuickFacts = { ...(cachedQuickFacts || {}), ...results.quickFactsBySsd };
		writeConf("cache_quick_facts", mergedQuickFacts);
	};

	// --- Execute both async tasks in parallel ---
	await Promise.all([triviaFetch(), quickFactsUpdate()]);

	// --- Check image count ---
	if (images.length !== 8) {
		console.log(`::error::Expected 8 images, but got ${images.length}.`);
	}
	// --- Save merged images ---
	writeConf(`${images[0].isoDate}`, images[0]);
	writeConf(`${images[0].isoDate}.8days`, images);
	console.log("Saved bing_images with merged contents.");

	// --- Log errors ---
	if (results.errors?.length > 0) {
		console.log("::error::Errors during parallel data collection:", results.errors);
		writeConf("bing_data_errors", results.errors);
	}
}

async function main() {
    console.log("Starting Bing data update...");
    try {
        const results = await collectBingDataInParallel();
        await handleBingDataResults(results);
        console.log("Bing data update finished successfully.");
    } catch (err) {
        console.log("::error::Error initializing wallpaper data update:", err);
        process.exit(1);
    }
}

main();
