# Ataraxia supports regular New Tab only

Status: accepted, September 24, 2026.

Chrome [does not allow extensions to override New Tab in incognito windows](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages#incognito). This restriction does not prohibit every extension page in incognito, but it removes the core user flow for this product. We therefore drop incognito support rather than build a separate private-window experience or repair its session-lifetime storage.

## Consequences

- Set the manifest to `"incognito": "not_allowed"`. Removing the property alone would not explicitly disallow incognito operation.
- Remove incognito context routing, worker/catalog/quote/lease/display/cache initialization, the one-day future window, and last-window cleanup handlers and tests. Do not introduce IndexedDB or chrome.storage.session for the discontinued mode.
- Keep all existing `_regular` keys and the `funbingbing-wallpaper-cache-v2-regular` cache name. This scope change does not require renaming regular state or resetting valid data.
- Keep product settings in `chrome.storage.sync` (ADR-0009), with unchanged migration precedence and failure recovery. Regular pages and the worker still share settings.
- Retain seven best-effort future dates, 30 base cache keys plus at most two display-protection keys (32 maximum), and diagnostic-only `cachedFutureDepth` in 0..7.
- No new startup reads or imports of retired private state are required. Residual test/development private keys are not a runtime input and must never be migrated into the regular catalog. A data-removal migration is not part of this decision.
- Test actual regular New Tab behavior and verify an incognito New Tab remains Chrome's page with no Ataraxia incognito worker or jobs. Opening an extension URL manually is not an incognito New Tab acceptance test.

## Supersession and implementation

This decision supersedes ADR-0011 in full and the incognito self-seeding, isolation, persistence and last-window cleanup portions of ADR-0004. It revises the incognito rationale in ADR-0009 without reversing sync storage. Historical issue comments and review reports remain evidence of earlier decisions, not current acceptance requirements.

The September 24 browser tests found that the private worker did not receive the final close event and persistent local keys survived. That observation is retained; it is no longer a release blocker for a mode the product does not support. Passing acceptance still requires removal of the runtime support, not merely deleting failing tests.

Documentation/ticket changes do not implement the removal. #116 simplifies helper contracts, #117 removes private worker/lifecycle paths, #122 changes the manifest and callers, and #123 verifies the supported scope. #118–#121 and #125–#126 follow the revised regular-only specification; #124 is the parent specification.
