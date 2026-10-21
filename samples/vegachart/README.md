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
  typography components (`Column`, `Row`, `Card`, `Text`) resolve from the
  surface's default Basic Catalog, while `VegaChart` components declare
  `"catalogId": "https://a2ui.org/specification/v0_9/catalogs/vegachart/catalog.json"`.
- **Reactive data model bindings**: Each `VegaChart` component binds its `spec`
  property to a JSON pointer in the surface data model:
  - `/charts/quarterlyRevenue`: Bar chart of quarterly revenue.
  - `/charts/monthlyTraffic`: Multi-series temporal line chart of monthly active
    users by channel.
  - `/charts/regionalSales`: Faceted bar chart breaking down category sales
    across regions.
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
