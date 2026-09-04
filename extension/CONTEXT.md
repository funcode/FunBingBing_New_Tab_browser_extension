# About this project 
This project is a Chrome New Tab Page Extension that uses Bing's daily wallpaper as the background image.
In addition, it shows some widgets on the image:
- A digital clock in the center
- Quote of the day
- A button besides the clock to turn on/off the clock and quote display
- At the right bottom corner, there are 2 navigation buttons to allow users to view the images of the previous or the next date.
- There is a big "Q" displayed at the lower right side area. When a mouse is hovered over it, it expands to show the full content of the quiz of the image.
- When the mouse hovers over the bottom center, where the quote of the day is displayed, a pop-up rises up showing the full content of the quote, including its original source and the caption.
- At the right bottom, left to the navigation buttons, the image title is shown. When the mouse hovers over it, a pop-up rises showing the detailed description of the image, including the image copyright, paragraphs of description and a fun fact about the image.
- At the right up corner, there is a Windows logo. When clicked, it shows a menu with these entries:
    - On This Day In History
    - Same Day In History On Bing.com
    - Gallery
    - Settings

## Other functions
- When a new tab is opened, the extention retrieves today's image from Bing.com if it is not cached yet.
- The extension retrieves the metadata of the images using some Bing's APIs, and HTML scraping for the quote of the day.
- The extension retrieves quote of the day from a remote URL specified by a local variable if it fails to scrape from Bing.
- The extension maintains the local cache of the images, quotes and metadata for the recent 8 days of wallpapers.
- The extension preloads a low resolution image before the UHD image is retrieved to reduce the waiting time.
- The extension checks the network connection periodically, and it shows a default page if the disconnection is detected.
- The extension uses a background service worker to handle quotes retrieving and caching.

## Language

**Preview** (预览图):
The 640×360 resolution of a wallpaper, fetched first to minimise perceived latency. Roughly 21.6 KB.
_Avoid_: thumbnail, low-res

**Final resolution** (最终分辨率):
The user-configured target resolution — HD (1920×1080, ~338 KB) or UHD (~2.41 MB).
_Avoid_: full resolution, high-res, original

**Identity** (身份):
The stable portion of a Bing image URL that identifies a photograph across all resolutions, APIs and dates. Read from the `id` query parameter, e.g. `OHR.AdorableOwlet_ZH-CN6929234033`. Contains underscores.
_Avoid_: image ID, image name, slug

**Trivia ID**:
The Bing identifier for one quiz payload, e.g. `HPQuiz_20260727_ChicagoTiffany`. It includes a publication date and image-name slug but is not the wallpaper Identity.
_Avoid_: quiz ID, trivia identity tuple

**Canonical cache key**:
The rebuilt Cache Storage key `https://ts1.tc.mm.bing.net/th?id=<identity><canonical-suffix>`. All non-`id` parameters are stripped so the same photograph from different API sources converges on one key. See [ADR-0003](./docs/adr/0003-canonical-image-cache-keys.md).
_Avoid_: normalised URL, cache URL

**Retention set** (保留集合):
The wallpaper responses held in Cache Storage. Bounded by key count, not bytes.
_Avoid_: cache window, cached images

**Future window** (未来窗口):
The days ahead of the current target date for which wallpapers are prefetched. Depth is best-effort, not guaranteed. See [ADR-0005](./docs/adr/0005-future-prefetch-is-best-effort.md).
_Avoid_: look-ahead, prefetch window

**Transient entry** (临时条目):
A catalogue entry built from Model's `PreloadMediaContents` before IOTD has confirmed the day's metadata. Superseded once IOTD arrives.
_Avoid_: provisional entry, placeholder, stub

**Target date** (目标日期):
The publication identity of Bing content, not the user's local calendar day. Formatted from `YYYYMMDD` as a string without constructing a `Date`.
_Avoid_: today, current date

# Engineering Considerations
- Performance matters, the new tab page should be opened instantly, and avoid getting users notice the page loading delay
- Carefully control the local storage, including the cache. Avoid local storage bloat.
