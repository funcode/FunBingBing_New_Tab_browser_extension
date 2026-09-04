# Canonical image cache keys carry only the `id` parameter

The same wallpaper image reaches us from four sources that spell its URL
differently:

| Source            | Spelling                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| archive `urlbase` | `/th?id=OHR.AdorableOwlet_ZH-CN6929234033`                               |
| archive `url`     | `/th?id=OHR.AdorableOwlet_ZH-CN6929234033_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp` |
| Model             | may use a `_1920x1080.webp` suffix                                       |
| migrated legacy   | a relative URL with no origin                                            |

Cache Storage matches on the **full URL string including the query**, so any
divergence between these produces a permanent silent miss.

We therefore rebuild every cache key as
`https://ts1.tc.mm.bing.net/th?id=<identity><canonical-suffix>` and discard all
other query parameters. Canonical suffixes are `_640x360.jpg`, `_1920x1080.jpg`,
and `_UHD.jpg`.

The cache is bounded by key count, not byte size. The regular PLAN9 retention
policy has a 30-key base (15 dates × 2 resolutions) plus at most 2
display-transition keys, so its hard limit is **32 keys**. Incognito has the
20-key hard limit defined by [ADR-0011](./0011-incognito-one-day-future-prefetch.md).

Verified against the live CDN (2026-08-04): `id` alone, `id&pid=hp`, and
`id&rf=…&pid=hp` all return HTTP 200 `image/jpeg` with a byte-identical 338135-byte
body. The CDN ignores `rf` and `pid` for image delivery, so dropping them costs
nothing and buys cross-source key convergence.

## Consequences

- Do **not** "helpfully" restore `pid` or `rf` to match what Bing serves. They are
  dropped deliberately; restoring them breaks key convergence between the archive
  and Model paths.
- `rf`'s value embeds the literal string `_1920x1080.jpg`. Suffix stripping must
  operate on the parsed `id` parameter, never on the raw URL, or `rf` will be
  mistaken for the resolution suffix.
- Identities contain underscores (`AdorableOwlet_ZH-CN6929234033`). A
  `/OHR\.[^_]+/` pattern truncates them and must not be used.
- Model's `.webp` suffix is used for identity extraction only and never becomes a
  cache key, or the same image would miss the next day when IOTD spells it `.jpg`.
- The CDN sends `Cache-Control: public, max-age=691200` (8 days), which exceeds the
  7-day retention window, so HTTP freshness does not conflict with our retention.
