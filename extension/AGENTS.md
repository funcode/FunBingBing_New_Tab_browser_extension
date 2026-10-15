Chrome New Tab extension showing Bing's daily wallpaper. Product overview and domain language: `GLOSSARY.md`.

# Engineering Considerations
- Performance matters, the new tab page should be opened instantly, and avoid getting users notice the page loading delay
- Carefully control the local storage, including the cache. Avoid local storage bloat.
  - Exception: best-effort future prefetch depth up to 7 days takes precedence for users who opt into UHD wallpapers, whose image cache reaches roughly 36 MB in steady state. See [ADR-0002](./docs/adr/0002-offline-guarantee-over-cache-restraint.md) and [ADR-0005](./docs/adr/0005-future-prefetch-is-best-effort.md).

## Tests

- `scripts/` holds classic page scripts that share one global scope (`boot.js` loads `scripts/main/*`); `src/` modules reach the page only through dynamic `import()`. Node tests of `src/` never load the page scripts: changes under `scripts/` or `newtab.html` need `tests/newtab-page.test.js` and `npm run test:e2e` (Playwright, the real extension in Chromium).

## Agent skills

### Issue tracker

Issues live in [GitHub Issues](https://github.com/funcode/FunBingBing). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `GLOSSARY.md` at the extension root. See `docs/agents/domain.md`.

