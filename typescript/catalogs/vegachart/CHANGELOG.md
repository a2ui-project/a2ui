# Changelog

## Unreleased

- Render charts under a Content Security Policy without `'unsafe-eval'`: the element now passes `ast: true` to `vega-embed`, which evaluates Vega expressions with `vega-interpreter` instead of compiling them with `Function`. [#4302](https://github.com/a2ui-project/a2ui/pull/4302)

## 0.1.0

- Initial release: the `<a2ui-vega-chart>` element, `VegaChart` component APIs,
  and catalog instances for A2UI v0.9 (`/v0_9`) and v1.0 (`/v1`).
