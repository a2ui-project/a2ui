# Changelog

## Unreleased

- **BREAKING CHANGE**: the catalogs are loaded from their published `catalog.json` documents with the zod-free `@a2ui/web_core`, and the package no longer depends on zod. `vegachartCatalog` and `vegachartV1Catalog` are replaced by `createVegaChartCatalog(validator)` and `createVegaChartV1Catalog(validator)`, memoised per validator; `VegaChartApi`, `A2uiVegaChart`, `VegaChartV1Api` and `A2uiVegaChartV1` are now types (use `catalog.components.get('VegaChart')`). `VegaChartProps`, `VegaChartV1Props`, `VegaChartCatalog`, `VegaChartV1Catalog`, `VEGACHART_CATALOG_DOCUMENT` and `VEGACHART_V1_CATALOG_DOCUMENT` are new. Recommended migration: `createVegaChartCatalog(createAjvValidator())` from `@a2ui/validator-ajv`.

## 0.1.0

- Initial release: the `<a2ui-vega-chart>` element, `VegaChart` component APIs,
  and catalog instances for A2UI v0.9 (`/v0_9`) and v1.0 (`/v1`).
