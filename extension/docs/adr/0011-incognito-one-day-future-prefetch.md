# Incognito future prefetch is limited to one day

> **Superseded in full on September 24, 2026 by [ADR-0015](./0015-regular-only-new-tab.md).** Incognito support has been dropped. The text below is historical; its one-day window, 18/20-key bounds and private-session tests are no longer requirements.

Incognito sessions are often short-lived. Multiple incognito tabs and windows
can use the context's image cache, but PLAN9 does not rely on a particular Cache
Storage partition lifetime. The context-suffixed `chrome.storage.local` records
are not automatically session-only; see ADR-0004's unresolved lifecycle requirement.
Prefetching a full seven-day future window for a short-lived session spends
bandwidth on content the user may never see.

## Decision

- Regular contexts retain the ADR-0005 best-effort future policy: Model-provided
  future dates may be prefetched up to seven dates, each with preview and the
  configured final resolution.
- Incognito contexts prefetch at most the next future date (`targetDate + 1`).
  That date receives both its `_640x360.jpg` preview and the configured HD or UHD
  final response, subject to the same serial queue, retry backoff, Cache Storage
  eviction, and service-worker lifetime limits.
- Incognito contexts do not enqueue future dates beyond `targetDate + 1`.
  Historical navigation, current-display protection, and all metadata behavior
  remain unchanged.
- `cachedFutureDepth` is bounded by the context policy: `0..7` for regular and
  `0..1` for incognito. It remains diagnostic only and never suppresses cache
  checks, retry, repair, or prefetch.
- The base image retention set is context-specific: regular uses 30 base keys
  (target + seven past + seven future, two responses each), while incognito uses
  18 base keys (target + seven past + one future, two responses each). Display
  protection may add up to two keys, making stable maxima 32 and 20 respectively
  after cleanup before a new future batch. Resolution changes may briefly overlap
  old responses with the new set, as specified in PLAN9.

## Consequences

- A fresh incognito session can display the target immediately and may eventually
  have the next date offline, without attempting a full seven-day future batch.
- Regular users retain the accepted best-effort depth and UHD storage budget from
  ADR-0002/0005; the smaller incognito window reduces temporary-session network
  and storage cost.
- Tests must assert the per-context future limit and must not treat an incognito
  depth of seven as a requirement.
- A user who keeps an incognito session open may complete its one-date future
  batch. On a later startup, actual Cache Storage matches determine available
  responses; retained local diagnostics must not be treated as cached images.
