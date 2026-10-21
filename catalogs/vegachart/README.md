# A2UI VegaChart Catalog

<!-- disableFinding(LINK_RELATIVE_G3DOC) -->

Catalog for rendering [Vega](https://vega.github.io/vega/) and
[Vega-Lite](https://vega.github.io/vega-lite/) charts in A2UI surfaces.

## Schema (`catalog.json`)

The v0.9 catalog ID is
`https://a2ui.org/specification/v0_9/catalogs/vegachart/vegachart_catalog.json`.

### Declared Components

| Component   | Required Properties | Optional Properties | Description                                  |
| ----------- | ------------------- | ------------------- | -------------------------------------------- |
| `VegaChart` | `spec`              | `height`, `weight`  | Displays a Vega or Vega-Lite chart from JSON |

#### `VegaChart`

Renders a Vega or Vega-Lite chart specification.

- `spec` (`DynamicValue`, required): The Vega-Lite (or Vega) specification as a
  JSON object, a data binding path (`{"path": "/chartSpec"}`), or a function
  call.
- `height` (`DynamicNumber`, optional): The height of the chart in pixels.
  Defaults to `290`.

## v1 (`v1/catalog.json`)

The v1 revision of the catalog, [`v1/catalog.json`](v1/catalog.json), targets
A2UI protocol v1.0. Its catalog ID is
`https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json`.

## Language Packages

| Language   | Package                                                           |
| ---------- | ----------------------------------------------------------------- |
| TypeScript | [`@a2ui/catalog-vegachart`](../../typescript/catalogs/vegachart/) |
