# MCP App with A2UI Surface

This directory contains the hosted application for the MCP server. The application comes with a CTA to fetch a counter A2UI payload and display it in the UI.

## Directory Structure

- `src/`: Contains the source code for the hosted application (e.g., an Angular app).
- `react/`: Contains the generic, server-agnostic React A2UI renderer.
- `dist/`: Temporary build output directory for the raw hosted app build (ignored by git).
- `public/`: Output directory for the final bundled/inlined artifact (ignored by git).

## Workflow

1. **Source Code**: Modify code in `src/`.
2. **Build**: Run the build script in `src/` to compile the app and inline its resources.
3. **Distribution**: The build process generates a single self-contained artifact (e.g., `public/app.html`) that the server serves.

## MCP Application (Angular)

The application in `src/` is a basic Angular application (`basic-mcp-app-angular`).

### Inlining Process

Due to MCP App security isolation requirements (often relying on sandboxed iframes), the application is built and then processed by `inline.js` (located in `src/`).

This process:

- Collects raw Angular build outputs from `dist/raw`.
- Dynamically inlines all JavaScript and CSS files directly into `index.html`.
- Outputs a single, self-contained `app.html` file into the `public/` directory.

This self-contained file is then served by the host server.

### 2. Build the Server Hosted App

The server serves a bundled `app.html` artifact located in `public/app.html`. If you modify the source code in `src/`, you must regenerate this artifact:

Run this in the `src/` directory:

```bash
cd src
yarn install
yarn build:all
```

_(Runs Angular compilation and triggers `node inline.js` to single-file inline it into `public/app.html`)_

## MCP Application (React, generic)

The application in `react/` (`generic-a2ui-mcp-app-react`) is a server-agnostic A2UI renderer:
it does the MCP Apps handshake via the official `@modelcontextprotocol/ext-apps` SDK, renders
`application/a2ui+json` embedded resources from tool results with `@a2ui/react`, and routes A2UI
user actions back to the server as `tools/call` requests. See `react/README.md` for the
conventions that make it reusable by any A2UI-speaking MCP server.

Unlike the Angular apps it needs no `inline.js` post-processing — React has no forced chunking,
so Vite + `vite-plugin-singlefile` emits the final self-contained artifact directly:

```bash
cd react
yarn install
yarn build:all
```

_(Generates `public/react.html`)_
