# A2UI over MCP Demo - Recipe Tool

A demo of A2UI running over MCP, exposing a tool that returns a recipe UI.

## Architecture

Both the interactive recipe form and the generated recipe card follow the decoupled A2UI Mini-Apps architecture:

1. **Presentation Template Resources (`resources/list`, `resources/read`):**
   - `a2ui://recipe-form`: Static form component tree (`createSurface`, `updateComponents`) with choice pickers and action button.
   - `a2ui://recipe-card`: Static card component tree (`createSurface`, `updateComponents`) with data bindings (e.g. `/title`, `/image`, `/cookTime`).
2. **Tool UI Metadata (`_meta.ui`):**
   - Declared on tools in `tools/list` and returned in `CallToolResult`:
     - `get_recipe_form_a2ui` -> `_meta.ui.resourceUri = "a2ui://recipe-form"`
     - `get_recipe_a2ui` -> `_meta.ui.resourceUri = "a2ui://recipe-card"`
     ```json
     "_meta": {
       "ui": {
         "resourceUri": "a2ui://...",
         "mimeType": "application/a2ui+json"
       }
     }
     ```
3. **Dynamic Data Model Hydration (`updateDataModel`):**
   - Tool execution returns dynamic state as an A2UI `updateDataModel` message in `content`.
   - `get_recipe_form_a2ui` provides initial selection state (`cookingStyle`, `protein`).
   - `get_recipe_a2ui` provides customized recipe details matching user preferences.
4. **Client-Side Resolution & Caching:**
   - The host client checks `_meta.ui.resourceUri`, fetches and caches the presentation template, creates the native A2UI surface, and applies the dynamic data model update.

## Usage

### 1. Start the MCP Server

```bash
# Using SSE transport (default) on port 8000
uv run .
```

### 2. Run the Web Client

```bash
cd client
yarn dev
```

Open your browser at `http://localhost:5173`. The client connects to the MCP server via SSE, calls `get_recipe_form_a2ui` to fetch the template and initialize the form, and when you submit your choices, executes `get_recipe_a2ui`, fetches the presentation template, and renders the customized recipe card.

### 3. Inspect using MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest --web --transport sse --server-url http://localhost:8000/sse
```

Open `http://localhost:6274`. You will see both `a2ui://recipe-form` and `a2ui://recipe-card` under Resources, and `get_recipe_form_a2ui` and `get_recipe_a2ui` with their `_meta.ui` links under Tools.
![MCP Inspector Screenshot](mcp_inspector_screenshot.png)
