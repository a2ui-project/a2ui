# Quickstart: Run A2UI in 5 Minutes

Get hands-on with A2UI by running the restaurant finder demo. This guide will have you experiencing agent-generated UI in less than 5 minutes.

## What You'll Build

By the end of this quickstart, you'll have:

- A running web app with A2UI Lit renderer.
- A Gemini-powered agent that generates dynamic UIs.
- An interactive restaurant finder with form generation, time selection, and confirmation flows.
- Understanding of how A2UI messages flow from agent to UI.

## Prerequisites

Before you begin, make sure you have:

- **Node.js** (v18 or later with [Corepack](https://nodejs.org/api/corepack.html) enabled) — [Download here](https://nodejs.org/)
- **uv** (Python package manager) — [Install here](https://docs.astral.sh/uv/getting-started/installation/) (used to run the Python agent backend)
- **A Gemini API key** — [Get one free from Google AI Studio](https://aistudio.google.com/apikey)

WARNING: Security Notice

This demo runs an A2A agent that uses Gemini to generate A2UI responses. The agent has access to your API key and will make requests to Google's Gemini API. Always review agent code before running it in production environments.

## Step 1: Clone the Repository

```bash
git clone https://github.com/a2ui-project/a2ui.git
cd a2ui
```

## Step 2: Set Your API Key

Export your Gemini API key as an environment variable:

```bash
export GEMINI_API_KEY="your_gemini_api_key_here"
```

## Step 3: Navigate to the Lit Client Samples Directory

The client application source code is located in `samples/client/lit/shell`. Navigate to the parent samples directory to run the demo:

```bash
cd samples/client/lit
```

## Step 4: Install and Run

Run the demo launcher (ensuring Corepack is enabled so Node automatically fetches the correct Yarn version):

```bash
# Enable Corepack (macOS Homebrew users: see tip below)
corepack enable

yarn install
yarn demo:restaurant
```

> [!TIP]
> **macOS Homebrew Users:** If you have standalone package managers installed, unlink conflicts before installing Corepack so Corepack can manage versions per-project:
>
> ```bash
> brew unlink yarn pnpm
> brew install corepack
> corepack enable
> ```

This command will:

1. Install all dependencies
2. Build the A2UI renderer
3. Start the A2A restaurant finder agent (Python backend)
4. Launch the development server
5. Open your browser to `http://localhost:5173`

The source code for the Restaurant Finder agent is located in [`samples/agent/adk/restaurant_finder`](../../samples/agent/adk/restaurant_finder).

> [!NOTE]
> **Package Manager Usage:** Running the quickstart demo application within the A2UI repository requires Yarn as configured by Corepack workspaces. For your own regular usage and standalone projects outside this repository, use the package manager of your choice (e.g. npm, pnpm).

### Running Manually (Alternative)

If you prefer to run the agent and client in separate terminals, or need to troubleshoot:

**1. Run the Agent:**

```bash
cd samples/agent/adk/restaurant_finder
uv run .
```

**2. Run the Client:**

```bash
cd samples/client/lit/shell
yarn dev
```

NOTE: Demo Running

If everything worked, you should see the web app in your browser. The agent is now ready to generate UI!

## Step 5: Try It Out

In the web app, try these prompts:

1. **"Book a table for 2"** - Watch the agent generate a reservation form
2. **"Find Italian restaurants near me"** - See dynamic search results
3. **"What are your hours?"** - Experience different UI layouts for different intents

### What's Happening Behind the Scenes

```
┌─────────────┐         ┌──────────────┐         ┌────────────────┐
│   You Type  │────────>│ A2A Agent    │────────>│  Gemini API    │
│  a Message  │         │  (Python)    │         │  (LLM)         │
└─────────────┘         └──────────────┘         └────────────────┘
                               │                         │
                               │ Generates A2UI JSON     │
                               │<────────────────────────┘
                               │
                               │ Streams JSONL messages
                               v
                        ┌──────────────┐
                        │   Web App    │
                        │ (A2UI Lit    │
                        │  Renderer)   │
                        └──────────────┘
                               │
                               │ Renders native components
                               v
                        ┌──────────────┐
                        │   Your UI    │
                        └──────────────┘
```

1. **You send a message** via the web UI
2. **The A2A agent** receives it and sends the conversation to Gemini
3. **Gemini generates** A2UI JSON messages describing the UI
4. **The A2A agent streams** these messages back to the web app
5. **The A2UI renderer** converts them into native web components
6. **You see the UI** rendered in your browser

## Anatomy of an A2UI Message

Let's peek at what the agent is sending. Here's a simplified example of the JSON messages:

=== "v0.8 (Legacy)"

    **Defining the UI:**

    ```json
    {"surfaceUpdate": {"surfaceId": "main", "components": [
      {"id": "header", "component": {"Text": {"text": {"literalString": "Book Your Table"}, "usageHint": "h1"}}},
      {"id": "date-picker", "component": {"DateTimeInput": {"label": {"literalString": "Select Date"}, "value": {"path": "/reservation/date"}, "enableDate": true}}},
      {"id": "submit-text", "component": {"Text": {"text": {"literalString": "Confirm Reservation"}}}},
      {"id": "submit-btn", "component": {"Button": {"child": "submit-text", "action": {"name": "confirm_booking"}}}}
    ]}}
    ```

    **Populating data:**

    ```json
    {"dataModelUpdate": {"surfaceId": "main", "contents": [
      {"key": "reservation", "valueMap": [
        {"key": "date", "valueString": "2025-12-15"},
        {"key": "time", "valueString": "19:00"},
        {"key": "guests", "valueInt": 2}
      ]}
    ]}}
    ```

    **Signaling render:**

    ```json
    {"beginRendering": {"surfaceId": "main", "root": "header"}}
    ```

=== "v0.9 (Stable)"

    **Creating the surface:**

    ```json
    {"version": "v0.9.1", "createSurface": {"surfaceId": "main", "catalogId": "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"}}
    ```

    **Defining the UI:**

    ```json
    {"version": "v0.9.1", "updateComponents": {"surfaceId": "main", "components": [
      {"id": "header", "component": "Text", "text": "# Book Your Table", "variant": "h1"},
      {"id": "date-picker", "component": "DateTimeInput", "label": "Select Date", "value": {"path": "/reservation/date"}, "enableDate": true},
      {"id": "submit-text", "component": "Text", "text": "Confirm Reservation"},
      {"id": "submit-btn", "component": "Button", "child": "submit-text", "variant": "primary", "action": {"event": {"name": "confirm_booking"}}}
    ]}}
    ```

    **Populating data:**

    ```json
    {"version": "v0.9.1", "updateDataModel": {"surfaceId": "main", "path": "/reservation", "value": {"date": "2025-12-15", "time": "19:00", "guests": 2}}}
    ```

    Note: In v0.9, `createSurface` replaces `beginRendering`, components use a flatter format, and the data model uses plain JSON values instead of typed adjacency lists.

TIP: It's Just JSON

Notice how readable and structured this is? LLMs can generate this easily, and it's safe to transmit and render—no code execution required.

## Exploring Other Demos

The repository includes several other demos:

### Component Gallery (No Agent Required)

See all available A2UI components:

```bash
yarn start gallery
```

This runs a client-only demo showcasing every standard component (Card, Button, TextField, Timeline, etc.) with live examples and code samples.

### Other Languages and Frameworks

While this guide uses the Lit client as an example, A2UI provides samples for other popular frameworks in the `samples/client` directory:

- **Angular**: `samples/client/angular`
- **React**: `samples/client/react`

Explore the [samples/client](../../samples/client) directory to see all available client implementations.

## What's Next?

Now that you've seen A2UI in action, you're ready to:

- **[Learn Core Concepts](concepts/overview.md)**: Understand surfaces, components, and data binding
- **[Set Up Your Own Client](guides/client-setup.md)**: Integrate A2UI into your own app
- **[Build an Agent](guides/agent-development.md)**: Create agents that generate A2UI responses
- **[Use an Existing Agent App](guides/a2ui-with-any-agent-framework.md)**: Add A2UI through CopilotKit + AG-UI for ADK, LangGraph, CrewAI, Mastra, or a custom service
- **[Explore the Protocol](reference/messages.md)**: Dive into the technical specification

## Troubleshooting

### Port Already in Use

If port 5173 is already in use, the dev server will automatically try the next available port. Check the terminal output for the actual URL.

### API Key Issues

If you see errors about missing API keys:

1. Verify the key is exported: `echo $GEMINI_API_KEY`
2. Make sure it's a valid Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
3. Try re-exporting: `export GEMINI_API_KEY="your_key"`

### Connection Errors on Startup

If you see `ERR_CONNECTION_REFUSED` errors when the browser opens, **don't worry** — this is a known race condition ([#587](https://github.com/a2ui-project/a2ui/issues/587)). The web app starts faster than the Python agent backend. Just wait a few seconds and refresh the page.

### Python / uv Issues

The demo agents require [uv](https://docs.astral.sh/uv/) to run. If you see `uv: command not found`:

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Verify
uv --version
```

If you encounter other Python errors:

```bash
# Make sure Python 3.10+ is available
python3 --version

# Try running the agent manually
cd samples/agent/adk/restaurant_finder
uv run .
```

### Still Having Issues?

- Check the [GitHub Issues](https://github.com/a2ui-project/a2ui/issues)
- Review the [samples/client/lit/README.md](../../samples/client/lit)
- Join the community discussions

## Understanding the Demo Code

Want to see how it works? Check out:

- **Agent Code**: `samples/agent/adk/restaurant_finder/` — The Python A2A agent
- **Client Code**: `samples/client/lit/` — The Lit web client with A2UI renderer
- **A2UI Renderers**: `renderers/lit/` (Lit) and `renderers/web_core/` (framework-agnostic core)

Each directory has its own README with detailed documentation.

---

**Congratulations!** You've successfully run your first A2UI application. You've seen how an AI agent can generate rich, interactive UIs that render natively in a web application—all through safe, declarative JSON messages.
