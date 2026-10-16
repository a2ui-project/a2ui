# Angular multi-catalog client

This client renders the
[multi-catalog sales dashboard agent](../../../../agent/adk/multi_catalog) with
A2UI v1.0, which lets one surface mix components from several catalogs. The
renderer holds two catalogs:

- the v1.0 basic catalog (`BasicCatalog` from `@a2ui/angular`), and
- the dashboard catalog in
  [`src/app/dashboard-catalog`](src/app/dashboard-catalog), which renders the
  agent's `StatCard` and `ProgressBar` components.

The agent's `dashboard` surface names the basic catalog as its default catalog
in `createSurface`. Each `StatCard` and `ProgressBar` names the dashboard catalog
in its own `catalogId`, so a basic `Row` can hold dashboard components.

## How it works

1. [`app.config.ts`](src/app/app.config.ts) registers both catalogs with
   `provideA2UI`, the v1.0 provider. It renders the basic catalog with its
   universal web components.
2. The dashboard components are Angular components. The renderer wraps them as
   custom elements and mounts them inside the basic catalog's elements, so they
   use `ViewEncapsulation.ShadowDom` to keep their styles with them.
3. [`server.ts`](src/server.ts) forwards each request to the agent over A2A with
   the v1.0 extension. It sends the catalogs the renderer holds as
   `a2uiRendererCapabilities`, keyed by protocol version, and `useStreaming` in
   the message metadata. The agent negotiates its catalogs from them.
4. With `ENABLE_STREAMING` unset or `true`, the server uses `message/stream`
   and passes each agent update on as a server-sent event, so the UI renders
   while the model writes it. With `ENABLE_STREAMING=false`, it uses
   `message/send` and returns the whole response at once.
5. [`client.ts`](src/app/client.ts) passes the A2UI messages to the renderer, and
   logs each one in the browser console. The **Refresh** button sends its
   `refresh_dashboard` action back to the agent as a
   `{"version": "v1.0", "action": ...}` data part.

## Running the sample

1. Start the agent. See its [README](../../../../agent/adk/multi_catalog/README.md).
2. In `samples/client/angular`, build the renderers and start the client:

   ```bash
   yarn install
   yarn build:renderer
   yarn start multi_catalog
   ```

   Or start both the agent and the client:

   ```bash
   yarn demo:multi_catalog
   ```

3. Open http://localhost:4200 and ask for a region's dashboard, for example
   "Show me the sales dashboard for Europe".

To try the non-streaming path, build the client and run its server with
streaming off:

```bash
yarn ng build multi_catalog
ENABLE_STREAMING=false PORT=4000 yarn serve:ssr:multi_catalog
```

The agent's URL defaults to `http://localhost:10010`. Set `AGENT_URL` to use
another one.
