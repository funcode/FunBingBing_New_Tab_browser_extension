# Incognito future prefetch is limited to one day

Incognito sessions are temporary. Multiple incognito tabs and windows can share
the active session's temporary cache, but that state disappears when the last
incognito window closes. Rebuilding a full seven-day future image window on every
short-lived incognito session spends bandwidth on content the user may never see.

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
  protection may add up to two keys, making hard maxima 32 and 20 respectively.

## Consequences

- A fresh incognito session can display the target immediately and may eventually
  have the next date offline, without attempting a full seven-day future batch.
- Regular users retain the accepted best-effort depth and UHD storage budget from
  ADR-0002/0005; the smaller incognito window reduces temporary-session network
  and storage cost.
- Tests must assert the per-context future limit and must not treat an incognito
  depth of seven as a requirement.
- A user who keeps an incognito session open can still complete its one-date
  future batch, but closing the last incognito window discards that progress.
