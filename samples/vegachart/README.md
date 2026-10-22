# A2UI VegaChart Catalog Demo

<!-- disableFinding(LINK_RELATIVE_G3DOC) -->

This sample renders an interactive analytics dashboard from a static A2UI v0.9
JSON payload ([`a2ui_vegachart.json`](a2ui_vegachart.json)) using the
[A2UI VegaChart Catalog](../../catalogs/vegachart/README.md)
([`@a2ui/catalog-vegachart`](../../typescript/catalogs/vegachart/)) alongside the
Basic Catalog (`@a2ui/lit/v0_9`), with no LLM agent involved.

## What This Sample Shows

- **Multi-catalog composition**: [`app.ts`](app.ts) initializes
  `MessageProcessor` with both `basicCatalog` and `vegachartCatalog`. Layout and
  typography components (`Column`, `Card`, `Text`) resolve from the surface's
  default Basic Catalog, while `VegaChart` components declare
  `"catalogId": "https://a2ui.org/specification/v0_9/catalogs/vegachart/catalog.json"`.
- **Reactive data model bindings**: Each `VegaChart` component binds its `spec`
  property to a JSON pointer in the surface data model. Each chart exercises a
  different feature:
  - `/charts/quarterlyRevenue`: grouped bars (`xOffset`) with tooltips.
  - `/charts/monthlyTraffic`: multi-series temporal line spanning two years;
    the renderer rewrites the `%b` axis format to `%b %Y`.
  - `/charts/latency`: a `layer` spec combining an area band, a line, and a
    dashed rule.
  - `/charts/regionalSales`: `encoding.column` facets, with subplot size
    derived from the container width and the number of categories.
  - `/charts/ticketsByTeam`: `encoding.facet` with `columns: 2`; the chart
    grows beyond the default height to fit every subplot.
- **Zero agent dependency**: The host loads `a2ui_vegachart.json` directly into
  `processor.processMessages(...)` and mounts `<a2ui-surface>`.

## Run It

First, build `@a2ui/web_core`, `@a2ui/markdown-it`, `@a2ui/lit`, and
`@a2ui/catalog-vegachart` from the repository root:

```bash
yarn install
yarn workspace @a2ui/web_core build
yarn workspace @a2ui/markdown-it build
yarn workspace @a2ui/lit build
yarn workspace @a2ui/catalog-vegachart build
```

Then start the Vite development server:

```bash
yarn workspace @a2ui/vegachart-sample dev
```

Open `http://127.0.0.1:5175` in your browser to view the dashboard.

## Run Tests

```bash
yarn workspace @a2ui/vegachart-sample test
```
