# A single dark backdrop, with no light-scheme variant

The new tab page's backdrop is always a photograph, so the page is effectively
dark-themed regardless of the OS colour-scheme preference. All four widget
stylesheets — `quote.css`, `style.css`, `description.css`, `clock.css` — use white
or near-white text accordingly.

`newtab.html` previously set `html, body { background-color: #000 }` with a
`@media (prefers-color-scheme: light)` override to `#b4abab7d`, a pale translucent
grey. That produced three problems inside the extension document:

1. **An extension-controlled pure-black first paint** for dark-scheme users and
   users with no preference, which PLAN9 line 51 forbids.
2. **A grey-to-black flash** for light-scheme users, because
   `activateFallbackPlaceholder()` in `scripts/main/wallpaper.js` set
   `body.style.backgroundColor = '#000'` inline and unconditionally, and inline
   style beats a media query.
3. **Poor contrast** for white widget text during any window where the pale grey
   was visible.

We replace both declarations with a single dark gradient
(`linear-gradient(160deg, #1f2933, #3e4c59)`) applied unconditionally, and clear
the inline colour in `activateFallbackPlaceholder()` so the gradient shows through.
This costs zero bytes and resolves the extension-controlled problems above, which
is why the ~200 KiB `assets/default-wallpaper.webp` that PLAN9 originally specified
is not needed.

## Browser-rendering boundary

Chromium can paint a browser-controlled background before `index.html` has been
loaded. The extension cannot set or remove that pre-document frame. In current
Chromium behavior, dark mode commonly uses a black initial frame; light mode can
show a white initial frame before the extension document begins rendering. The
fixed Gradient only controls the document background after the extension starts
rendering. `boot.js` and the cached `preloadDataUrl` can shorten the following
transition, but cannot guarantee that the browser's pre-document frame is absent.

This ADR therefore does not promise zero visual change from the instant a new tab
opens. It promises that the extension does not add a pure-black fallback, a
light-scheme override, or an extra background-color swap after document rendering
starts. Visual verification must distinguish the browser pre-document frame from
the extension-controlled first paint.

## Consequences

- **Do not re-add a `prefers-color-scheme: light` override.** It reads like an
  accessibility improvement, but it reduces contrast against white widget text and
  reintroduces the flash. This omission is deliberate.
- **Do not restore the inline `#000`** in `activateFallbackPlaceholder()`. Setting
  any inline `background-color` there defeats the gradient.
- **Do not claim that the extension can eliminate Chromium's pre-document white or
  black frame.** Test that frame separately from the extension's first paint.
- The offline path is unaffected: `#offline-view` is opaque, `z-index: 2000`,
  `position: fixed; inset: 0`, and `scripts/offline-detection.js` sets
  `documentElement.dataset.networkStatus` synchronously from `<head>` before first
  paint. An offline start never reveals the body backdrop, so this decision governs
  the online path only.
- The `data-wallpaper-fallback` attribute and `.wallpaper-fallback-active` class
  written by `wallpaper.js` are currently inert — no stylesheet targets either.
  They are retained as hooks for a future fallback treatment, not relied upon.

## Verification

- After the extension document starts rendering, the fallback is the fixed dark
  Gradient and no light-scheme or inline-black override appears.
- Warm-cache startup may transition from the browser frame or Gradient to the
  cached preview and then to the final image, but the extension performs no
  additional background-color swap and the final image swaps only once.
- Verification records the browser's initial frame separately when testing a new
  tab from both dark and light browser modes; a pre-document white or black frame
  is recorded as browser behavior, not as an ADR-0006 failure.
