# ReactApp bridge protocol

Status: draft, version 1 (labs prototype).

This document is normative for the messages a `ReactApp` frame and its host exchange. The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Parties and transport

1. The **host** is the `ReactApp` component in the page that renders the A2UI surface (`@a2ui-labs/react-app`). It owns a `ComponentContext`, so it can read and write the surface data model, invoke catalog functions (including agent functions) and dispatch actions.
2. The **app** is the generated React app running in the inner frame of the double-iframe sandbox, on top of the runtime (`@a2ui-labs/react-app-runtime`). The app code never posts messages itself; the `a2ui` module does it for the app.
3. The **proxy** is the shared sandbox proxy page between them (`typescript/catalogs/shared/sandbox/sandbox.ts`). It loads the app document into an inner `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so the app has an opaque origin), then relays every other message unchanged in both directions. The proxy checks origins: it accepts host messages only from the embedding origin, and app messages only from its inner frame.
4. Every bridge message is a JSON-RPC 2.0 object sent with `postMessage`. The host posts to the proxy window with the proxy origin as the target. The app posts to `window.parent` with target `*`, since its own origin is opaque. The host MUST accept a message only when `event.source` is the proxy window and `event.origin` is the proxy origin. The app MUST accept a message only when `event.source` is `window.parent`.
5. Messages with a `jsonrpc` value other than `"2.0"`, or a `method` outside this document, MUST be ignored by the receiver, apart from requests with an unknown method, which get a `-32601` error. This leaves room for the proxy's own handshake messages (`ui/notifications/sandbox-proxy-ready`, `a2ui_sandbox_proxy_ready`, `sandbox-init`), which are not part of this protocol.

## 2. Lifecycle

```mermaid
sequenceDiagram
  participant H as Host (ReactApp element)
  participant P as Proxy frame
  participant A as App frame (runtime)
  H->>P: load sandbox.html
  P-->>H: sandbox-proxy-ready
  H->>P: sandbox-resource-ready {html, sandbox, csp}
  P->>A: srcdoc = app document
  A->>H: reactApp/initialize (request)
  H-->>A: result {theme, containerSize, dataSnapshot}
  A->>A: transpile source, render App
  A-)H: ui/rendered
  A->>H: data/set, function/call, action/dispatch ...
  H-)A: data/changed, theme/changed
```

1. The host builds the **app document**, a complete HTML document with:
    1. an import map that maps the module names in section 9 to the runtime's content-hashed files,
    2. the runtime stylesheet (`a2ui-lite.css`),
    3. a `<script type="application/json" id="a2ui-react-app-config">` holding `{"source": string, "compiled"?: string, "title"?: string}`, with every `<` written as `\u003c`,
    4. an inline module script that imports the runtime entry and starts it.
2. The host sends the document as the `html` of the sandbox resource, with `sandbox: "allow-scripts"` and `csp.resourceDomains` set to the origin that serves the runtime. The proxy adds a CSP meta tag whose `script-src`, `style-src` and `font-src` allow that origin; `connect-src` and `frame-src` stay `'none'`.
3. A change of `source`, `compiled` or `title` changes the document, so the frame reloads and a new bridge session starts. Other property changes (`dataPaths`, `functions`, `actions`, `height`) apply to the running session.
4. Once loaded, the runtime MUST send `reactApp/initialize` before any other request. The host MUST answer every other request that arrives before `reactApp/initialize` with error `-32002`.
5. After the initialize response, the runtime starts loading the theme's `fontFaces`, transpiles the source (unless `compiled` is present) and imports it. It then waits for the fonts, for at most 2 seconds, renders the default export into `#root`, and sends `ui/rendered` after the first commit has painted. The default export can be any component: a function, a class, or a `memo`, `forwardRef` or `lazy` wrapper. `VegaChart` also waits for the fonts before it draws, because Vega measures label text on a canvas.
6. A session ends when the frame reloads or the host disconnects the bridge. The host MUST drop its subscriptions, and MUST NOT answer requests from a previous session.

## 3. Methods

All `params` and `result` values are JSON objects. Paths are JSON pointers: an absolute path (`/loan/rate`) addresses the surface data model, and a relative path (`rate`) resolves against the component's data context, as A2UI `@path` bindings do.

### 3.1. `reactApp/initialize` (app to host, request)

Params:

| Field             | Type     | Meaning                                                                                                                                                            |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protocolVersion` | `"1"`    | Bridge protocol version the runtime speaks.                                                                                                                        |
| `runtimeVersion`  | string   | Version of the runtime package.                                                                                                                                    |
| `paths`           | string[] | Paths the app will read during its first render. The runtime finds them by scanning the source for string literals passed to `useData`, `getData` and `subscribe`. |

Result:

| Field             | Type                                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocolVersion` | `"1"`                                | Bridge protocol version the host speaks.                                                                                                                                                                                                                                                                                                                                                                                          |
| `theme`           | `{colorScheme, cssVars, fontFaces?}` | `colorScheme` is `"light"` or `"dark"`; `cssVars` maps each `--a2ui-*` custom property name to its computed value on the host element. `fontFaces` lists the faces of the theme fonts as `{family, src, weight?, style?}`, where `src` is a CSS `src` value such as `url(data:font/woff2;base64,…) format("woff2")`; the frame can't see the page's `@font-face` rules, so without them a theme font falls back to a system font. |
| `containerSize`   | `{width, height}`                    | Size of the frame in CSS pixels.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `dataSnapshot`    | `{[path]: value}`                    | Current value of every requested path the allowlist permits. A path with no value is omitted.                                                                                                                                                                                                                                                                                                                                     |
| `deniedPaths`     | string[]                             | Requested paths the allowlist refused.                                                                                                                                                                                                                                                                                                                                                                                            |

The host MUST subscribe to every path in `dataSnapshot` as if the app had sent `data/subscribe`, so changes made between the snapshot and the app's first render reach the app. The runtime MUST seed its store with `dataSnapshot` before the first render, so `useData` returns real values on the first paint.

If the protocol versions differ, the host MUST answer with error `-32602`, and the runtime MUST show its error card.

### 3.2. `data/get` (app to host, request)

Params `{path}`. Result `{value}`; `value` is absent when the path holds nothing.

### 3.3. `data/set` (app to host, request)

Params `{path, value, seq}`. `seq` is a positive integer that increases with every write the session sends (across all paths). Result `{seq, value}`, where `value` is the value at `path` after the write.

1. The host MUST apply writes in the order it receives them. `postMessage` preserves order, so this is the order the app sent them.
2. A write whose value equals the current value (by JSON structural equality) MUST succeed without touching the data model.
3. The host MUST NOT send a `data/changed` for a path because of the app's own write (echo suppression). Other subscribers of the path (native components, other ReactApps) are notified as usual.
4. `value` MAY be `null`; there is no delete operation in version 1.

### 3.4. `data/subscribe` and `data/unsubscribe` (app to host, request)

Params `{path}`. `data/subscribe` results in `{value}`, the current value (absent when none), and from then on the host sends `data/changed` for the path. Subscribing to a path the session already subscribes to MUST NOT create a second host subscription. `data/unsubscribe` results in `{}` and stops the notifications.

### 3.5. `data/changed` (host to app, notification)

Params `{path, value}`; `value` is absent when the path no longer holds anything. Sent for each subscribed path whose value changes for a reason other than the app's own write, at most once per data model notification. The host compares by JSON structural equality and MUST NOT send a value equal to the last one it sent for that path.

### 3.6. `function/call` (app to host, request)

Params `{name, args}`; `args` is an object of named arguments. Result `{value}`.

1. The host invokes the function with the invoker of the first catalog that declares `name`: the component's own catalog, then the surface's default catalog, then every catalog available to the surface. A name no catalog declares goes to the default catalog's invoker (or the component catalog's, on a surface without a default). This differs from the shared `ComponentContextFrameHost`, which only tries the component's catalog and the default, and so fails on the surfaces without a default catalog that the Express compiler creates for several catalogs. On a v1.0 surface whose message processor has an outbound listener, a function the renderer does not implement locally (undeclared, or declared schema-only) is routed to the agent with a `callAgentFunction` RPC. The host doesn't need to know which kind it is.
2. The host MUST await a promise result. A signal result is read once.
3. A function that throws, rejects or is refused (for example `allowedCallers: agentOnly`, invalid arguments) results in error `-32010` with the error message.
4. The runtime's default timeout for this method is 30 seconds (the default timeout of `callAgentFunction` in web_core), and callers MAY change it per call.

### 3.7. `action/dispatch` (app to host, request)

Params `{name, context}`. The host dispatches an A2UI `event` action of the component with that name and context, so action listeners see the `ReactApp` as its source. Result `{}` once the dispatch resolves.

An action can tell the agent to book, buy or send something, so the host checks every request, in this order, before it dispatches:

1. `name` MUST be in the component's `actions` allowlist (section 4). Otherwise the host answers `-32017`.
2. The host page MUST have transient user activation (`navigator.userActivation.isActive`) when the request arrives. A click or key press in the app frame activates the host page too, since user activation propagates to ancestor frames across origins, and it stays active for a few seconds. A dispatch from an effect, a timer or a promise that resolves later than that has no activation, and gets `-32015`. A browser without the User Activation API has no activation either, so it refuses every action.
3. The host accepts at most 5 dispatches per second per frame, and answers `-32016` to the rest.

These checks apply only to the app. Actions of native components don't go through the bridge, so they are unaffected.

### 3.8. `ui/rendered` (app to host, notification)

Params `{timings}`, where every timing is in milliseconds since the app document's time origin (`performance.timeOrigin` of the inner frame):

| Field          | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| `runtimeReady` | The runtime module started.                                          |
| `initialized`  | The initialize response arrived.                                     |
| `compiled`     | The source was transpiled and imported (or `compiled` was imported). |
| `rendered`     | The first commit painted (measured after two animation frames).      |
| `transpileMs`  | Time spent in Sucrase; `0` when `compiled` was used.                 |

The host records its own clock at the proxy's ready message and at `ui/rendered`, and reports the difference as the frame's time to first render.

### 3.9. `ui/resize` (app to host, notification)

Params `{height, width?}` in CSS pixels: the size the app's content needs. The host applies it within the limits of the shared `FrameSizing` (clamped and throttled). The runtime sends it when the document's scroll height changes, at most once per animation frame.

### 3.10. `ui/error` (app to host, notification)

Params `{phase, message, stack?, line?, column?, blockedUri?, directive?}`. `phase` is one of:

1. `compile`: Sucrase failed. `line` and `column` point into `source`.
2. `load`: importing the compiled module failed, or its default export isn't a component. An import of a module that section 9 doesn't list fails here, and the message names that module and the available ones.
3. `render`: a React error boundary caught an error.
4. `runtime`: an uncaught error or unhandled rejection in the app.
5. `bridge`: a request failed (the runtime also rejects the caller's promise).
6. `csp`: the frame's content security policy blocked a request or a load, for example a `fetch` or a script from a CDN. `blockedUri` is what was blocked (a URL, `inline` or `eval`) and `directive` the directive that blocked it. The runtime reports each distinct violation once, and at most 5 per second.

The runtime ships the production build of React, whose errors read `Minified React error #321; visit …`. The runtime replaces the ones generated apps commonly hit (#31, #130, #152, #185, #300, #301, #310, #321 and #482) with a readable message that says what to change, in `message` and on the error card.

The runtime MUST show an error card in the frame for `compile`, `load` and `render`. The host MUST log every `ui/error` and SHOULD expose it to the page (the reference host dispatches a `react-app-error` DOM event from the element).

### 3.11. `ui/log` (app to host, notification)

Params `{level, args}`, with `level` one of `debug`, `info`, `warn`, `error` and `args` the logged values made JSON-safe. The runtime forwards `console` calls of the app. The host MAY log or display them.

### 3.12. `theme/changed` (host to app, notification)

Params `{colorScheme, cssVars, fontFaces?}`, same shape as `theme` in section 3.1. The host sends it when the page's color scheme changes, or when the page calls the element's theme refresh method. The runtime sets the variables on `:root`, so CSS that uses `var(--a2ui-*)` updates without a re-render, and re-renders components that use `useTheme`. It loads the font faces it hasn't loaded before.

## 4. Allowlists

1. `dataPaths` (component property): a path is allowed if it equals an entry or starts with an entry followed by `/`. `/loan` allows `/loan` and `/loan/rate`, but not `/loans` or `/`. Relative paths are checked as written, before resolution.
2. `functions` (component property): a function is allowed if its name is in the list.
3. `actions` (component property): an action is allowed if its name is in the list.
4. An absent list allows nothing, the same as an empty one. The model is asked to write all three lists, and the agent server (`ReactAppTransformer`) fills in a missing one from the calls in `source` before the component ships, so a missing list in the browser means the app gets no access.
5. A refused path results in error `-32011`, a refused function in error `-32012` and a refused action in error `-32017`. The host reads the allowlists on every request, so a property update applies at once.
6. The reference host reports every refusal, including the payload, gesture and rate limit refusals of sections 3.7 and 8, to the page as a `denied` bridge event with the reason, the method, the refused path or name and the error code.

## 5. Ordering and consistency

1. Requests are independent; the host MAY answer them out of order (a slow agent function doesn't hold back a `data/set`).
2. The runtime updates its own store before sending `data/set` (optimistic write), so `useData` re-renders at once.
3. While a path has writes in flight, the runtime MUST ignore `data/changed` for it. When the last in-flight write for a path is acknowledged, the runtime sets the path to the `value` of that response. Since the host applies writes in arrival order, this value is the data model's state after the app's last write, including any change the host made in between.
4. If the last in-flight write for a path fails, the runtime re-reads the path with `data/get` (the data model may hold an earlier write or a host change) and reports `ui/error` with phase `bridge`.
5. A `data/get` or `data/subscribe` answer for a path that the app wrote after sending the request is dropped, so a slow read never undoes a newer write.
6. `useFunction` gives every call a sequence number and only keeps the result of the latest one, so an older response that arrives late never replaces a newer one.

## 6. Timeouts

1. The runtime MUST fail a request whose response doesn't arrive in time with error `-32013` and forget its id: a late response is ignored.
2. Default timeouts: 10 seconds for `reactApp/initialize`, `data/*` and `action/dispatch`; 30 seconds for `function/call`. Callers MAY pass `timeoutMs` to `callFunction`.
3. The host has no timeouts of its own. `callAgentFunction` has its own timeout in the message processor (30 seconds by default), and a timeout there arrives as a `-32010` error.

## 7. Errors

Errors use the JSON-RPC `error` member: `{code, message, data?}`.

| Code     | Name                 | When                                                                                          |
| -------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `-32600` | Invalid request      | The message isn't a valid JSON-RPC request.                                                   |
| `-32601` | Method not found     | Unknown method.                                                                               |
| `-32602` | Invalid params       | Missing or mistyped params, or a protocol version mismatch.                                   |
| `-32603` | Internal error       | Unexpected host failure.                                                                      |
| `-32001` | Payload rejected     | The message breaks the limits of section 8.                                                   |
| `-32002` | Not initialized      | A request other than `reactApp/initialize` arrived first.                                     |
| `-32010` | Function failed      | The function threw, rejected or was refused by the invoker. `data.name` is the function name. |
| `-32011` | Path not allowed     | The path is outside `dataPaths`. `data.path` is the path.                                     |
| `-32012` | Function not allowed | The function is outside `functions`. `data.name` is the function name.                        |
| `-32013` | Timeout              | Runtime-side only: no response in time.                                                       |
| `-32014` | Action failed        | The action dispatch rejected.                                                                 |
| `-32015` | Action needs gesture | `action/dispatch` arrived without user activation in the host (section 3.7). `data.name`.     |
| `-32016` | Too many requests    | More than 5 `action/dispatch` requests in a second (section 3.7). `data.name`.                |
| `-32017` | Action not allowed   | The action is outside `actions`. `data.name` is the action name.                              |

The runtime turns an error response into a rejected promise with an `Error` whose `message` is the error message and whose `code` property is the code.

### 7.1. Reporting app errors to the agent

The agent wrote the app, so it has to learn when the app fails. For a `ui/error` with phase `compile`, `load`, `render`, `runtime` or `csp`, the host reports an A2UI v1.0 renderer-to-agent `error` message, using the generic branch of `specification/v1_0/json/renderer_to_agent.json`:

```json
{
  "version": "1.0",
  "error": {
    "code": "REACT_APP_ERROR",
    "message": "The ReactApp chart failed in phase render: Cannot read properties of undefined (reading 'map')",
    "surfaceId": "plan",
    "componentId": "chart",
    "phase": "render",
    "line": 12,
    "column": 5
  }
}
```

1. The host reports only the first such error of each app document: a crashed app tends to fail the same way again, and a new `source` makes a new document. `bridge` errors are never reported, because the app already got the error response.
2. The host reports at most 3 errors per minute per component, so a page that reloads apps quickly can't flood the agent.
3. `message` holds at most 1000 characters. `line` and `column` are present when the runtime knows them.
4. The reference host passes the error body to `SurfaceModel.dispatchError`, the same error channel web_core uses for its own renderer errors, so it reaches `MessageProcessor.model.onError` and `SurfaceModel.onError`. The page wraps it as `{version: "1.0", error}` and sends it to the agent next to its actions and `callAgentFunction` messages. The element still dispatches its `react-app-error` DOM event for every error.

## 8. Limits

1. The host MUST check every message from the app with the shared `validateMessagePayload` (`typescript/catalogs/shared/sandbox/payload_validation.ts`): at most 64 KB serialized, at most 10 levels of nesting, and no `__proto__`, `constructor` or `prototype` keys. A request that fails gets error `-32001`; a notification that fails is dropped and logged.
2. Path segments MUST NOT be `__proto__`, `constructor` or `prototype` (after JSON pointer unescaping); the host answers `-32602`.
3. Host-to-app messages have no size limit, since the host trusts its own data model.
4. `ui/resize` heights are clamped by `FrameSizing`; `ui/log` and `ui/error` are rate limited to 50 messages per second per frame, and the host drops the rest.

## 9. Modules available to the app

The import map of the app document maps these names. Any other bare import fails to resolve, and the runtime reports it as a `load` error.

| Module                          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`                         | React 19.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `react/jsx-runtime`             | Used by the transpiled JSX; apps don't import it directly.                                                                                                                                                                                                                                                                                                                                                                                    |
| `react-dom`, `react-dom/client` | React DOM 19; apps rarely need them, since the runtime mounts `App`.                                                                                                                                                                                                                                                                                                                                                                          |
| `a2ui`                          | The bridge API and primitives, typed by [`a2ui.d.ts`](../typescript/react_app_runtime/src/a2ui.d.ts).                                                                                                                                                                                                                                                                                                                                         |
| `a2ui:bindings`                 | Typed wrappers over `callFunction`, one per catalog function. The agent generates the declarations from its catalogs (`react_app_bindings`); the runtime builds the module from the names the app imports or uses on a namespace or default import, so nothing extra travels with the app. Only ASCII identifiers that aren't reserved words ([`reserved_words.json`](../typescript/react_app_runtime/src/reserved_words.json)) are exported. |

The runtime itself is the `a2ui-runtime` entry. Sucrase and `vega-embed` (with Vega and Vega-Lite) are chunks of the runtime build rather than import map entries: Sucrase loads only when the app arrives without `compiled`, and Vega on the first `VegaChart` render.

## 10. Versioning

The runtime is served under a versioned directory (`.../react-app/v1/`) whose files have content hashes in their names. The catalog version pins the runtime major version, so the agent prompt, the `a2ui.d.ts` and the host agree. A breaking change to this protocol increments `protocolVersion` and the catalog version together.
