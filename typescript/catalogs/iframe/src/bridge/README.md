# Host bridge for the `a2ui_*` protocol

The host side of the message protocol between an A2UI renderer and a web app running in the sandbox. The protocol itself is specified in the [web app frame specification](../../../../../catalogs/iframe/web_app_frame_specification.md); this directory implements the renderer end of it. Every file has a `*.test.ts` sibling.

| File                      | Role                                                                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages.ts`             | `A2uiMessageType`, the zod schemas of every message the app may send (`IncomingWebFrameMessageSchema`), the types of the messages the host sends back, and `WebAppFrameBasePropsSchema`, the props shared by all frame components.                                                     |
| `payload_validation.ts`   | `PayloadValidator`: compiles the JSON Schemas declared in `allowedEvents`, `allowedFunctions` and `mutableData` once per bridge and answers whether a name is allowed and its payload matches the schema. Also the `subpath` helpers that project a partial change onto a bound value. |
| `web_app_frame_bridge.ts` | `WebAppFrameBridge`: owns the `MessagePort` to one frame, validates and dispatches incoming messages to a `FrameHost`, and pushes data model and host context updates back to the app.                                                                                                 |

## How a session works

1. The frame component points its iframe at the sandbox proxy page and calls `bridge.start()`, which listens for ambient `postMessage` events coming from that iframe and the sandbox origin.
2. The proxy posts `a2ui_sandbox_proxy_ready`. The bridge reports it through `onSandboxProxyReady` so the component can answer with `a2ui_sandbox_resource_ready`, the URL or inline HTML to load (`sendSandboxResourceReady` in `../shared/sandbox/sandbox_bootstrap.ts`).
3. Once the app has loaded, it posts `a2ui_app_frame_ready`. The bridge creates a `MessageChannel`, keeps one port and transfers the other to the app inside `a2ui_app_frame_init`, together with the component `config`, the current values of the bound data paths, the `allowedEvents` and `allowedFunctions` schemas, the mutable data keys and the host context (size limits, theme, locale). From here on every message travels over the port; the ambient listener only reacts to a new ready signal, which replaces the channel.
4. Over the port the app may send:
   - `a2ui_action`: forwarded to `FrameHost.dispatchAction` if the action name is in `allowedEvents` and the payload matches its schema.
   - `a2ui_data_model_change`: written through `FrameHost.setData` if the key is in `mutableData` and bound in `dataPaths`; a `subpath` change is projected onto the current bound value first.
   - `a2ui_function_call`: executed through `FrameHost.invokeFunction` if the name is in `allowedFunctions`. The bridge always answers with `a2ui_function_result`, with `NOT_ALLOWED`, `VALIDATION_ERROR` or `EXECUTION_ERROR` when the call fails.
   - `a2ui_size_changed`: clamped by `../shared/sandbox/frame_sizing.ts` and applied to the iframe.
5. The bridge subscribes to the bound data paths with `FrameHost.subscribeData` and sends `a2ui_data_model_update` whenever one changes, and `a2ui_host_context_update` when the frame is resized or the host theme changes.
6. `bridge.dispose()` closes the port, unsubscribes from the host and stops listening.

## Validation order

Ambient messages are accepted only from the bridge's iframe and the configured sandbox origin. Every message on the port goes through, in this order:

1. `validateMessageSecurity` (`../shared/sandbox/security.ts`): serialized size, nesting depth and prototype pollution keys.
2. `IncomingWebFrameMessageSchema`: the shape of the message.
3. `PayloadValidator.checkAllowlist`: the name must be a key of the relevant allowlist and the payload must match that key's JSON Schema, unless `disableSchemaValidation` is set.

Messages that fail are dropped with a `console.warn`. Function calls additionally get an error result so the app is never left waiting.
