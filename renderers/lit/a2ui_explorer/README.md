# A2UI Explorer (Lit, v0.9)

A standalone, agentless web application that renders the A2UI v0.9 examples of the basic, iframe and MCP catalogs from their JSON files with the Lit renderer. It is a focused environment for testing renderer compatibility and protocol compliance.

## Prerequisites

Build the shared A2UI packages from the repository root first:

```bash
yarn install
yarn build:all
```

For more details on the packages the explorer uses, see:

- [Web core README](../../web_core/README.md)
- [Lit renderer README](../README.md)
- [`@a2ui/catalog-iframe` README](../../../typescript/catalogs/iframe/README.md)
- [`@a2ui/catalog-mcp` README](../../../typescript/catalogs/mcp/README.md)

## Getting started

1. Navigate to this directory:

   ```bash
   cd renderers/lit/a2ui_explorer
   ```

2. Run the development server:

   ```bash
   yarn dev
   ```

   This command:

   - generates the example list from `specification/v0_9/catalogs/basic/examples/`, `catalogs/iframe/examples/` and `catalogs/mcp/examples/`,
   - copies the sandbox proxy of `@a2ui/catalog-iframe` into `public/a2ui-sandbox/` (see [The sandbox proxy](#the-sandbox-proxy)),
   - starts the Vite server at `http://localhost:5173`.

## Catalogs

A surface is bound to the one catalog its `createSurface.catalogId` names, and the examples of the iframe and MCP catalogs mix their components with basic ones. The explorer therefore registers three catalogs with its `MessageProcessor` (see `src/demo-catalogs.ts`):

| Catalog id          | Components                                   | Functions                                       |
| ------------------- | -------------------------------------------- | ----------------------------------------------- |
| basic catalog       | basic                                        | basic                                           |
| `IFRAME_CATALOG_ID` | basic, `WebAppFrameUrl`, `WebAppFrameSrcdoc` | basic                                           |
| `MCP_CATALOG_ID`    | basic, `McpApp`                              | basic, `callMcpTool` and the MCP data functions |

The explorer is not connected to an MCP server, so `callMcpTool` rejects every call with a message that says so. The `tools/call` requests an `McpApp` makes for its `allowedTools` are dispatched as A2UI actions and show up in the action log with the tool name and arguments.

## The sandbox proxy

`WebAppFrameUrl`, `WebAppFrameSrcdoc` and `McpApp` render an `<iframe>` that loads the sandbox proxy from `/a2ui-sandbox/` on the explorer's origin, as the catalog package READMEs describe. `scripts/copy-sandbox.mjs` copies the proxy from the built `@a2ui/catalog-iframe` package into the git-ignored `public/a2ui-sandbox/` directory. Vite serves `public/` as is in `yarn dev`, copies it into `dist/` in `yarn build`, and `karma.conf.cjs` serves it at the same path for the tests. `yarn dev`, `yarn build` and `yarn test` run the copy through the `copy-sandbox` wireit script, which builds `@a2ui/catalog-iframe` first.

## Architecture

- Agentless: unlike other samples, this does not require a running agent. It simulates agent responses locally for interactive components (like the login form).
- Dynamic loading: `scripts/generate-examples.mjs` discovers all `.json` files of the three example directories at build time and groups them by catalog. To add a test case, drop a JSON file into one of those directories and restart the dev server.
- Surface isolation: each example is rendered into its own independent `a2ui-surface` with a unique id derived from the filename.
- Mock agent console: all user interactions (button clicks, form submissions, actions dispatched by embedded apps) are intercepted and logged to a sidebar, demonstrating how the renderer resolves actions and contexts. The data model inspector shows the current data model of the selected surface, including the writes embedded apps make through the host bridge.

## Tests

`yarn test` builds the explorer and runs the Karma suite: one spec file per example under `tests/`, plus `tests/all-examples.test.ts`, which renders every example of every catalog once. The tests do not need network access; the URL frame example only checks that the proxy page for URLs is loaded from the explorer's origin.
