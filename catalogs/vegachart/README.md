# A2UI VegaChart Catalog

<!-- disableFinding(LINK_RELATIVE_G3DOC) -->

Catalog for rendering [Vega](https://vega.github.io/vega/) and
[Vega-Lite](https://vega.github.io/vega-lite/) charts in A2UI surfaces.

## Schemas

| Directory | Protocol | Catalog ID                                                            |
| --------- | -------- | --------------------------------------------------------------------- |
| `v0_9/`   | v0.9     | `https://a2ui.org/specification/v0_9/catalogs/vegachart/catalog.json` |
| `v1/`     | v1.0     | `https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json` |

Both schemas declare the same single component.

## `VegaChart`

Renders a Vega or Vega-Lite chart specification.

| Property | Type            | Required | Description                                                               |
| -------- | --------------- | -------- | ------------------------------------------------------------------------- |
| `spec`   | `DynamicValue`  | yes      | The Vega-Lite (or Vega) specification as a JSON object or a data binding. |
| `height` | `DynamicNumber` | no       | Chart height in pixels. Defaults to `290`.                                |

## Language Packages

| Language   | Package                                                           |
| ---------- | ----------------------------------------------------------------- |
| TypeScript | [`@a2ui/catalog-vegachart`](../../typescript/catalogs/vegachart/) |
