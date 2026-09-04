# Serial image fetch reconsideration

PLAN9 specifies "at most one active wallpaper image fetch" per context (line 321,
spec line 121). This is a deliberate design constraint, not a JavaScript
limitation. Modern async operations could easily support concurrent fetches.

## Current Design Rationale

User story 14 states: "As a user, I want background downloads to remain serial
within my context, so that prefetch does not compete aggressively with foreground
activity."

The single-consumer image scheduler provides:
- Simple task deduplication and priority promotion
- Predictable network usage from background prefetch
- Straightforward generation-based invalidation logic
- No risk of saturating bandwidth with 14 parallel UHD downloads (7 future dates)

## Performance Characteristics

With strictly serial fetches:
- **Cold start (target only)**: 2 serial fetches = 2 round trips
- **Cold start with 7 historical backfill**: 16 serial fetches (8 dates × 2
  resolutions)
- **User navigation to uncached date**: waits for current fetch to complete, then
  2 serial fetches

On a connection with 200ms RTT and 5 Mbps download:
- Preview (21.6 KB): ~235ms (200ms RTT + 35ms download)
- HD (338 KB): ~740ms (200ms RTT + 540ms download)
- UHD (2.41 MB): ~4.05s (200ms RTT + 3.85s download)

**Target date load (serial)**: 235ms + 4.05s = **4.3 seconds**  
**Historical backfill (8 dates, serial)**: 8 × 4.3s = **34 seconds**

## Controlled Concurrency Alternative

Download preview and final resolution **in parallel for the same date**, while
keeping dates serial:

```javascript
// Per-date parallel
for (const date of [target, ...historical, ...future]) {
  await Promise.all([
    fetchPreview(date),
    fetchFinalResolution(date)
  ]);
}
```

**Benefits:**
- **Target date load**: max(235ms, 4.05s) = **4.05s** (saves 235ms)
- **Historical backfill**: 8 × 4.05s = **32 seconds** (saves 2 seconds)
- Preview appears immediately while final resolution downloads
- No bandwidth saturation (max 2 concurrent fetches)
- Priority remains simple: abort both preview+final if generation changes
- Preview + final are both needed for the same date, so no priority conflict

**Tradeoffs:**
- Slightly more complex task tracking (2 active fetches instead of 1)
- Bing CDN sees bursty request pairs instead of smooth serial requests
- Generation invalidation must track and abort two fetches

## Full Parallelism (Rejected)

Allowing arbitrary concurrency (e.g., 14 parallel historical fetches) would:
- ❌ Saturate bandwidth: 7 parallel UHD = ~17 MB in flight
- ❌ Create priority inversion: user navigation waits for 7 background UHD downloads
- ❌ Complicate deduplication and promotion logic
- ❌ Risk Bing CDN rate limiting

## Recommendation Status

**Deferred for post-PLAN9 evaluation.**

The current serial design is conservative and correct. Controlled concurrency
(preview + final per date in parallel) would improve cold-start UX by ~5-10%
without major architectural changes, but adds complexity to the scheduler,
generation invalidation, and abort handling.

If cold-start performance becomes a user complaint after PLAN9 ships, this ADR
documents the next optimization to consider. The improvement is measurable but
not dramatic enough to delay the initial implementation.

## Implementation Notes (If Adopted)

- Use `Promise.all([fetchPreview(date), fetchFinal(date)])` per date
- Track both fetches in the active task map with shared abort controller
- Generation change aborts both preview and final for that date
- Cache.put() still checks generation and retention set per response
- Priority promotion works at date granularity: promote or insert both
  preview+final as a pair
- Tests must verify max 2 concurrent fetches and correct abort behavior

## Consequences

- The current PLAN9 serial design remains unchanged.
- This ADR records the controlled-concurrency option for future optimization.
- Cold-start performance baseline will be measured with serial fetches; if
  unacceptable, this approach is the recommended next step.
- Preview-only display (ADR-0008) already allows showing preview while final
  resolution downloads, so the UX gap is partially mitigated.
