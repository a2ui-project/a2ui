# @a2ui/catalog-iframe

The A2UI iframe catalog for web renderers. It runs untrusted web content, such as a model-generated
application or an external web app, inside a sandboxed frame that talks to the host page through
the `a2ui_*` message protocol defined in the
[WebApp iframe component specification](../../../catalogs/iframe/web_app_frame_specification.md).

This release contains the building blocks the frame components are made of:

- the sandbox proxy asset (`sandbox/` in the published package) and the configuration of where the
  host serves it;
- `WebAppFrameBridge`, the host side of the protocol: `MessagePort` handshake, two-way data model
  sync for `data.paths`, `allowedEvents`, `allowedFunctions` and `mutableData` allowlists with JSON
  Schema validation, function calls, resize requests and host context updates;
- the zod schemas of the wire messages and the `FrameHost` interface a renderer adapts its component
  context to.

The `WebAppFrameUrl` and `WebAppFrameSrcdoc` components that use them are added in a following
release, together with the catalog registration.

## Installation

```bash
npm install @a2ui/catalog-iframe
```

The package depends on `zod` and `ajv` and expects a browser environment.

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

`WebAppFrameBridge` connects one frame to the surface that renders it. It takes the frame element,
a `FrameHost` (five functions: read, write and subscribe to a data model path, invoke a catalog
function, dispatch an action), the origin the proxy is served from, and a function that returns the
component's current properties:

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
