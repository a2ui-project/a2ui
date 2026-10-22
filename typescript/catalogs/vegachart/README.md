# `@a2ui/catalog-vegachart`

<!-- disableFinding(LINK_RELATIVE_G3DOC) -->

TypeScript implementation of the
[A2UI VegaChart Catalog](../../../catalogs/vegachart/README.md): a single
`<a2ui-vega-chart>` element that renders [Vega](https://vega.github.io/vega/)
and [Vega-Lite](https://vega.github.io/vega-lite/) specifications with
`vega-embed`.

## Entry Points

| Import path                                 | Protocol | Exports                                                                              |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `@a2ui/catalog-vegachart/v0_9`              | v0.9     | `vegachartCatalog`, `VegaChartApi`, `A2uiVegaChart`, `VEGACHART_CATALOG_ID`          |
| `@a2ui/catalog-vegachart/v1`                | v1.0     | `vegachartV1Catalog`, `VegaChartV1Api`, `A2uiVegaChartV1`, `VEGACHART_V1_CATALOG_ID` |
| `@a2ui/catalog-vegachart`                   | both     | Everything above plus `A2uiVegaChartElement` and `transformSpec`                     |
| `@a2ui/catalog-vegachart/v0_9/catalog.json` | v0.9     | The canonical schema, copied from `catalogs/vegachart/v0_9/` at build time           |
| `@a2ui/catalog-vegachart/v1/catalog.json`   | v1.0     | The canonical schema, copied from `catalogs/vegachart/v1/` at build time             |

## Usage

Register the catalog alongside the basic catalog:

```ts
import {vegachartCatalog} from '@a2ui/catalog-vegachart/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {MessageProcessor} from '@a2ui/web_core/v0_9';

const processor = new MessageProcessor([basicCatalog, vegachartCatalog]);
```

Then reference the catalog from a surface:

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "sales",
      "catalogId": "https://a2ui.org/specification/v0_9/catalogs/vegachart/catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "sales",
      "components": [
        {
          "id": "root",
          "component": "VegaChart",
          "height": 320,
          "spec": {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "data": {
              "values": [
                {"q": "Q1", "r": 120},
                {"q": "Q2", "r": 150}
              ]
            },
            "mark": "bar",
            "encoding": {
              "x": {"field": "q", "type": "ordinal"},
              "y": {"field": "r", "type": "quantitative"}
            }
          }
        }
      ]
    }
  }
]
```

See [`samples/vegachart/`](../../../samples/vegachart/) for a runnable example.

### Rendering behavior

The element measures its container with a `ResizeObserver` and calls
`transformSpec` before embedding. `transformSpec` returns a copy of the spec
that:

- merges a default theme under any user-provided `config`;
- sets `width` and `height` from the container (`autosize: fit`), or sizes
  each subplot of a faceted chart from its data (`autosize: pad`);
- rewrites temporal axes formatted with `%b` but no `%Y` to `%b %Y`.

### Custom embed function

`A2uiVegaChartElement.defaultEmbedFn` is the function used to render; it
defaults to `vega-embed` with `{actions: false, renderer: 'svg'}`. Replace it to
use a sandboxed renderer, or set `embedFn` on an individual element:

```ts
import {A2uiVegaChartElement} from '@a2ui/catalog-vegachart';
import {embed} from './my-sandboxed-vega';

A2uiVegaChartElement.defaultEmbedFn = embed;
```

## Building and Testing

From the repository root:

```bash
yarn workspace @a2ui/catalog-vegachart build
yarn workspace @a2ui/catalog-vegachart test
```
