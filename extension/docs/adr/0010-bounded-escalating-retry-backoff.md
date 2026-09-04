# Bounded escalating retry backoff

A fixed 15-minute cooldown prevents request storms, but it also delays recovery
after a brief upstream or connectivity failure. Manifest V3 does not guarantee a
worker wakeup when a retry timestamp arrives, so a long first delay can become
even longer in practice: the retry waits for both the cooldown and the next
qualifying browser event.

## Decision

Metadata sources, canonical image URLs, trivia entries, and quote dates each keep
an independent persistent retry level. Consecutive failures use this bounded
schedule:

1. First failure: 1 minute
2. Second consecutive failure: 3 minutes
3. Third and later consecutive failures: 5 minutes

The stored retry level is saturated at 3. Both transport/parsing failures and
successful responses that lack required coverage advance the level. A successful
result resets the level and retry timestamp. A new metadata target date, a new
image or trivia identity, removal of an image URL, or successful quote completion
also resets the corresponding retry object because it is no longer the same
failure sequence.

Network reconnect may bypass one active backoff window per retry object. The
bypass does not reset the level; if the bypassed attempt fails, the next level is
applied. Backoff expiry is only an earliest permitted retry time and does not add
an alarm or guarantee a worker wakeup.

## Consequences

- Brief failures can recover on the next event after one minute rather than being
  suppressed for fifteen minutes.
- Persistent failures still settle at a five-minute ceiling and cannot generate a
  request on every new-tab event.
- Retry level must be persisted alongside each retry timestamp so worker restart
  does not reset the sequence.
- Tests cover the complete 1, 3, 5, 5 minute sequence, independent retry
  objects, reset conditions, restart continuity, and one reconnect bypass per
  active window.
