# Iframe catalog

`@a2ui/catalog-iframe` adds sandboxed web content to A2UI surfaces. It defines `WebAppFrameSrcdoc` and `WebAppFrameUrl`, which run an HTML document or an external web application in a sandboxed frame that talks to the surface through the `a2ui_*` message protocol.

Both components are universal components: custom elements built on `A2uiLitElement` from `@a2ui/web_core`, which any renderer that hosts universal components can render. The catalog targets A2UI v1.0. This guide covers choosing between the two components, installing the package, serving the sandbox asset they need, registering the catalog with the message processor, and what the embedded content can do. Protocol detail lives in the specification document linked from [How an app talks to the host](#how-an-app-talks-to-the-host).

## Which component to use

Both components render one `<iframe>` whose content runs in an opaque origin, with no access to the host page's DOM, cookies or storage. They differ in where the content comes from.

- `WebAppFrameSrcdoc` renders an HTML document the agent sends inline, in `htmlContent`. The document gets no network access: the host injects a Content Security Policy that blocks `fetch`, `XMLHttpRequest`, form submission and nested frames (a policy the author adds can only narrow it), and hyperlinks do not navigate: a click is reported as an `open_url` action with the link's `url`, which reaches the host only when `open_url` is listed in `allowedEvents`. Everything the document knows comes from the handshake and the data model. Use it for model-generated UI and for small tools that ship with the agent.
- `WebAppFrameUrl` loads an application from an `http` or `https` URL, so the application serves its own scripts and can talk to its own backend. The host adds its origin to the URL as the `origin` query parameter. Use it for web applications that live on their own origin and implement the `a2ui_*` protocol.

The two frame components share their configuration: `height`, `config` (static values handed to the app once), `data.paths` (data model paths the app reads, and writes when `mutableData` allows it), `allowedEvents`, `allowedFunctions` and `disableSchemaValidation`. The host reads `config` and `data.paths` when the app connects, so a later change to either applies at the next handshake; the allowlists are read again for every message. The [iframe catalog README](../../../catalogs/iframe/README.md) lists every property.

Every allowlist denies by default. An action that is not in `allowedEvents`, a function call that is not in `allowedFunctions`, and a data write to a key that is not in `mutableData` are dropped or rejected, and the host logs a warning.

## Installation

```bash
npm install @a2ui/catalog-iframe @a2ui/web_core lit
```

`@a2ui/web_core` and `lit` are peer dependencies, because a page must have exactly one copy of `Catalog`, `A2uiLitElement` and `LitElement` (see [Troubleshooting](#troubleshooting)). You also need a renderer that hosts universal components, such as `<a2ui-surface>` from `@a2ui/lit`.

## Serving the sandbox asset

The components never load untrusted content directly. They embed a proxy page served from your own origin, and the proxy creates the sandboxed inner frame the content runs in. The package ships this proxy in its `sandbox/` directory, `node_modules/@a2ui/catalog-iframe/sandbox/` (in the repository it is the build output `dist/sandbox/`). The directory holds three files:

- `sandbox.html`, the proxy page for inline HTML, loaded by `WebAppFrameSrcdoc`. Its CSP keeps the inner frame from loading external URLs.
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

Vite serves the [`public` directory](https://vite.dev/guide/assets.html#the-public-directory) as is and copies it into the build output, so a copy of the proxy in `public/a2ui-sandbox/` is served at `/a2ui-sandbox/` by `vite`, `vite build` and `vite preview`. A script that runs before Vite can make that copy (and git-ignore it), locating the directory through the package's `catalog.json` export, which sits next to it:

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
      targets: [
        {
          src: 'node_modules/@a2ui/catalog-iframe/sandbox/*',
          dest: 'a2ui-sandbox',
        },
      ],
    }),
  ],
});
```

### Plain static server

Copy `node_modules/@a2ui/catalog-iframe/sandbox` to `<web root>/a2ui-sandbox` and serve it from the same origin as the page.

### Serving it from another path

If the directory is served somewhere else, tell the package once at startup, before the first surface renders:

```ts
import {configureSandbox} from '@a2ui/catalog-iframe';

configureSandbox({baseUrl: '/static/frames/'});
```

`resolveSandboxUrl('html')` and `resolveSandboxUrl('url')` from `@a2ui/catalog-iframe` return the URLs the components load, which helps when checking a deployment.

`baseUrl` may also be an absolute URL on another origin, which isolates the proxy from the host page as well. The proxy only accepts an embedding page whose origin it knows, so list the host origin in the proxy page with a meta tag (the tag lives with the proxy, so an embedding page cannot widen the list):

```html
<meta name="a2ui-sandbox-host-origins" content="https://app.example.com" />
```

### The security self-test

When it starts, the proxy checks that it cannot reach the top window, which only holds when it is served from another origin than the host page. On the default same-origin deployment that check can never pass, so the components append `disable_security_self_test=true` to the proxy URL whenever it resolves to the host origin, and leave the test on when it does not. `configureSandbox({disableSecuritySelfTest: true})` or `false` overrides that choice in either direction.

### How the isolation works

The outer frame, the proxy page, is embedded without a `sandbox` attribute and served from your origin. It needs its real origin to check who embeds it (through `document.referrer`, against its own origin and the meta tag above) and to exchange messages with the host by origin. Keeping this frame same-origin is also what keeps browser developer tools and extensions working: a sandboxed frame placed directly in the page makes tooling that walks the frame tree fail with `SecurityError`.

The inner frame, which the proxy creates for the content, has `sandbox="allow-scripts allow-forms allow-modals"`. It does not include `allow-same-origin`, so the content runs in an opaque origin without access to the host's cookies, storage or DOM; `allow-top-navigation` and `allow-popups` are absent too, so the content cannot redirect the host window or open a new one. The inner frame also gets a Permissions Policy that denies camera, microphone, geolocation and clipboard access, and inline HTML gets a Content Security Policy that blocks network requests, form submission, base URL changes, plugins and nested frames. The proxy relays messages between the host and the inner frame and rejects everything from any other origin or window. The specification document linked below defines these controls.

## Registering the catalog

The package exports its catalog with its components under the catalog id: `iframeCatalog` (id `IFRAME_CATALOG_ID`) from `@a2ui/catalog-iframe`. Register the catalog with the `MessageProcessor` next to the catalogs you already use:

```ts
import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import {iframeCatalog} from '@a2ui/catalog-iframe';

const processor = new MessageProcessor([basicCatalog, iframeCatalog], action => {
  console.log('Action dispatched:', action);
});
```

A surface starts in one catalog: the `catalogId` of its `createSurface` message selects the default among the registered catalogs, and every other registered catalog with a compatible protocol version is available to the surface. A component picks another catalog by setting its own `catalogId`, so a surface created with the basic catalog can hold a `WebAppFrameSrcdoc` or `WebAppFrameUrl` next to basic components. The catalog examples all do this: their `createSurface` names the basic catalog and only the frame carries the iframe catalog id:

```json
{
  "id": "order_tracker",
  "catalogId": "https://a2ui.org/specification/v1_0/catalogs/iframe/catalog.json",
  "component": "WebAppFrameUrl",
  "url": "https://example.com/order-tracker"
}
```

Functions resolve the same way: a frame that calls a function first looks in its own catalog and then in the surface's default catalog, so a frame in a basic surface can call `formatCurrency` or `formatString`.

From here on the surfaces render as usual: `processor.processMessages(...)` and an `<a2ui-surface>` element per surface, as in the [Lit renderer README](../../../typescript/renderers/lit/README.md). Nothing about the components is specific to Lit apart from where the catalog is registered. Angular and React applications can use the same `iframeCatalog` object once those renderers render universal components; the package does not change, because registration is the renderer's job.

## Examples

The examples under [`catalogs/iframe/examples`](../../../catalogs/iframe/examples) are message sequences that validate against the iframe catalog combined with the basic catalog (`specification/scripts/validate.py`). Each one is a `createSurface` message, an `updateDataModel` message and an `updateComponents` message; the excerpts below show the frame component of the last one, with the markup shortened.

### A srcdoc tip calculator

[`srcdoc-tip-calculator.json`](../../../catalogs/iframe/examples/srcdoc-tip-calculator.json) puts a `WebAppFrameSrcdoc` between two `TextField`s bound to `/bill/amount` and `/bill/tipPercent` and a `Text` that shows `Total to pay: ${/bill/totalLabel}`:

```json
{
  "id": "tip_calculator",
  "component": "WebAppFrameSrcdoc",
  "height": 240,
  "config": {"currency": "USD", "locale": "en-US"},
  "data": {
    "paths": {
      "amount": "/bill/amount",
      "tipPercent": "/bill/tipPercent",
      "total": "/bill/total",
      "totalLabel": "/bill/totalLabel"
    }
  },
  "mutableData": {"total": {"type": "number", "minimum": 0}, "totalLabel": {"type": "string"}},
  "allowedEvents": {
    "receipt_saved": {"type": "object", "required": ["amount", "tipPercent", "total"]},
    "open_url": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}
  },
  "allowedFunctions": {
    "formatCurrency": {"type": "object", "required": ["value", "currency"]}
  },
  "htmlContent": "<!doctype html><html><body><table>...</table><button id=\"save\">Save receipt</button><a href=\"https://en.wikipedia.org/wiki/Gratuity\">How tipping works</a><script>...</script></body></html>"
}
```

The app receives the bill and its `config` in the handshake, computes the tip and writes `total` back; because `total` is in `mutableData`, the host stores it at `/bill/total`. It then calls `formatCurrency` with the currency from `config`. The host answers with `a2ui_function_result`, and the app writes the formatted string to `totalLabel`, so the sibling `Text` reads `Total to pay: $75.52`. Editing either field pushes an `a2ui_data_model_update` to the app, which recomputes. "Save receipt" sends `receipt_saved`, which reaches the processor's action handler as an action of the `tip_calculator` component, the same way a `Button` action would. The app also asks for the height of its content with `a2ui_size_changed`. Clicking "How tipping works" does not navigate the frame: the host reports it as an `open_url` action with the link's `url`, which the application can open itself.

### A URL order tracker

[`url-order-tracker.json`](../../../catalogs/iframe/examples/url-order-tracker.json) loads an order tracker served from its own origin, gives it a static configuration and the `/orders` array, and shows the summary the app writes back in a `Text` below it:

```json
{
  "id": "order_tracker",
  "component": "WebAppFrameUrl",
  "url": "https://example.com/a2ui-apps/order-tracker/",
  "height": 240,
  "config": {"theme": "light", "locale": "en-US"},
  "data": {"paths": {"orders": "/orders", "summary": "/summary"}},
  "mutableData": {"summary": {"type": "string"}},
  "allowedEvents": {
    "order_selected": {"type": "object", "required": ["orderId"]},
    "order_delivered": {"type": "object", "required": ["orderId"]}
  }
}
```

The proxy loads `https://example.com/a2ui-apps/order-tracker/?origin=<host origin>`. When the application announces itself with `a2ui_app_frame_ready`, it receives `config`, the orders under `initialData.orders`, the allowlists and the port for everything that follows. It lists the orders, writes a summary such as `1 processing, 2 shipped` to `/summary` in the locale from `config`, and dispatches `order_selected` when the user picks an order and `order_delivered` when the host changes an order's status to `delivered`. The example URL is a placeholder; the package tests point it at `typescript/catalogs/iframe/tests/fixtures/apps/order_tracker.html`, which implements the app.

## How an app talks to the host

A frame application needs no library. It registers a `message` listener, posts `{type: "a2ui_app_frame_ready"}` to `window.parent`, and receives `a2ui_app_frame_init` back with `config`, `initialData` (the current values of `data.paths`), the `allowedEvents` and `allowedFunctions` maps, the `mutableData` keys, the host context (container dimensions) and, as `event.ports[0]`, a `MessagePort`. Everything after the handshake travels over that port:

- from the app: `a2ui_action` (`action`, `data`), `a2ui_data_model_change` (`key`, optional `subpath`, `value`), `a2ui_function_call` (`call`, `callId`, `args`) and `a2ui_size_changed` (`height`, `width`);
- from the host: `a2ui_data_model_update` when a bound value changes, `a2ui_function_result` (`callId`, `status`, `result` or `error`) and `a2ui_host_context_update`.

The host checks every message for prototype pollution keys, nesting depth and size, matches it against the allowlist of its kind and validates its payload against the JSON Schema listed there, unless `disableSchemaValidation` is set. The [WebApp iframe component specification](../../../catalogs/iframe/web_app_frame_specification.md) defines the messages, the handshake and the security controls; the tip calculator example is a complete working app.

## Troubleshooting

### The frame stays empty and the network panel shows a 404 under `/a2ui-sandbox/`

The proxy is not served where the components look for it, so its ready signal never arrives and the content is never sent. Check that the copy step or the `assets` entry ran for the deployment you are looking at (the Vite copy lives in `public/`, which the dev server and the build both read; a change to `angular.json` applies on the next `ng serve`), that `/a2ui-sandbox/sandbox.html` is reachable on the page's origin, and, if you serve the directory elsewhere, that `configureSandbox({baseUrl})` ran before the first surface rendered. Logging `resolveSandboxUrl('html').href` from `@a2ui/catalog-iframe` shows the URL a component would load.

### The app loads but does nothing, or stays on its waiting state

The host dropped or rejected a message. The browser console shows a warning for each one: an `a2ui_action` whose name is not in `allowedEvents` (including the `open_url` action a link click in a `WebAppFrameSrcdoc` produces), an `a2ui_data_model_change` for a key not in `mutableData`, or a payload that fails the JSON Schema declared for it. A function call needs two things: the function must be a key of `allowedFunctions`, and it must exist in the frame's own catalog or in the surface's default catalog, which is why the examples create their surfaces with the basic catalog and set `catalogId` on the frame alone. An unlisted function is answered with `NOT_ALLOWED`, invalid arguments with `VALIDATION_ERROR` and a function that throws with `EXECUTION_ERROR`. For `WebAppFrameUrl`, a `url` that is not `http` or `https` loads nothing and is reported once with `console.warn`.

### Custom element errors, or components that render empty

Two copies of `lit` or `@a2ui/web_core` on the page cause `Custom element tag name collision` errors from the renderer, Lit's "Multiple versions of Lit loaded" warning, and elements whose base class the renderer does not recognize. Both are peer dependencies of `@a2ui/catalog-iframe` so that the package manager installs one copy; `npm ls lit @a2ui/web_core` (or `yarn why`) shows whether it did, and `npm dedupe` usually fixes it. Vite users can also add `resolve: {dedupe: ['lit']}` to `vite.config.ts`. Every package in the page has to use the same `@a2ui/web_core` version as the renderer.

## Further reading

- [`@a2ui/catalog-iframe` README](../../../typescript/catalogs/iframe/README.md): every property, styling, the host bridge and how to write another sandboxed frame component on `SandboxedFrameElement`.
- [WebApp iframe component specification](../../../catalogs/iframe/web_app_frame_specification.md): wire protocol messages, handshake and security controls.
- [Defining your own catalog](defining-your-own-catalog.md) and [Authoring custom components](authoring-components.md) for catalogs and components of your own.
