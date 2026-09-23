# Serial image fetch reconsideration

PLAN9's "图片预取、按 URL 防抖与空间控制" section and the spec's
"Image scheduler and cache policy" section specify at most one active wallpaper
image fetch per context. This is a deliberate design constraint, not a JavaScript
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
- **User navigation to uncached date**: waits for the active fetch, if any, then
  requests or shares only the destination final-resolution fetch. Navigation does
  not wait for or render the destination preview (ADR-0008/0013).

Illustrative calculation, not a benchmark: assume 200ms request overhead,
5 Mbps download, decimal KB/MB, and the ADR-0002 sample sizes. This omits
connection setup, server delay, decoding, and cache writes:
- Preview (21.6 KB): ~235ms (200ms RTT + 35ms download)
- HD (338 KB): ~740ms (200ms RTT + 540ms download)
- UHD (2.41 MB): ~4.05s (200ms RTT + 3.85s download)

**Target date load (serial)**: 235ms + 4.05s = **4.3 seconds**  
**Target plus seven historical dates (serial)**: 8 × 4.3s = **34 seconds**

The current scheduler processes historical previews before historical finals;
this total does not imply per-date pairing in the baseline queue.

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

**Potential benefits to measure:**
- Overlap request overhead for preview and final resolution. Taking the maximum
  of their isolated download times is not a valid shared-bandwidth benchmark.
- A startup preview may appear before the final image, but competition for the
  same connection can also delay the preview. It is not displayed immediately.
- Concurrency stays bounded at two requests; this does not prevent link saturation.

**Tradeoffs:**
- Slightly more complex task tracking (2 active fetches instead of 1)
- Bing CDN sees bursty request pairs instead of smooth serial requests
- Both responses require URL deduplication and admission against the latest
  retention set; changing generation alone does not make a retained response invalid.
- Per-date pairing changes the baseline all-previews-before-finals backfill order
  and may delay previews of other dates. Navigation still prioritizes final only.

## Full Parallelism (Rejected)

Allowing arbitrary concurrency (e.g., 14 parallel historical fetches) would:
- ❌ Saturate bandwidth: 7 parallel UHD = ~17 MB in flight
- ❌ Create priority inversion: user navigation waits for 7 background UHD downloads
- ❌ Complicate deduplication and promotion logic
- ❌ Risk Bing CDN rate limiting

## Recommendation Status

**Deferred for post-PLAN9 evaluation.**

Controlled concurrency is an unmeasured candidate, not a demonstrated 5-10%
improvement. It adds scheduler and task-admission complexity and changes the
backfill ordering. The current serial design remains the accepted baseline.

If cold-start performance becomes a user complaint after PLAN9 ships, this ADR
documents an optimization to evaluate. Measure preview latency, final-image
latency, navigation delay, and bandwidth before deciding whether to adopt it.

## Implementation Notes (If Adopted)

- Use `Promise.all([fetchPreview(date), fetchFinal(date)])` per date
- Preserve canonical-URL task deduplication and latest-retention-set write admission
- Generation changes stop obsolete pending dispatch; the accepted baseline does
  not cancel an active fetch solely because generation changes
- Keep urgent navigation final-only; promoting preview+final as a pair would
  require a separate change to the accepted navigation contract
- Any cancellation policy requires an explicit decision revisiting ADR-0013
- Tests must verify the proposed concurrency cap, task sharing, write admission,
  startup-preview latency, and navigation priority before adoption

## Consequences

- The current PLAN9 serial design remains unchanged.
- This ADR records the controlled-concurrency option for future optimization.
- Cold-start performance baseline will be measured with serial fetches; if
  unacceptable, this approach is the recommended next step.
- Startup preview display (ADR-0008) already allows showing a matching preview
  while final resolution downloads. Manual navigation retains the prior final
  image instead and does not display the destination preview.
