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

# Engineering Considerations
- Performance matters, the new tab page should be opened instantly, and avoid getting users notice the page loading delay
- Carefully control the local storage, including the cache. Avoid local storage bloat.