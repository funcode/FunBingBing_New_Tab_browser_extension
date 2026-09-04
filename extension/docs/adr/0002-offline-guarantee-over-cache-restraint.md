# Offline guarantee outranks cache restraint for UHD users

Measured sizes for a representative daily image (2026-08-04,
`OHR.AdorableOwlet_ZH-CN6929234033`):

| Resolution        | Bytes    |
| ----------------- | -------- |
| `_640x360.jpg`    | 21.6 KB  |
| `_1920x1080.jpg`  | 338 KB   |
| `_UHD.jpg`        | 2.41 MB  |

PLAN9's regular-context retention set holds 15 dates (8 current/past + 7 future)
at two resolutions each, giving a steady state of roughly **5.4 MB** for HD
users and **36.5 MB** for UHD users. Incognito uses the smaller future window
defined by [ADR-0011](./0011-incognito-one-day-future-prefetch.md).

This conflicts with the standing constraint in `AGENTS.md`: *"Carefully control
the local storage, including the cache. Avoid local storage bloat."* We resolve
the conflict in favour of the offline guarantee: the full 7-day future window is
retained at the user's configured resolution, and `AGENTS.md` is amended to record
that the guarantee takes precedence for users who have opted into UHD.

Rejected: capping future UHD depth to the nearest 1-2 dates (~24 MB) and also
trimming the past window (~10 MB). Both were cheaper but would mean a user
navigating within the retained window could still hit the network, weakening the
property the cache exists to provide.

## Consequences

- UHD is the expensive path by an order of magnitude; the 7 future regular-context
  UHD images alone account for ~16.9 MB. HD users are unaffected at ~5.4 MB.
- The 32 MiB figure discussed during review was not merely unmeasured, it was too
  low. No byte ceiling is enforced; the regular cache is bounded by key count
  (32), while incognito is bounded by the 20-key policy in ADR-0011.
- Cache Storage remains best-effort. Chrome may evict under quota or disk
  pressure, shortening the effective offline window. We do not request
  `unlimitedStorage` to defend against this.

## Revisited

[ADR-0005](./0005-future-prefetch-is-best-effort.md) subsequently downgraded the
7-day offline window from a guarantee to best-effort depth, which weakens the
premise this decision was argued on: the ~36.5 MB was accepted in exchange for a
firm guarantee, and the benefit is now probabilistic.

The budget is **deliberately reaffirmed anyway**. The window fills fastest for users
who open the most new tabs, so the cache depth accrues precisely to the users who
get the most value from it. Trimming future depth to 2 dates (~24.4 MB) or making
depth follow the resolution setting were both considered and rejected on those
grounds. The cost is unchanged and the `AGENTS.md` exception stands.
- **Revisited after ADR-0005** downgraded the 7-day offline window from a
  guarantee to a best-effort depth that grows with browser usage. The budget is
  deliberately reaffirmed: users who browse enough to fill the window are exactly
  the users who benefit from it, and trimming the window for users who don't
  browse enough would only penalize the users who do.
