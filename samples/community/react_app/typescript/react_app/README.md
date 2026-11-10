# @a2ui-labs/react-app

The `ReactApp` component for A2UI web renderers, and its catalog (`reactAppCatalog`, id `https://a2ui.org/labs/react_app/v1/catalog.json`).

`ReactApp` is a universal (Lit) component built on the shared double-iframe sandbox (`SandboxedFrameElement`), so `@a2ui/react` renders it like any other catalog component, and so can the Lit renderer. The element builds the app document from the runtime's manifest, loads it in the sandbox, and connects a `ReactAppBridge` to the surface.

## Usage

```ts
import {configureReactApp, reactAppCatalog} from '@a2ui-labs/react-app';
import {A2uiSurface} from '@a2ui/react';

configureReactApp({runtimeBaseUrl: '/a2ui-sandbox/react-app/v1/'});
const processor = new MessageProcessor([basicCatalog, reactAppCatalog, appCatalog], onAction, {
  outboundListener: sendToAgent,
});
// ... <A2uiSurface surface={surface} />
```

The host serves two directories:

1. `dist/sandbox/` of this package at `/a2ui-sandbox/` (the sandbox proxy pages).
2. `dist/v1/` of `@a2ui-labs/react-app-runtime` at the `runtimeBaseUrl`, with CORS (see `createReactAppRuntimeHandler`).

## Pieces

| File                          | Role                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/react_app.ts`            | `ReactAppApi` (the catalog schema in Zod) and the element.                                                                                                                         |
| `src/react_app_bridge.ts`     | `ReactAppBridge`: the host side of the bridge protocol (initialize snapshot, data access with allowlists and echo suppression, functions, actions, diagnostics, timings).          |
| `src/react_app_frame_host.ts` | `ReactAppFrameHost`: the shared `ComponentContextFrameHost`, with a function lookup that works on surfaces without a default catalog and for functions declared in other catalogs. |
| `src/app_document.ts`         | Builds the app document (import map, preloads, stylesheet, app config, bootstrap).                                                                                                 |
| `src/theme_tokens.ts`         | Reads the page's `--a2ui-*` CSS variables for the app.                                                                                                                             |
| `src/react_app_config.ts`     | `configureReactApp` and the runtime manifest loader.                                                                                                                               |
| `src/shared/`                 | Copy of `typescript/catalogs/shared/` made by `scripts/copy-shared.mjs` at build time (not committed).                                                                             |

## Observing a frame

The element dispatches bubbling, composed DOM events: `react-app-bridge` for every bridge message and lifecycle event (`detail` is a `ReactAppBridgeEvent`), `react-app-error` for app errors, and `react-app-rendered` with the frame timings and `frameReadyToRenderedMs`, the time from the proxy's ready message to the app's first paint.

## Tests

1. `yarn test:unit`: Karma (Chrome headless) runs this package's tests and the copied shared sandbox tests.
2. `yarn test:e2e`: Playwright loads [`e2e/fixture/`](e2e/fixture/) with `@a2ui/react`, the sandbox proxy, and the runtime served from a second origin. It checks that the inner frame has real DOM, that native and agent changes reach the app, that app writes reach the data model, that `callFunction` round-trips a local and a mocked agent function, the frame latency, and the loan explorer and lap timer examples.

`yarn test` runs both, after `build`.
