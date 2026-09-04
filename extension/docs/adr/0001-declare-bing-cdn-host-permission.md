# Declare the Bing image CDN in host_permissions

Wallpaper images are served from `ts1.tc.mm.bing.net`, which is **not** covered by
the existing `https://*.bing.com/` host permission — `bing.net` is a different
domain. Historically these fetches succeeded only because Bing's CDN returns
permissive CORS headers, and the new tab page could retry a failed fetch itself.

PLAN9 makes the service worker the sole fetcher of wallpaper images and reduces
the page to a `cache.match()`-only consumer with no fetch fallback. Under that
design a CORS policy change on Bing's CDN would leave the worker unable to
populate the cache and the page with no recourse, permanently pinning every user
to the built-in fallback wallpaper.

We therefore add `https://*.bing.net/` to `host_permissions`. Declared host
permissions exempt extension fetches from CORS enforcement, so image caching no
longer depends on a third party's response headers.

## Consequences

- Adds a host to the permission set, which may re-prompt existing users on update
  and attract additional Chrome Web Store review scrutiny.
- Accepted deliberately: the alternative couples a core feature's availability to
  an undocumented CDN behaviour we do not control.
