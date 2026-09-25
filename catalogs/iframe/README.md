# A2UI iframe catalog

The A2UI iframe catalog lets A2UI surfaces embed sandboxed web applications, from remote widgets to model-generated HTML, next to regular components. It defines the `WebAppFrameUrl` and `WebAppFrameSrcdoc` components, which render an iframe and connect it to the surface through a message protocol, so the embedded application can dispatch actions, share data model state in both directions, call host functions and request its own size.

## Catalog specification

The catalog ID is `https://a2ui.org/specification/v0_9/catalogs/iframe/catalog.json`.

The catalog declares two components in [catalog.json](catalog.json) and no functions:

| Component           | Content                            | Description                                                                                                                           |
| :------------------ | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `WebAppFrameUrl`    | `url` (`DynamicString`, required)  | Loads an external http or https application in a sandboxed iframe. The host only accepts messages that come from the URL's origin.    |
| `WebAppFrameSrcdoc` | `htmlContent` (`string`, required) | Renders inline HTML through `srcdoc` in a sandboxed iframe without network access. The host injects a strict Content Security Policy. |

Both components share the properties below.

| Property                  | Type                     | Description                                                                                                                                      |
| :------------------------ | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `height`                  | `DynamicNumber`          | The height of the iframe in pixels.                                                                                                              |
| `config`                  | `object`                 | Static key-value settings passed once to the application, in the handshake.                                                                      |
| `data.paths`              | `object` of `string`     | A map of state keys to JSON Pointer paths in the data model. The host sends the current values in the handshake and pushes every later change.   |
| `allowedEvents`           | `object` of JSON Schemas | The actions the application may dispatch, each mapped to the schema of its payload.                                                              |
| `allowedFunctions`        | `object` of JSON Schemas | The catalog functions the application may call, each mapped to the schema of its arguments.                                                      |
| `mutableData`             | `object` of JSON Schemas | The `data.paths` keys the application may write back, each mapped to the schema of the allowed values.                                           |
| `disableSchemaValidation` | `boolean`                | Skips the schema validation of the three allowlists above. Reserved for trusted first-party applications; the allowlists themselves still apply. |

The allowlists deny by default: the host drops any action, function call or data change that is not listed or whose payload fails validation. The messages exchanged between the host and the embedded application (`a2ui_app_frame_ready`, `a2ui_app_frame_init`, `a2ui_action`, `a2ui_data_model_change`, `a2ui_function_call`, `a2ui_size_changed` and their host-to-app counterparts) are defined in the [WebApp iframe component specification](web_app_frame_specification.md).

## Examples

The [examples](examples/) directory holds A2UI message sequences that validate against this catalog combined with the basic catalog:

- [00_srcdoc-shared-counter.json](examples/00_srcdoc-shared-counter.json) shares a counter between a `WebAppFrameSrcdoc` app and sibling basic components through two-way data binding, and reports the saved count as an action.
- [01_url-frame.json](examples/01_url-frame.json) loads an external application with `WebAppFrameUrl`, passing it static configuration and bound data.
- [02_srcdoc-host-functions.json](examples/02_srcdoc-host-functions.json) formats a bound price by calling the basic catalog's `formatCurrency` function through `allowedFunctions`.

`specification/scripts/validate.py` validates these examples in CI.

## Implementations

A reference implementation of both components, including the host side of the message protocol, lives in the [Angular MCP calculator sample](../../samples/community/client/angular/projects/mcp_calculator/src/a2ui-catalog/).

The [Iframe and MCP catalogs guide](../../docs/public/guides/iframe-and-mcp-catalogs.md) covers installing the `@a2ui/catalog-iframe` package, serving the sandbox proxy the components load and registering the catalog with a web renderer.
