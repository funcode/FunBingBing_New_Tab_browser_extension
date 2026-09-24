# Shared settings use `chrome.storage.sync`

Product settings remain in sync storage after the regular-only scope decision in
[ADR-0015](./0015-regular-only-new-tab.md). They are shared by regular pages and the
worker and may follow the user’s Chrome sync profile across devices. Removing
incognito support does not reverse the accepted settings migration.

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

- Regular pages and the worker observe the same settings through storage change events.
- When Chrome sync is enabled, settings can follow the user’s sync profile across
  devices. Cross-device sync is not a prerequisite for consistency within a profile.
- No new manifest permission is required because the extension already declares
  the `storage` permission.
