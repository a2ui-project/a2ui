# A2UI iframe catalog

The A2UI iframe catalog lets A2UI surfaces embed sandboxed web applications, from remote widgets to model-generated HTML, next to regular components. It defines the `WebAppFrameUrl` and `WebAppFrameSrcdoc` components, which render an iframe and connect it to the surface through a message protocol, so the embedded application can dispatch actions, share data model state in both directions, call host functions and request its own size.

## Catalog specification

The catalog ID is `https://a2ui.org/specification/v1_0/catalogs/iframe/catalog.json`.

The catalog declares two components in [catalog.json](catalog.json) and no functions:

| Component           | Content                            | Description                                                                                                                           |
| :------------------ | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `WebAppFrameUrl`    | `url` (`DynamicString`, required)  | Loads an external http or https application in a sandboxed iframe. The remote server is responsible for its Content Security Policy.  |
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

- [srcdoc-tip-calculator.json](examples/srcdoc-tip-calculator.json) covers every `WebAppFrameSrcdoc` interaction in one tip calculator: it reads the bill from bound data, takes its currency and locale from `config`, writes the total back through `mutableData`, formats it with `formatCurrency`, reports the saved receipt as an action, sizes its frame and declares `open_url` for its help link. `typescript/catalogs/iframe/tests/examples/` runs it end to end.
- [url-order-tracker.json](examples/url-order-tracker.json) covers every `WebAppFrameUrl` interaction in one order tracker: it takes its theme and locale from `config`, reads the orders from bound data, writes a status summary back through `mutableData`, reports selected and delivered orders as actions and sizes its frame. The `url` is a placeholder; `typescript/catalogs/iframe/tests/examples/` runs it end to end against `tests/fixtures/apps/order_tracker.html`.

`specification/scripts/validate.py` validates these examples in CI.

## Implementations

The components originated in the [Angular MCP calculator sample](../../samples/community/client/angular/projects/mcp_calculator/src/a2ui-catalog/), which implements a v0.9 predecessor of this catalog under its own sample catalog ID.

The [Iframe catalog guide](../../docs/public/guides/iframe-catalog.md) covers installing the `@a2ui/catalog-iframe` package, serving the sandbox proxy the components load and registering the catalog with a web renderer.
