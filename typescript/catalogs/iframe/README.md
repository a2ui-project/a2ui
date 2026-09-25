# @a2ui/catalog-iframe

The A2UI iframe catalog for web renderers. It runs untrusted web content, such as a model-generated
application or an external web app, inside a sandboxed frame that talks to the host page through
the `a2ui_*` message protocol defined in the
[WebApp iframe component specification](../../../catalogs/iframe/web_app_frame_specification.md).

The package contains:

- `iframeCatalog`, with the two universal components of the catalog, `WebAppFrameUrl` and
  `WebAppFrameSrcdoc`;
- the sandbox proxy asset (`sandbox/` in the published package) and the configuration of where the
  host serves it;
- `WebAppFrameBridge`, the host side of the protocol: `MessagePort` handshake, two-way data model
  sync for `data.paths`, `allowedEvents`, `allowedFunctions` and `mutableData` allowlists with JSON
  Schema validation, function calls, resize requests and host context updates;
- `SandboxedFrameElement` and `ComponentContextFrameHost`, the base class and the host adapter the
  components are built on, for catalogs that add their own sandboxed frame components.

## Installation

```bash
npm install @a2ui/catalog-iframe @a2ui/web_core lit
```

`@a2ui/web_core` and `lit` are peer dependencies: the components are universal components built on
`A2uiLitElement` from `@a2ui/web_core/v0_9/universal`. The package also depends on `zod` and `ajv`
and expects a browser environment.

## Usage

The components are custom elements that any renderer able to host universal components can render.
Today that is the Lit renderer, `@a2ui/lit`. Register the catalog with the `MessageProcessor` next
to the catalogs you already use, and serve the sandbox asset (next section):

```ts
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {iframeCatalog} from '@a2ui/catalog-iframe';

const processor = new MessageProcessor([basicCatalog, iframeCatalog]);
```

A surface is bound to one catalog: the `catalogId` of its `createSurface` message selects one of
the registered catalogs, and only that catalog's components and functions are available in it.
Surfaces that mix frames with basic components, as the
[catalog examples](../../../catalogs/iframe/examples) do,
therefore use a catalog that carries both sets under the iframe catalog id:

```ts
import {Catalog} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {IFRAME_CATALOG_ID, iframeCatalog} from '@a2ui/catalog-iframe';

const catalog = new Catalog(
  IFRAME_CATALOG_ID,
  [...basicCatalog.components.values(), ...iframeCatalog.components.values()],
  [...basicCatalog.functions.values()],
);
const processor = new MessageProcessor([catalog]);
```

The `Catalog` type parameter is `WebComponentImplementation` from `@a2ui/web_core/v0_9/universal`
when the compiler cannot infer it.

## Components

Both components render one `<iframe>` in their light DOM that loads the sandbox proxy; the proxy
runs the content in an inner frame with `sandbox="allow-scripts allow-forms allow-modals"`, never
`allow-same-origin`. The proxy frame is titled with the component's `accessibility.label` when it
has one, or "Embedded web application". They share these properties:

| Property                  | Type                                | Purpose                                                                                                 |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `height`                  | `DynamicNumber`                     | Height of the frame in CSS pixels. Without it, the element is 500px tall; see Styling.                  |
| `config`                  | object                              | Static configuration handed to the application in the `a2ui_app_frame_init` handshake.                  |
| `data.paths`              | map of key to JSON pointer          | Data model paths the application can read; their values are sent initially and whenever they change.    |
| `mutableData`             | map of key to JSON Schema           | The subset of `data.paths` keys the application may write, each with the schema its value must satisfy. |
| `allowedEvents`           | map of action name to JSON Schema   | Actions the application may dispatch, each with the schema of its payload. Anything else is dropped.    |
| `allowedFunctions`        | map of function name to JSON Schema | Catalog functions the application may call, each with the schema of its arguments.                      |
| `disableSchemaValidation` | boolean                             | Skips the JSON Schema checks; the allowlists still apply. For trusted first-party applications only.    |
| `accessibility`           | `AccessibilityAttributes`           | `label` becomes the accessible name of the frame.                                                       |

`WebAppFrameSrcdoc` adds `htmlContent`, the HTML string to render, optionally prefixed with
`url_encoded:` when it was `encodeURIComponent`-encoded for transport. The host removes any
`Content-Security-Policy` meta tag from the markup, injects a strict one (no network, no form
submission, no nested frames) and a script that turns hyperlink clicks into `open_url` actions
instead of navigations. An empty value loads nothing.

`WebAppFrameUrl` adds `url`, a `DynamicString` with the `http` or `https` URL of the application.
The host appends its own origin as the `origin` query parameter so the application can address its
messages to it; other schemes load nothing and are reported once with `console.warn`.

A message that renders the counter example (`catalogs/iframe/examples/00_srcdoc-shared-counter.json`,
markup shortened):

```json
{
  "version": "v0.9",
  "updateComponents": {
    "surfaceId": "gallery-iframe-shared-counter",
    "components": [
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
        "htmlContent": "<!doctype html><html><body><p id=\"status\"></p><script>...</script></body></html>"
      }
    ]
  }
}
```

The application inside receives `{count: 0, label: "clicks"}` in the handshake, writes `count` back
through `a2ui_data_model_change`, and dispatches `counter_saved`, which reaches the host as an
action of the `counter_app` component. Property changes are applied live: a new `htmlContent` or
`url` reloads the content and reconnects the bridge, a new `height` resizes the element.

### Styling

The components are styled through CSS custom properties, which can be set on any ancestor:

| Property                               | Default                                                              | Purpose                                |
| -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `--a2ui-sandboxed-frame-height`        | `500px`                                                              | Height used when `height` is absent.   |
| `--a2ui-sandboxed-frame-border`        | `var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)` | Border around the frame.               |
| `--a2ui-sandboxed-frame-border-radius` | `var(--a2ui-border-radius, 8px)`                                     | Corner radius.                         |
| `--a2ui-sandboxed-frame-background`    | `#fff`                                                               | Background behind transparent content. |

An application that asks for a size through `a2ui_size_changed` resizes the frame and the element
within the limits of the bridge (100px to 2000px high); the next `height` property change takes
over again.

## Sandbox asset

Untrusted content never runs directly in the host page. The host embeds `sandbox.html`, an
un-sandboxed proxy page served from the host's own origin, and the proxy creates a strictly sandboxed
inner frame (`allow-scripts allow-forms allow-modals`, no `allow-same-origin`, no top navigation, no
popups, every sensitive permission denied unless delegated) for the actual content. This double
iframe keeps the outer frame reachable for developer tools and browser extensions, which crash with
`SecurityError` when they meet a sandboxed frame directly in the page, while the content runs in an
opaque origin with no access to the host's cookies, storage or DOM. The proxy checks the embedding
page's origin, relays messages between the host and the inner frame, and rejects everything else.

The proxy pages are shipped in the `sandbox/` directory of the published package (`dist/sandbox/`
in the repository):

| File               | Purpose                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `sandbox.html`     | Inline HTML content (`srcdoc`). Its CSP keeps the inner frame from loading external URLs. |
| `sandbox-url.html` | External URLs. Its CSP allows the inner frame to load any `http` or `https` URL.          |
| `sandbox.js`       | The proxy script, shared by both pages.                                                   |

Copy that directory into your app's static assets so it is served at `/a2ui-sandbox/` on your
origin:

- Angular CLI: add an entry to the `assets` array of your build options in `angular.json`:

  ```json
  {
    "glob": "**/*",
    "input": "node_modules/@a2ui/catalog-iframe/sandbox",
    "output": "a2ui-sandbox"
  }
  ```

- Vite: either copy the directory into `public/a2ui-sandbox/` (Vite serves `publicDir` as is), or use
  a static-copy plugin such as `vite-plugin-static-copy` with
  `{src: 'node_modules/@a2ui/catalog-iframe/sandbox/*', dest: 'a2ui-sandbox'}`.

- Plain static server: copy `node_modules/@a2ui/catalog-iframe/sandbox` to `<web root>/a2ui-sandbox`.

The default proxy URL is `/a2ui-sandbox/sandbox.html` (and `/a2ui-sandbox/sandbox-url.html` for
external URLs), resolved against the document base URL. To serve the directory somewhere else, set
the base URL once at startup:

```ts
import {configureSandbox} from '@a2ui/catalog-iframe';

configureSandbox({baseUrl: '/static/frames/'});
```

`resolveSandboxUrl('html')` and `resolveSandboxUrl('url')` return the URLs the components load.

The proxy runs a self-test on startup: it fails unless it is isolated from the top window, which is
only the case when the proxy is served from another origin than the host page. On the default
same-origin deployment the test cannot pass, so the URL carries `disable_security_self_test=true`
automatically. To serve the proxy from a dedicated origin (the stronger isolation), point `baseUrl`
at it and list the host origin in the proxy page, which then keeps the self-test enabled:

```html
<meta name="a2ui-sandbox-host-origins" content="https://app.example.com" />
```

`configureSandbox({disableSecuritySelfTest: true | false})` overrides the automatic choice.

## Host bridge

The components own their bridge; this section is for hosts that embed a frame without the
components. `WebAppFrameBridge` connects one frame to the surface that renders it. It takes the
frame element, a `FrameHost` (five functions: read, write and subscribe to a data model path,
invoke a catalog function, dispatch an action), the origin the proxy is served from, and a function
that returns the component's current properties:

```ts
import {resolveSandboxUrl, sendSandboxResourceReady, WebAppFrameBridge} from '@a2ui/catalog-iframe';

const sandboxUrl = resolveSandboxUrl('html');
frame.src = sandboxUrl.href;

const bridge = new WebAppFrameBridge({
  frame,
  host,
  sandboxOrigin: sandboxUrl.origin,
  getProps: () => ({
    config: props.config,
    dataPaths: props.data?.paths,
    allowedEvents: props.allowedEvents,
    allowedFunctions: props.allowedFunctions,
    mutableData: props.mutableData,
    disableSchemaValidation: props.disableSchemaValidation,
  }),
  onSandboxProxyReady: () => {
    sendSandboxResourceReady({frame, sandboxOrigin: sandboxUrl.origin, protocol: 'a2ui', resource});
  },
});
bridge.start();
// Later, when the component is removed:
bridge.dispose();
```

Every message from the frame is checked for prototype pollution keys, nesting depth and size, parsed
against the wire schema, matched against the allowlist of its kind and validated against the JSON
Schema listed there, in that order. Anything that fails is dropped with a `console.warn`; function
calls get an error reply (`NOT_ALLOWED`, `VALIDATION_ERROR` or `EXECUTION_ERROR`).

## Writing another sandboxed frame component

`SandboxedFrameElement` is the base class of both components. It renders the proxy frame, applies
the `height` property, listens for the proxy's ready signal, sends the resource once the proxy is
listening, reconnects the bridge when the context or the content changes, and tears everything down
when the element leaves the document. A subclass provides the proxy page and protocol to use, the
resource its properties describe, its height and title, and the bridge connection:

```ts
import {
  ComponentContextFrameHost,
  frameHeightFromProp,
  frameTitleFromProps,
  SandboxedFrameElement,
} from '@a2ui/catalog-iframe';

class MyFrameElement extends SandboxedFrameElement<typeof MyFrameApi> {
  protected readonly api = MyFrameApi;
  protected readonly sandboxMode = 'html' as const;
  protected readonly sandboxProtocol = 'a2ui' as const;

  protected resolveResource() {
    return {html: this.controller.props.markup};
  }
  protected resolveHeight() {
    return frameHeightFromProp(this.controller.props.height);
  }
  protected resolveTitle() {
    return frameTitleFromProps(this.controller.props.accessibility, 'My frame');
  }
  protected connectFrame(frame: HTMLIFrameElement, sandboxOrigin: string) {
    const bridge = new MyBridge({
      frame,
      sandboxOrigin,
      host: new ComponentContextFrameHost(this.context),
    });
    bridge.start();
    return () => bridge.dispose();
  }
}
```

`ComponentContextFrameHost` is the `FrameHost` over a universal component's `ComponentContext`:
data paths go through the component's data context, functions through the surface catalog, and
actions are dispatched as events of the component. Bridges that do not apply resize requests
themselves can call the protected `requestFrameSize(width, height)` of the base class.

## Development

The package lives in the [A2UI monorepo](https://github.com/a2ui-project/a2ui) under
`typescript/catalogs/iframe`. The sandbox proxy and the host helpers shared with `@a2ui/catalog-mcp`
are maintained in `typescript/catalogs/shared/` and copied into `src/shared/` at build time; edit
them there.

```bash
yarn install
yarn workspace @a2ui/catalog-iframe build   # copies the catalog and shared code, compiles, bundles the sandbox
yarn workspace @a2ui/catalog-iframe test    # type-checks the tests and runs them with Karma in headless Chrome
yarn workspace @a2ui/catalog-iframe lint
```

## License

Apache 2.0
