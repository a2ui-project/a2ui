# Calculator MCP App Demo

A demo of an MCP server exposing a Calculator as an MCP Application Resource.

## Building the Application

The application UI is written in TypeScript and must be built before running the server.

Run this in the `apps/src` directory:

```bash
cd apps/src
yarn install
yarn build
```

This will bundle the TypeScript code and generate the self-contained `apps/public/calculator.html` file.

## Usage

1. Start the server using either stdio (default) or SSE transport:

```bash
# Using SSE transport (default) on port 8000
uv run .
```

The server exposes a resource named `ui://calculator/app`.

2. Inspect the server using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)

```bash
npx @modelcontextprotocol/inspector
```

Connect to http://localhost:8000/sse using Transport Type SSE and fetch the resources.

## Available Resources

- **`ui://calculator/app`**: A simple calculator application UI (`text/html;profile=mcp-app`).

## Available Tools

- **`calculate`**: Performs basic arithmetic calculations (`add`, `subtract`, `multiply`, `divide`). It takes `operation`, `a`, and `b` as arguments and returns the result.
  - Used by the **"🤖 ="** button in the calculator app to delegate calculations to the MCP server via a `tools/call` request.
