# Navigation does not preempt active image fetches

PLAN9 keeps one active wallpaper image fetch per context and does not abort it
when the user navigates. Navigation only selects real current or historical
catalog entries, and the scheduler completes target and historical cache work
before starting future prefetch, so a future fetch does not normally block an
uncached navigation request.

## Decision

An urgent navigation request is promoted ahead of all pending background work,
but it does not cancel the active fetch or start a second fetch. If its canonical
URL is already active, it reuses that task's promise.

The exceptional delay is accepted when a navigable catalog entry loses or lacks
its cached response after future prefetch has already started. This can follow
Cache Storage eviction, an earlier failed or interrupted download, date rollover,
or a resolution change. The page retains the currently displayed wallpaper until
the requested replacement is ready.

Using `AbortController` for navigation preemption is rejected for PLAN9. It would
add cancellation-specific task state, distinguish intentional cancellation from
retryable failure, and potentially discard an almost-complete response for a
low-probability recovery path. ADR-0012 remains the place to reconsider image
fetch concurrency if measured behavior shows that the serial design is
unacceptable.

## Consequences

- Queue priority applies to pending work; it does not preempt the active request.
- Normal navigation should hit Cache Storage because historical work precedes
  future prefetch.
- A cache-miss navigation request can wait for the one active fetch in an edge
  case, but never for other pending historical or future tasks.
- Tests should cover both the normal cached-navigation path and the recovery path
  where navigation is promoted behind one active request.
