# Future prefetch depth is best-effort, not a 7-day guarantee

Filling the regular-context future window requires 14 strictly serial image
downloads (~16.9 MB at UHD). MV3 service workers only run in response to events, and we deliberately do
not take the `alarms` permission — PLAN9 states that retry times are "earliest
permitted times, not guaranteed wakeups."

Those two facts are incompatible with advertising a 7-day offline window as a
guarantee. The batch only advances while the user is opening new tabs. A user who
installs the extension, browses briefly, and then goes offline keeps whatever
portion of the 14 responses happened to complete — and has no way to tell how deep
their cache actually is.

Future images are also less immediately valuable than missing historical images.
Users can navigate to current and historical catalog entries, while future entries
are not exposed by navigation. After the target image, the single image consumer
therefore fills navigable history before it starts future prefetch. Within history
and future work, previews precede the configured final resolution and dates run
from nearest to farthest. An explicit navigation request remains urgent and can
promote its canonical URL ahead of other pending work without interrupting the
active fetch.

We therefore describe future prefetch depth as **best-effort**: it grows with
browser usage and may reach 7 days, but is not guaranteed to. The worker records
the number of future dates actually cached so the depth is observable, tests assert
real behaviour rather than an aspiration, and degradation is visible instead of
silent.

Rejected: adding `alarms` (would make the guarantee real, and prompts no user
consent, but adds a permission and background wakeups for a non-essential feature);
shortening the regular-context window to 2-3 dates (honest, but gives up depth for
users who do browse enough to earn it); preview-only prefetch with lazy final
resolution. The separate incognito policy is defined by ADR-0011.

## Consequences

- No acceptance criterion may assert that 7 future dates are cached. Tests assert
  that *whatever* is cached displays offline, and that a partially filled window
  resumes correctly on the next event.
- The baseline image priority is target preview, target final resolution,
  historical backfill, future previews, then future final resolutions. Future
  prefetch does not start while a missing navigable historical image still awaits
  its cache check or permitted download attempt.
- Historical work is derived from catalog and cache state without waiting for a
  Model response. Model data only appends future work. A historical item whose
  cooldown has not expired is skipped for that event and does not block the future
  batch.
- Failure of a target or historical image records its own cooldown and does not
  permanently block later historical work or the future batch.
- This weakens the premise of
  [ADR-0002](./0002-offline-guarantee-over-cache-restraint.md), which accepted
  ~36.5 MB of UHD cache in exchange for the offline guarantee. The cost is
  unchanged; the benefit is now probabilistic. See that ADR for whether the budget
  was revisited.
- `cachedFutureDepth` is diagnostic state, not a suppression flag: it must never
  gate whether prefetching is attempted.
