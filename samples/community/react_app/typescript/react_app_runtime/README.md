# @a2ui-labs/react-app-runtime

What runs inside a ReactApp frame: React 19, the `a2ui` module the app imports, Sucrase to transpile the app's TSX in the browser, `VegaChart` (vega-embed, loaded on first use), the theme sent by the host, and the `a2ui-lite.css` styles of the primitives. The protocol it speaks is in [`docs/bridge_protocol.md`](../../docs/bridge_protocol.md).

## The `a2ui` module

[`src/a2ui.d.ts`](src/a2ui.d.ts) is the API the model writes against, and it goes into the agent prompt as is: `useData`, `getData`, `setData`, `subscribe`, `callFunction`, `useFunction`, `dispatchAction`, `theme`, `useTheme`, `VegaChart`, and the primitives `Card`, `Button`, `Text`, `Slider` and `Stack`. `src/runtime/a2ui_module.test.tsx` checks that the implementation matches it.

## Build output

`yarn build` writes `dist/v1/`:

1. One content-hashed ES module per import map entry: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `a2ui` and `a2ui-runtime` (the entry whose `start()` runs the app). They come from one esbuild build with code splitting, so the app, the `a2ui` module and the runtime share one React.
2. Shared chunks under `chunks/`, including Sucrase (loaded only when the app has no `compiled` code) and vega-embed (loaded on the first chart).
3. `a2ui-lite-<hash>.css`.
4. `manifest.json`: the import map, the entry, the stylesheet and the modules to preload. The host reads it to build the app document.

The hashed files can be cached forever. `manifest.json` is revalidated.

## Node API

```ts
import {
  REACT_APP_RUNTIME_DIR, // absolute path of dist/v1
  createReactAppRuntimeHandler, // serves dist/v1 with CORS and cache headers
  readRuntimeManifest,
} from '@a2ui-labs/react-app-runtime';
```

## Scripts

`build`, `test` (type check and vitest in jsdom), `lint`, `lint:fix`, `format`, `format:check`.
