# `@a2ui/catalog-vegachart`

<!-- disableFinding(LINK_RELATIVE_G3DOC) -->

TypeScript implementation of the [A2UI VegaChart Catalog](../../../catalogs/vegachart/README.md)
for rendering [Vega](https://vega.github.io/vega/) and
[Vega-Lite](https://vega.github.io/vega-lite/) visualizations in A2UI surfaces.

## Overview

The canonical schemas live at:

- [`catalogs/vegachart/catalog.json`](../../../catalogs/vegachart/catalog.json) (protocol v0.9, catalog ID `https://a2ui.org/specification/v0_9/catalogs/vegachart/vegachart_catalog.json`)
- [`catalogs/vegachart/v1/catalog.json`](../../../catalogs/vegachart/v1/catalog.json) (protocol v1.0, catalog ID `https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json`)

The v0.9 schema is copied into `dist/catalog.json` at build time and exposed as
`@a2ui/catalog-vegachart/catalog.json`.

### Exports

| Export                     | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `VEGACHART_CATALOG_ID`     | Canonical v0.9 catalog ID URI                                                |
| `VEGACHART_V1_CATALOG_ID`  | Canonical v1.0 catalog ID URI                                                |
| `VegaChartApi`             | `ComponentApi` definition for `VegaChart` (v0.9)                             |
| `VegaChartV1Api`           | `ComponentApi` definition for `VegaChart` (v1.0)                             |
| `A2uiVegaChartElement`     | Universal Lit custom element (`<a2ui-vega-chart>`)                           |
| `A2uiVegaChart`            | `WebComponentImplementation` pairing `A2uiVegaChartElement` & `VegaChartApi` |
| `A2uiVegaChartV1`          | `WebComponentImplementation` for protocol v1.0                               |
| `vegachartCatalog`         | Pre-built v0.9 `Catalog` instance                                            |
| `vegachartV1Catalog`       | Pre-built v1.0 `Catalog` instance                                            |
| `createVegaChartCatalog`   | Factory for creating a configured v0.9 `Catalog`                             |
| `createVegaChartV1Catalog` | Factory for creating a configured v1.0 `Catalog`                             |
| `transformSpec`            | Transforms a raw Vega-Lite spec for responsive & faceted rendering           |

## Usage

### Registering the catalog with `MessageProcessor`

```ts
import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {vegachartCatalog} from '@a2ui/catalog-vegachart';

const processor = new MessageProcessor([basicCatalog, vegachartCatalog]);
```

### Custom Embed Function (e.g. Sandboxed Renderer)

By default, `<a2ui-vega-chart>` renders charts using `vega-embed` with the SVG
renderer (`{actions: false, renderer: 'svg'}`). Host applications that use a
custom or sandboxed Vega embedder can configure it via `createVegaChartCatalog`:

```ts
import {createVegaChartCatalog} from '@a2ui/catalog-vegachart';
import {embed as safeVegaEmbed} from './my-sandboxed-vega';

const catalog = createVegaChartCatalog({
  embedFn: safeVegaEmbed,
});
```

### Example A2UI Payload (v0.9)

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "sales-dashboard",
      "catalogId": "https://a2ui.org/specification/v0_9/catalogs/vegachart/vegachart_catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "sales-dashboard",
      "components": [
        {
          "id": "root",
          "component": "VegaChart",
          "height": 320,
          "spec": {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "description": "Quarterly revenue by region",
            "data": {
              "values": [
                {"quarter": "Q1", "revenue": 120},
                {"quarter": "Q2", "revenue": 150},
                {"quarter": "Q3", "revenue": 180},
                {"quarter": "Q4", "revenue": 210}
              ]
            },
            "mark": "bar",
            "encoding": {
              "x": {"field": "quarter", "type": "ordinal"},
              "y": {"field": "revenue", "type": "quantitative"}
            }
          }
        }
      ]
    }
  }
]
```

## Building and Testing

From the repository root:

```bash
yarn workspace @a2ui/catalog-vegachart build
yarn workspace @a2ui/catalog-vegachart test
```
