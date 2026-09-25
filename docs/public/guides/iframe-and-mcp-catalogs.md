# Iframe and MCP catalogs

`@a2ui/catalog-iframe` and `@a2ui/catalog-mcp` add sandboxed web content to A2UI surfaces. The iframe catalog defines `WebAppFrameSrcdoc` and `WebAppFrameUrl`, which run an HTML document or an external web application in a sandboxed frame that talks to the surface through the `a2ui_*` message protocol. The MCP catalog defines `McpApp`, which runs an [MCP App](https://github.com/modelcontextprotocol/ext-apps) the same way and speaks the MCP Apps JSON-RPC protocol to it, next to the `callMcpTool` function and the data functions the catalog already had.

The three components are universal components: custom elements built on `A2uiLitElement` from `@a2ui/web_core`, which any renderer that hosts universal components can render. Today that is the Lit renderer. This guide covers installing the packages, serving the sandbox asset they need, registering the catalogs in a Lit application, and what the embedded content can do. Protocol detail lives in the two specification documents linked from [How an app talks to the host](#how-an-app-talks-to-the-host).

## Which component to use

All three components render one `<iframe>` whose content runs in an opaque origin, with no access to the host page's DOM, cookies or storage. They differ in where the content comes from and in how it talks to the host.

- `WebAppFrameSrcdoc` renders an HTML document the agent sends inline, in `htmlContent`. The document gets no network access: the host injects a Content Security Policy that blocks `fetch`, `XMLHttpRequest`, form submission and nested frames, and hyperlinks do not navigate, so everything the document knows comes from the handshake and the data model. Use it for model-generated UI and for small tools that ship with the agent.
- `WebAppFrameUrl` loads an application from an `http` or `https` URL, so the application serves its own scripts and can talk to its own backend. The host adds its origin to the URL as the `origin` query parameter. Use it for web applications that live on their own origin and implement the `a2ui_*` protocol.
- `McpApp` renders an HTML document inline, like `WebAppFrameSrcdoc`, but the document speaks the MCP Apps protocol instead of `a2ui_*`: a UI resource an MCP server returns, or any app written with the MCP Apps App SDK, works as it is. The tool calls listed in `allowedTools` become A2UI actions named after the tool, which is what lets an agent that proxies an MCP server answer them.

The two frame components share their configuration: `height`, `config` (static values handed to the app once), `data.paths` (data model paths the app reads, and writes when `mutableData` allows it), `allowedEvents`, `allowedFunctions` and `disableSchemaValidation`. `McpApp` has `title`, `allowedTools`, `allowedFunctions` and `data.paths`, and no `height`: it is 500px tall until the app asks for a size. The catalog READMEs list every property: [iframe catalog](../../../catalogs/iframe/README.md), [MCP catalog](../../../catalogs/mcp/README.md).

Every allowlist denies by default. An action that is not in `allowedEvents`, a function call that is not in `allowedFunctions`, a data write to a key that is not in `mutableData` and, for `McpApp`, a tool call that is not in `allowedTools` are dropped or rejected, and the host logs a warning.

## Installation

```bash
npm install @a2ui/catalog-iframe @a2ui/web_core lit
npm install @a2ui/catalog-mcp @a2ui/web_core lit
```

Install only the package you need; the two do not depend on each other. `@a2ui/web_core` and `lit` are peer dependencies of both, because a page must have exactly one copy of `Catalog`, `A2uiLitElement` and `LitElement` (see [Troubleshooting](#troubleshooting)). You also need the renderer, `@a2ui/lit`. `@a2ui/catalog-mcp` brings `@modelcontextprotocol/sdk` and `@modelcontextprotocol/ext-apps` with it; a Node agent that only needs the functions imports `@a2ui/catalog-mcp/functions` and does not need `lit` at runtime (see [The MCP functions without a browser](#the-mcp-functions-without-a-browser)).

## Serving the sandbox asset

The components never load untrusted content directly. They embed a proxy page served from your own origin, and the proxy creates the sandboxed inner frame the content runs in. Both packages ship this proxy in their `sandbox/` directory, `node_modules/@a2ui/catalog-iframe/sandbox/` and `node_modules/@a2ui/catalog-mcp/sandbox/` (in the repository it is the build output `dist/sandbox/`). The two copies are identical, so an application that uses both packages serves one of them. The directory holds three files:

- `sandbox.html`, the proxy page for inline HTML, loaded by `WebAppFrameSrcdoc` and `McpApp`. Its CSP keeps the inner frame from loading external URLs.
- `sandbox-url.html`, the proxy page for external URLs, loaded by `WebAppFrameUrl`. Its CSP lets the inner frame load any `http` or `https` URL.
- `sandbox.js`, the proxy script both pages load.

By default the components load the proxy from `/a2ui-sandbox/` on the host origin, resolved against the document base URL, so the directory has to be served there.

### Angular CLI

Add the directory to the `assets` array of the build options in `angular.json` (the format is documented under [assets configuration](https://angular.dev/reference/configs/workspace-config#assets-configuration)):

```json
{
  "glob": "**/*",
  "input": "node_modules/@a2ui/catalog-iframe/sandbox",
  "output": "a2ui-sandbox"
}
```

### Vite

Vite serves the [`public` directory](https://vite.dev/guide/assets.html#the-public-directory) as is and copies it into the build output, so a copy of the proxy in `public/a2ui-sandbox/` is served at `/a2ui-sandbox/` by `vite`, `vite build` and `vite preview`. The Lit explorer in the repository does this with a script that runs before Vite, [`scripts/copy-sandbox.mjs`](../../../renderers/lit/a2ui_explorer/scripts/copy-sandbox.mjs), and git-ignores the copy. The script locates the directory through the package's `catalog.json` export, which sits next to it:

```js
import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const catalogJsonPath = require.resolve('@a2ui/catalog-iframe/catalog.json');
const sourceDir = path.join(path.dirname(catalogJsonPath), 'sandbox');
const targetDir = path.resolve(import.meta.dirname, '../public/a2ui-sandbox');

rmSync(targetDir, {recursive: true, force: true});
mkdirSync(path.dirname(targetDir), {recursive: true});
cpSync(sourceDir, targetDir, {recursive: true});
```

A static-copy plugin does the same without a script. With [`vite-plugin-static-copy`](https://github.com/sapphi-red/vite-plugin-static-copy):

```ts
import {defineConfig} from 'vite';
import {viteStaticCopy} from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [{src: 'node_modules/@a2ui/catalog-iframe/sandbox/*', dest: 'a2ui-sandbox'}],
    }),
  ],
});
```

### Plain static server

Copy `node_modules/@a2ui/catalog-iframe/sandbox` (or the `@a2ui/catalog-mcp` copy) to `<web root>/a2ui-sandbox` and serve it from the same origin as the page.

### Serving it from another path

If the directory is served somewhere else, tell the package once at startup, before the first surface renders:

```ts
import {configureSandbox} from '@a2ui/catalog-iframe';

configureSandbox({baseUrl: '/static/frames/'});
```

Each package carries its own copy of this configuration, so an application that uses both packages calls both functions, `configureSandbox` from `@a2ui/catalog-iframe` and `configureSandbox` from `@a2ui/catalog-mcp`. `resolveSandboxUrl('html')` and `resolveSandboxUrl('url')` return the URLs the components load, which helps when checking a deployment.

`baseUrl` may also be an absolute URL on another origin, which isolates the proxy from the host page as well. The proxy only accepts an embedding page whose origin it knows, so list the host origin in the proxy page with a meta tag (the tag lives with the proxy, so an embedding page cannot widen the list):

```html
<meta name="a2ui-sandbox-host-origins" content="https://app.example.com" />
```

### The security self-test

When it starts, the proxy checks that it cannot reach the top window, which only holds when it is served from another origin than the host page. On the default same-origin deployment that check can never pass, so the components append `disable_security_self_test=true` to the proxy URL whenever it resolves to the host origin, and leave the test on when it does not. `configureSandbox({disableSecuritySelfTest: true})` or `false` overrides that choice in either direction.

### How the isolation works

The outer frame, the proxy page, is embedded without a `sandbox` attribute and served from your origin. It needs its real origin to check who embeds it (through `document.referrer`, against its own origin and the meta tag above) and to exchange messages with the host by origin. Keeping this frame same-origin is also what keeps browser developer tools and extensions working: a sandboxed frame placed directly in the page makes tooling that walks the frame tree fail with `SecurityError`.

The inner frame, which the proxy creates for the content, has `sandbox="allow-scripts allow-forms allow-modals"` for the frame components and `sandbox="allow-scripts"` for `McpApp`. Neither includes `allow-same-origin`, so the content runs in an opaque origin without access to the host's cookies, storage or DOM; `allow-top-navigation` and `allow-popups` are absent too, so the content cannot redirect the host window or open a new one. The inner frame also gets a Permissions Policy that denies camera, microphone, geolocation and clipboard access unless the resource asks for them, and inline HTML gets a Content Security Policy that blocks network requests, form submission, base URL changes, plugins and nested frames. The proxy relays messages between the host and the inner frame and rejects everything from any other origin or window. The specification documents linked below define these controls.

## Registering the catalogs with the Lit renderer

Each package exports its catalog with its components under the catalog id: `iframeCatalog` (id `IFRAME_CATALOG_ID`) and `mcpCatalog` (id `MCP_CATALOG_ID`, with the `McpApp` component and the data functions). Register them with the `MessageProcessor` next to the catalogs you already use:

```ts
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {iframeCatalog} from '@a2ui/catalog-iframe';
import {mcpCatalog} from '@a2ui/catalog-mcp';

const processor = new MessageProcessor([basicCatalog, iframeCatalog, mcpCatalog], action => {
  console.log('Action dispatched:', action);
});
```

A surface is bound to one catalog: the `catalogId` of its `createSurface` message selects one of the registered catalogs, and only that catalog's components and functions exist in it. A surface created with the iframe catalog id can therefore render frames, and nothing else. The catalog examples mix frames with basic components, and one of them calls the basic catalog's `formatCurrency` function from inside the frame, so they need a catalog that carries both sets under the iframe or MCP catalog id. This is what the Lit explorer builds in [`demo-catalogs.ts`](../../../renderers/lit/a2ui_explorer/src/demo-catalogs.ts):

```ts
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog, type LitComponentApi} from '@a2ui/lit/v0_9';
import {IFRAME_CATALOG_ID, iframeCatalog} from '@a2ui/catalog-iframe';
import {createMcpCatalogFunctions, MCP_CATALOG_ID, mcpCatalog} from '@a2ui/catalog-mcp';

// The processor reads this array lazily, so catalogs whose functions need the processor
// (callMcpTool does) are pushed once it exists.
const catalogs: Catalog<LitComponentApi>[] = [basicCatalog];
const processor = new MessageProcessor(catalogs, action => {
  console.log('Action dispatched:', action);
});

const basicComponents = [...basicCatalog.components.values()];
const basicFunctions = [...basicCatalog.functions.values()];
catalogs.push(
  new Catalog<LitComponentApi>(
    IFRAME_CATALOG_ID,
    [...basicComponents, ...iframeCatalog.components.values()],
    basicFunctions,
  ),
  new Catalog<LitComponentApi>(
    MCP_CATALOG_ID,
    [...basicComponents, ...mcpCatalog.components.values()],
    [...basicFunctions, ...createMcpCatalogFunctions(toolName => mcpClient, processor)],
  ),
);
```

`createMcpCatalogFunctions` takes the resolver that returns the MCP client for a tool name and the processor that receives the messages derived from tool results; the [`@a2ui/catalog-mcp` README](../../../typescript/catalogs/mcp/README.md) covers connecting the client and multi-server setups. An application without an MCP server passes a resolver that throws, as the explorer does, so that a `callMcpTool` call fails with a message that says so.

From here on the surfaces render as usual: `processor.processMessages(...)` and an `<a2ui-surface>` element per surface, as in the [Lit renderer README](../../../renderers/lit/README.md). Nothing about the components is specific to Lit apart from where the catalog is registered. Angular and React applications can use the same catalog objects once those renderers render universal components; the packages do not change, because registration is the renderer's job.

## Examples

The examples under [`catalogs/iframe/examples`](../../../catalogs/iframe/examples) and [`catalogs/mcp/examples`](../../../catalogs/mcp/examples) are message sequences that validate against their catalog combined with the basic catalog, and the Lit explorer renders all of them (`yarn dev` in `renderers/lit/a2ui_explorer`). Each one is a `createSurface` message, an `updateDataModel` message and an `updateComponents` message; the excerpts below show the frame component of the last one, with the markup shortened.

### A srcdoc app sharing a counter

[`00_srcdoc-shared-counter.json`](../../../catalogs/iframe/examples/00_srcdoc-shared-counter.json) puts a `WebAppFrameSrcdoc` under a `Text` that shows `Host view: ${/counter/count} ${/counter/label}` and a `TextField` bound to `/counter/label`:

```json
{
  "id": "counter_app",
  "component": "WebAppFrameSrcdoc",
  "height": 160,
  "data": {"paths": {"count": "/counter/count", "label": "/counter/label"}},
  "mutableData": {"count": {"type": "integer", "minimum": 0}},
  "allowedEvents": {
    "counter_saved": {
      "type": "object",
      "properties": {"count": {"type": "integer"}},
      "required": ["count"],
      "additionalProperties": false
    }
  },
  "htmlContent": "<!doctype html><html><body><p id=\"status\"></p><button id=\"add\">Add one</button><button id=\"save\">Save count</button><script>...</script></body></html>"
}
```

The user sees the heading, the host view reading `Host view: 0 clicks`, the label field and, in the frame, `0 clicks` with two buttons. The app received `{count: 0, label: "clicks"}` in the handshake. "Add one" increments the count in the app and sends an `a2ui_data_model_change` for `count`; because `count` is in `mutableData` and the value satisfies its schema, the host writes it to `/counter/count` and the host view changes to `1 clicks`. Typing in the label field changes `/counter/label`, and the host pushes an `a2ui_data_model_update` to the app, which re-renders. "Save count" sends an `a2ui_action` named `counter_saved` with `{count}`; it is in `allowedEvents`, so it reaches the processor's action handler as an action of the `counter_app` component, the same way a `Button` action would.

### A URL frame

[`01_url-frame.json`](../../../catalogs/iframe/examples/01_url-frame.json) loads an order tracker served from its own origin and gives it a static configuration and the `/orders` array:

```json
{
  "id": "order_tracker",
  "component": "WebAppFrameUrl",
  "url": "https://example.com/a2ui-apps/order-tracker/",
  "height": 400,
  "config": {"theme": "light", "locale": "en-US"},
  "data": {"paths": {"orders": "/orders"}},
  "allowedEvents": {
    "order_selected": {
      "type": "object",
      "properties": {"orderId": {"type": "string"}},
      "required": ["orderId"],
      "additionalProperties": false
    }
  }
}
```

The user sees the heading, a caption and a 400px frame in which the proxy loads `https://example.com/a2ui-apps/order-tracker/?origin=<host origin>`. When the application announces itself with `a2ui_app_frame_ready`, it receives `config`, the two orders under `initialData.orders`, the allowlists and the port for everything that follows. It can dispatch `order_selected` with an `orderId`; anything else is dropped. The example URL is a placeholder; point `url` at an application that implements the handshake to see the round trip.

### An MCP App calling a tool

[`00_inline-tool-call.json`](../../../catalogs/mcp/examples/00_inline-tool-call.json) is a single `McpApp` with a feedback form:

```json
{
  "id": "root",
  "component": "McpApp",
  "title": "Feedback form",
  "allowedTools": ["submit_feedback"],
  "htmlContent": "<!doctype html><html><body><label>Rating <input id=\"rating\" type=\"number\" min=\"1\" max=\"5\" value=\"5\" /></label><label>Comment <input id=\"comment\" type=\"text\" value=\"Great answer\" /></label><button id=\"send\">Send feedback</button><p id=\"status\"></p><script>...</script></body></html>"
}
```

The user sees a rating input, a comment input and a "Send feedback" button in a frame titled "Feedback form". On load the app sends `ui/initialize`, gets the host's capabilities back, sends `ui/notifications/initialized` and asks for a height of 180px with `ui/notifications/size-changed`, which the host applies. Clicking the button sends a `tools/call` request for `submit_feedback` with the rating and the comment. The tool is in `allowedTools`, so the host answers the request with an empty result and dispatches an action named `submit_feedback` from the `root` component, with the arguments as its context; the app shows "Thanks for the feedback." A tool that is not listed gets a JSON-RPC error (`-32602`) instead, and the app shows the rejection.

The second MCP example, [`01_data-binding.json`](../../../catalogs/mcp/examples/01_data-binding.json), binds `/player` into an app through `data.paths` and shows the two-way sync next to basic components: the MCP Apps counterpart of the counter example.

## How an app talks to the host

### The `a2ui_*` protocol of the frame components

A frame application needs no library. It registers a `message` listener, posts `{type: "a2ui_app_frame_ready"}` to `window.parent`, and receives `a2ui_app_frame_init` back with `config`, `initialData` (the current values of `data.paths`), the `allowedEvents` and `allowedFunctions` maps, the `mutableData` keys, the host context (container dimensions) and, as `event.ports[0]`, a `MessagePort`. Everything after the handshake travels over that port:

- from the app: `a2ui_action` (`action`, `data`), `a2ui_data_model_change` (`key`, optional `subpath`, `value`), `a2ui_function_call` (`call`, `callId`, `args`) and `a2ui_size_changed` (`height`, `width`);
- from the host: `a2ui_data_model_update` when a bound value changes, `a2ui_function_result` (`callId`, `status`, `result` or `error`) and `a2ui_host_context_update`.

The host checks every message for prototype pollution keys, nesting depth and size, matches it against the allowlist of its kind and validates its payload against the JSON Schema listed there, unless `disableSchemaValidation` is set. The [WebApp iframe component specification](../../../catalogs/iframe/web_app_frame_specification.md) defines the messages, the handshake and the security controls; the two srcdoc examples are complete working apps.

### The MCP Apps protocol of `McpApp`

`McpApp` speaks the MCP Apps protocol from `@modelcontextprotocol/ext-apps`: JSON-RPC 2.0 messages over `postMessage`, with the host side implemented by the SDK's `AppBridge`. The app sends `ui/initialize` and `ui/notifications/initialized`; the host answers `ui/initialize` with its capabilities and the frame's dimensions and sends `ui/notifications/host-context-changed` on resize. After that the app can send `tools/call` (allowed tools become actions), `ui/notifications/size-changed` and `notifications/message` (logged to the console), plus two A2UI extensions: `ui/requests/function-call` for the functions in `allowedFunctions`, answered with `{status: "success", result}` or a JSON-RPC error, and `ui/notifications/data-model-change` to write a bound path, which the host mirrors with `ui/notifications/data-model-update` when a bound value changes. The [MCP App component specification](../../../catalogs/mcp/mcp_app_specification.md) defines the methods and their parameters; the MCP examples implement the protocol by hand in a few lines, and apps built with the MCP Apps App SDK need nothing extra.

## The MCP functions without a browser

`@a2ui/catalog-mcp/functions` exports `MCP_CATALOG_ID`, `createMcpCatalogFunctions`, `createCallMcpToolImplementation` and the data functions (`jmespath`, `split`, `regexCapture`, `regexReplace`, `updateDataModel`) without importing anything that needs a DOM, so an agent or a test running in Node builds the functions with the same code a browser uses:

```ts
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {createMcpCatalogFunctions, MCP_CATALOG_ID} from '@a2ui/catalog-mcp/functions';

const catalogs: Catalog<any>[] = [];
const processor = new MessageProcessor(catalogs, onAction);

const functions = createMcpCatalogFunctions(toolName => clientFor(toolName), processor);
catalogs.push(new Catalog(MCP_CATALOG_ID, [], functions));
```

The main entry point re-exports all of it, so browser code imports everything from `@a2ui/catalog-mcp`. `@a2ui/catalog-mcp/components` exports the component and its bridge without the functions.

## Troubleshooting

### The frame stays empty and the network panel shows a 404 under `/a2ui-sandbox/`

The proxy is not served where the components look for it, so its ready signal never arrives and the content is never sent. Check that the copy step or the `assets` entry ran for the deployment you are looking at (the Vite copy lives in `public/`, which the dev server and the build both read; a change to `angular.json` applies on the next `ng serve`), that `/a2ui-sandbox/sandbox.html` is reachable on the page's origin, and, if you serve the directory elsewhere, that `configureSandbox({baseUrl})` ran before the first surface rendered, in every package you use. Logging `resolveSandboxUrl('html').href` shows the URL a component would load.

### The app loads but does nothing, or stays on its waiting state

The host dropped or rejected a message. The browser console shows a warning for each one: an `a2ui_action` whose name is not in `allowedEvents`, an `a2ui_data_model_change` for a key not in `mutableData`, a payload that fails the JSON Schema declared for it and, for `McpApp`, a `tools/call` for a tool not in `allowedTools` (the app receives error `-32602`). A function call needs two things: the function must be a key of `allowedFunctions`, and it must exist in the surface's catalog, which is why a frame that calls `formatCurrency` needs the composed catalog above and not the bare `iframeCatalog`. An unlisted function is answered with `NOT_ALLOWED`, invalid arguments with `VALIDATION_ERROR` and a function that throws with `EXECUTION_ERROR`. For `WebAppFrameUrl`, a `url` that is not `http` or `https` loads nothing and is reported once with `console.warn`.

### Custom element errors, or components that render empty

Two copies of `lit` or `@a2ui/web_core` on the page cause `Custom element tag name collision` errors from the renderer, Lit's "Multiple versions of Lit loaded" warning, and elements whose base class the renderer does not recognize. Both are peer dependencies of the catalog packages so that the package manager installs one copy; `npm ls lit @a2ui/web_core` (or `yarn why`) shows whether it did, and `npm dedupe` usually fixes it. Vite users can also add `resolve: {dedupe: ['lit']}` to `vite.config.ts`, as the Lit explorer does. Every package in the page has to use the same `@a2ui/web_core` version as the renderer.

## Further reading

- [`@a2ui/catalog-iframe` README](../../../typescript/catalogs/iframe/README.md): every property, styling, the host bridge and how to write another sandboxed frame component on `SandboxedFrameElement`.
- [`@a2ui/catalog-mcp` README](../../../typescript/catalogs/mcp/README.md): `callMcpTool`, the data functions, the `McpApp` bridge and the sandbox setup from the package's point of view.
- [MCP Apps in A2UI](mcp-apps-in-a2ui.md): the end-to-end samples with a real MCP server and proxy agent.
- [Defining your own catalog](defining-your-own-catalog.md) and [Authoring custom components](authoring-components.md) for catalogs and components of your own.
