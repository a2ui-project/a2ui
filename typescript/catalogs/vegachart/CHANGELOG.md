# Changelog

## Unreleased

- **BREAKING CHANGE**: `VegaChart` checks every URL in a spec against the surface's URL security policy through a Vega loader passed to the embed function as `options.loader`: `data.url` and image marks as `media`, the `href` channel as `navigation`. Blocked URLs are never fetched or opened, and the built-in baseline now blocks protocol-relative URLs and `data:` URLs that aren't images, audio or video even without a policy. Recommended migration: put chart data inline with `data.values`, and forward `options.loader` to Vega in a custom `VegaEmbedFn`. [#4117](https://github.com/a2ui-project/a2ui/pull/4117)

## 0.1.0

- Initial release: the `<a2ui-vega-chart>` element, `VegaChart` component APIs,
  and catalog instances for A2UI v0.9 (`/v0_9`) and v1.0 (`/v1`).
