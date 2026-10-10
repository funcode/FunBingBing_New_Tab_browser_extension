# Pure Logic Helpers (PLAN9 Foundation)

This directory contains the foundation layer of pure functions for the PLAN9 wallpaper pipeline implementation. These helpers have no dependencies on `chrome.*` APIs, DOM, or Cache Storage, making them fully testable in Node.js.

## Implementation Status

**Issue:** #116 - PLAN9-01: Pure Logic Helpers (Foundation)

**Status:** ✅ Complete

All acceptance criteria from the issue have been implemented and tested:

- ✅ `getZhCnTargetDate()` returns Asia/Shanghai date regardless of process timezone
- ✅ Helper contracts target only regular browsing and preserve existing `_regular` keys
- ✅ `normalizeImageUrl()` extracts full OHR identity, validates suffix, rebuilds canonical URL
- ✅ Model `_1920x1080.webp` normalizes to `_1920x1080.jpg`
- ✅ Unknown suffixes are rejected rather than guessed
- ✅ Full identities with multiple underscores are not truncated
- ✅ Metadata-stage merge is monotonic (iotd > media > preload > archive > legacy)
- ✅ Source validation requires proper coverage
- ✅ Missing source coverage produces `missing`, not `success`
- ✅ Stale candidate handling prevents identity replacement
- ✅ Trivia state never persisted as `pending`
- ✅ Trivia admission treats `triviaId` as sole work identity
- ✅ Bounded backoff: 1, 3, 5, 5 minutes with level saturation at 3
- ✅ Success and identity changes reset corresponding retry objects
- ✅ Image-task deduplication keeps one task per canonical URL
- ✅ Retention calculation: 30 regular base keys + at most 2 display protection keys (32 maximum)
- ✅ `cachedFutureDepth` diagnostic only, ranges 0..7
- ✅ Navigation index derived from display date in real-time array
- ✅ Quote leases: 60 seconds, `crypto.randomUUID()`, reject expired/replaced tokens
- ✅ Migration precedence: valid sync > valid local > default
- ✅ Migration validation requires catalog, quote state, all shared sync settings
- ✅ Display-state validation treats date, imageId, URL, preloadDataUrl as atomic snapshot
- ✅ Image-generation changes stop old queue dispatch

## Directory Structure

```
src/helpers/
├── date.js           # Date helpers (Asia/Shanghai timezone)
├── image.js          # Image URL normalization and identity extraction
├── image-task.js     # Image-task deduplication and generation-based write admission
├── display-state.js  # Atomic display-snapshot validation
├── retry.js          # Bounded escalating retry backoff
├── metadata.js       # Metadata stage comparison and merge
├── retention.js      # Cache retention and cleanup calculation
├── trivia.js         # Trivia ID normalization and validation
├── quote-lease.js    # Quote lease creation and validation
├── migration.js      # Migration helper functions
└── stale-work.js     # Stale work and generation validation

tests/
├── date.test.js
├── image.test.js
├── image-task.test.js
├── display-state.test.js
├── retry.test.js
├── metadata.test.js
├── retention.test.js
├── trivia.test.js
├── quote-lease.test.js
├── migration.test.js
└── stale-work.test.js
```

## Running Tests

```bash
npm test
```

Or directly with Node.js:

```bash
node --test tests/*.test.js
```

## Test Results

All 167 tests pass:

```
# tests 167
# suites 65
# pass 167
# fail 0
```

## Key Design Decisions

### ADR-0003: Canonical Image Cache Keys
- All image URLs normalized to `https://ts1.tc.mm.bing.net/th?id=<identity><suffix>`
- Three canonical suffixes: `_640x360.jpg`, `_1920x1080.jpg`, `_UHD.jpg`
- Model's `_1920x1080.webp` normalizes to `_1920x1080.jpg`
- Query parameters (`rf`, `pid`) are dropped for cache key convergence

### ADR-0010: Bounded Escalating Retry Backoff
- First failure: 1 minute
- Second consecutive failure: 3 minutes
- Third and later: 5 minutes (saturated at level 3)
- Independent retry state per source/URL/trivia/quote
- Reconnect can bypass one active window per object

### ADR-0015: Regular-Only New Tab
- Only regular browsing context supported
- Unsuffixed v2 storage keys
- 30 base cache keys + 2 display protection = 32 maximum
- Seven best-effort future dates

## Next Steps

The next implementation phases will build on these pure helpers:

- **#117**: Worker implementation using these helpers
- **#118**: Page-side integration
- **#119**: Migration logic
- **#120**: End-to-end testing

## References

- [PLAN9 Documentation](../docs/PLAN9.md)
- [Specification](../docs/spec-plan9-service-worker-migration.md)
- [ADR Directory](../docs/adr/)
