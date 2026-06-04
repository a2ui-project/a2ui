# A2UI-Powered Document Editor Micro-App

This directory contains the source code for the generative document editor micro-app based on Angular and Editor.js.

It is built as a standalone static bundle and served by the MCP server as an isolated resource to be rendered securely within the host container.

---

## Prerequisites

### 1. Node.js

Ensure you have Node.js installed (LTS v20 or v22 is recommended).

If Node.js is missing from your PATH, consider installing it via NVM (Node Version Manager):

```bash
# Download and install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Refresh terminal
source ~/.bashrc

# Install LTS Node.js
nvm install --lts
```

### 2. Build Core A2UI Libraries

This application has file-based dependencies on the core A2UI packages which reside elsewhere in this repository. You **must build these packages first** in specific order before this application's `npm install` will succeed.

Run the following commands from the **root of the repository**:

```bash
# 1. Build Web Core
cd adapters/web_core
npm install
npm run build

# 2. Build Markdown Utilities
cd adapters/markdown/markdown-it
npm install
npm run build

# 3. Build Angular Renderer
cd adapters/angular
npm install
npm run build

cd ../../
```

---

## Local Execution Workflow

To execute and run this application locally, you need to build the application bundle, ensure the host environment assets are ready, and then boot the services.

### Step 1: Build the Editor App Bundle

From inside this directory (`samples/mcp/a2ui-in-mcpapps/server/apps/editor`):

```bash
# Install local package dependencies
npm install --legacy-peer-deps

# Build Angular project AND generate the single self-contained HTML file
npm run build:all
```

_This outputs the final static artifact into `../public/editor.html` which the Python server reads._

### Step 2: Build the Client Host Bridge (Required Once)

Navigate to the client host directory and build its security-sandbox bridge:

```bash
cd ../../../client
npm install
npm run build:sandbox
```

### Step 3: Run the Full Local Environment

Open two terminals to start the stack:

#### Terminal A: Run MCP Server (Python)

```bash
cd samples/mcp/a2ui-in-mcpapps/server
uv sync
uv run python server.py --transport sse --port 8000
```

#### Terminal B: Run Host Web App (Angular)

```bash
cd samples/mcp/a2ui-in-mcpapps/client
npm run start
```

#### Access the Application

Visit **[http://localhost:4200](http://localhost:4200)** in your browser to load the host container, which will automatically load this Editor app via the MCP server connection.
