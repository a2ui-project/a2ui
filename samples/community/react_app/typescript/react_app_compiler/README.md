# @a2ui-labs/react-app-compiler

Server-side compiler of ReactApp sources, for agents that check apps before they ship (plan Phase 4).

`compile(source, {bindings})` transpiles the TSX with Sucrase, with the frame runtime's options, so the output can go into the component's `compiled` property and the frame skips its own transpile. It then type-checks the source with a TypeScript language service against the runtime's `a2ui.d.ts`, `@types/react` and the `a2ui:bindings` declarations of the request. The service stays warm between calls: about 2 s to start and warm up, then about 100 ms per app.

The type check is strict except for `noImplicitAny` (models leave chart callback parameters untyped, which never fails at runtime), and it declares `NodeJS.Timeout` as the browser timer type.

## Use

As a library:

```ts
import {createReactAppCompiler} from '@a2ui-labs/react-app-compiler';

const compiler = createReactAppCompiler();
const {ok, compiled, diagnostics, timings} = compiler.compile(source, {bindings});
```

As a worker (`dist/worker.js`), with one JSON request per line on stdin and one response per line on stdout. The first line out is `{"id": 0, "ready": true, "warmupMs": n}`:

```text
{"id": 1, "op": "compile", "source": "...", "bindings": "declare module 'a2ui:bindings' {...}"}
{"id": 1, "ok": false, "compiled": "...", "diagnostics": [{"phase": "type", "line": 8, "column": 26, "code": 2561, "message": "..."}], "timings": {...}}
```

The Python package `a2ui-react-app` drives the worker with `ReactAppCompiler`.

## Scripts

`build`, `test` (vitest, including the worker), `lint`, `lint:fix`, `format`, `format:check`.
