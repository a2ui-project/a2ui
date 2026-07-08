# Generic A2UI MCP App renderer (React)

A server-agnostic [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) view that renders
[A2UI](https://a2ui.org) (v0.9+) payloads. It contains **zero server-specific logic**: all content
arrives through tool results, so any A2UI-speaking MCP server can serve the built `react.html` as
its `ui://` resource — this directory is written to be extracted and reused as-is.

A server is compatible if it follows two conventions:

1. **A2UI payloads travel as embedded resources.** Tool results (including the entry tool's
   result) carry A2UI messages as `EmbeddedResource` content blocks with mimeType
   `application/a2ui+json` (a single message or an array).
2. **A2UI actions map to tools.** Each A2UI action `name` matches an app-visible tool name
   (`_meta.ui.visibility` includes `"app"`), and the action's resolved `context` becomes the
   tool's `arguments`. The tool's response A2UI is applied incrementally to the same surfaces.

## Build

```bash
yarn install
yarn build:all   # emits ../public/react.html (single, self-contained file)
```

The build uses Vite + `vite-plugin-singlefile`, so the output HTML has no external references and
can be delivered verbatim via `resources/read`.

## Implementation notes

- The renderer is a reusable React component, `GenericA2uiApp` (`src/generic-a2ui-app.tsx`);
  `src/main.tsx` only mounts it. Embedders can use the component directly and pass an optional
  `actionToToolName` map to route A2UI action names to differently-named server tools (actions
  without an entry call the tool named after the action itself).
- The MCP Apps handshake and host bridge come from the official
  `@modelcontextprotocol/ext-apps` SDK (`App` class); iframe auto-resizing is handled by the
  SDK's built-in `size-changed` notifications.
- Rendering uses `@a2ui/react` (v0.9 basic catalog) driven by a `MessageProcessor` from
  `@a2ui/web_core`.
- The entry tool's result resets and fully renders the view; subsequent action-triggered tool
  results patch it in place (`src/extract-a2ui-messages.ts` does the payload extraction and is
  unit-tested via `yarn test`).
