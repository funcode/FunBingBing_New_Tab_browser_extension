# Shared settings use `chrome.storage.sync`

ADR-0004 keeps runtime state logically isolated between regular and split incognito
contexts with explicit context keys. The extension nevertheless needs product
settings to remain consistent in both contexts. Keeping those values in
context-specific keys would
make an UHD toggle or quote fallback URL differ depending on which context was
opened first.

## Decision

The following product settings move from v1 `chrome.storage.local` to
`chrome.storage.sync` during the regular-context v1 to v2 migration:

- `search_engine_list`
- `current_search_engine`
- `display_search_box`
- `show_top_sites`
- `show_clock`
- `show_quote`
- `enable_uhd_wallpaper`
- `qotd_url`

An existing valid sync value is authoritative. If it is absent or invalid, the
worker copies the valid local value; if neither exists, it writes the existing
default. The worker fresh-reads sync before deleting the migrated local keys. A
failed sync write leaves local values intact and keeps migration retryable.

The worker and pages read and write these settings through `chrome.storage.sync`
after migration. Wallpaper catalogs, display state, quote caches, migration
state, and Cache Storage remain context-local and are not moved to sync.

## Consequences

- Regular and incognito contexts observe the same settings without cross-context
  runtime messaging.
- Settings also follow the user's Chrome sync profile across devices; this is the
  accepted tradeoff for reliable sharing between split contexts.
- No new manifest permission is required because the extension already declares
  the `storage` permission.
