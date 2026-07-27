# A2UI Local Gallery (Basic v0.9)

This is a standalone, agentless web application designed to render the A2UI v0.9 basic examples directly from static JSON files. It serves as a focused environment for testing renderer compatibility and protocol compliance.

## Prerequisites

Before running this gallery, you **must** build the shared A2UI renderers.

### 1. Build Shared Renderers

Navigate to the project root and run:

````bash
```bash
yarn install
yarn build:all
````

For more details on building the renderers, see:

- [Web Core README](../../web_core/README.md)
- [Lit Renderer README](../README.md)

## Getting Started

1.  **Navigate to this directory**:

    ```bash
    cd samples/client/lit/gallery_v0_9
    ```

2.  **Run the development server**:
    ```bash
    yarn dev
    ```
    This command will:
    - Load all JSON examples from `specification/v0_9/catalogs/basic/examples/`.
    - Start the Vite server at `http://localhost:5173`.

## Architecture

- **Agentless**: Unlike other samples, this does not require a running Python agent. It simulates agent responses locally for interactive components (like the Login Form).
- **Dynamic Loading**: The app automatically discovers and loads _all_ `.json` files present in the v0.9 basic specification folder at build time. To add a new test case, simply drop a JSON file into that specification folder and restart the dev server.
- **Surface Isolation**: Each example is rendered into its own independent `a2ui-surface` with a unique ID derived from the filename.
- **Mock Agent Console**: All user interactions (button clicks, form submissions) are intercepted and logged to a sidebar, demonstrating how the renderer resolves actions and contexts.
