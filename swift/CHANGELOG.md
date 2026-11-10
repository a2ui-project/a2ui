## Unreleased

- **BREAKING CHANGE**: (`BasicCatalog`) `OpenURLFunction` checks its URL against the surface's
  URL security policy as `navigation` and throws `URLBlockedError` (reported with the code
  `URL_BLOCKED`) instead of `FunctionError.securityConstraintViolation` when the URL is blocked.
  The baseline rejects URLs the old scheme check let through, such as `https:host` and URLs
  with spaces or control characters. Only allowed, possibly rewritten, URLs reach the
  `OpenURLHandler`, and the user activation rule still applies. Recommended migration: catch
  `URLBlockedError` where you caught `FunctionError` for blocked URLs ([#4121](https://github.com/a2ui-project/a2ui/pull/4121)).
- (`A2UICore`) Add a URL security policy: `URLSecurityPolicy` with
  `sanitizeURL(_:context:info:)`, the default `PermissiveURLSecurityPolicy`,
  `AllowlistURLSecurityPolicy` (per-context host lists with `*.` subdomain wildcards and
  ports, `allowRelative`, rewrite hooks, `allowSVGDataURLs`, and a `urlProperties` map for
  catalogs the host can't edit), `URLContext`, `URLContextAnnotation`, `URLCheckInfo`, and
  `URLBaseline`. Pass a policy to `MessageProcessor(urlSecurityPolicy:)`; every surface uses
  it. Properties marked with `x-a2ui-url-context` (see `URLSchema`) and the basic catalog's
  `Image.url`, `Video.url`, `Video.posterUrl`, and `AudioPlayer.url` resolve to the URL the
  policy returns, or to `null` when it blocks the URL, and the v0.9 theme's `iconUrl` is
  removed or rewritten. Blocked URLs are published, redacted, as `URLBlockedWarning` on
  `SurfaceViewModel.urlBlockedPublisher` and `MessageProcessor.urlBlockedPublisher`.
  Functions and components check URLs they build with `sanitizeURL(_:context:info:)` on
  `DataContext` or `SurfaceViewModel` ([#4121](https://github.com/a2ui-project/a2ui/pull/4121)).
- (`BasicCatalog`) Deprecate `BasicCatalog.sanitizeMediaURL(_:)`. It now runs the URL
  security policy baseline for `media`, which also rejects `data:image/svg+xml` and `data:`
  URLs that aren't images, audio, or video ([#4121](https://github.com/a2ui-project/a2ui/pull/4121)).
