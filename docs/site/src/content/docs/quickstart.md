---
title: "Quickstart: Run A2UI in 5 Minutes"
description: Get hands-on with A2UI by running the restaurant finder demo and experiencing agent-generated UI in less than 5 minutes.
---

Get hands-on with A2UI by running the restaurant finder demo. This guide will have you experiencing agent-generated UI in less than 5 minutes.

## What You'll Build

By the end of this quickstart, you'll have:

- A running app with an A2UI renderer (**Lit Web Components** or **Flutter**).
- A Gemini-powered agent that generates dynamic, stateful UIs.
- An interactive restaurant finder with form generation, time selection, and confirmation flows.
- Understanding of how A2UI messages (`createSurface`, `updateComponents`, `updateDataModel`) flow from agent to UI.

## Prerequisites

- **Node.js** (v18 or later with [Corepack](https://nodejs.org/api/corepack.html) enabled) — [Download here](https://nodejs.org/)
- **Flutter SDK** _(optional, for the Flutter client)_ — [Install here](https://docs.flutter.dev/install)
- **uv** (Python package manager) — [Install here](https://docs.astral.sh/uv/getting-started/installation/) (used to run the Python agent backend)
- **A Gemini API key** — [Get one free from Google AI Studio](https://aistudio.google.com/apikey)

> [!WARNING] Security Notice
> This demo runs an A2A agent that uses Gemini to generate A2UI responses. The agent has access to your API key and will make requests to Google's Gemini API. Always review agent code before running it in production environments.

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

## Step 3: Run the Agent and Client

### Option A: Lit Web Components Client

The client application source code is located in `samples/client/lit/shell`. Navigate to the parent samples directory to run both the agent and web client:

```bash
cd samples/client/lit
corepack enable
yarn install
yarn demo:restaurant
```

> [!NOTE] About Package Managers
> The A2UI repository uses `yarn` for its monorepo development, but `yarn` is not required to **use** A2UI. You may use the package manager of your choice (`npm`, `pnpm`, `yarn`) in your own projects.

### Option B: Flutter Client

In your first terminal, start the Python agent backend:

```bash
cd samples/agent/adk/restaurant_finder
uv run .
```

In a second terminal, launch the Flutter application:

```bash
cd samples/client/flutter/restaurant_finder/app
flutter run -d chrome
```

> [!TIP] Demo Running
> Once running, open `http://localhost:5173` in your browser. The agent is now ready to stream interactive UI surfaces!

## Step 4: Try It Out

In the app, try these prompts:

1. **"Book a table for 2"**
    - Watch the agent respond with a list of restaurant cards.
    - Click **"Book Now"** on a restaurant.
    - The agent generates a custom reservation form populated with your party size.
2. **"Find Italian restaurants in New York"**
    - See how the UI adapts dynamically to your query.
3. **Complete a booking**
    - Fill out the form (date, time, special requests) and click **Submit**.
    - The client sends a structured `action` back to the agent, which responds with a confirmation surface.

## What's Happening Behind the Scenes?

1. **User Input**: You type `"Book a table for 2"`.
2. **Agent Processing**:
    - The Python ADK agent receives your message via the **A2A Protocol**.
    - Gemini analyzes the intent and generates A2UI messages (using **A2UI Express** or structured JSON).
3. **Streaming & Rendering**:
    - The agent streams `createSurface`, `updateComponents`, and `updateDataModel` envelopes to the client.
    - The client renderer maps abstract components (`Card`, `Row`, `Button`, `DateTimeInput`) to native platform widgets and binds inputs to the local `dataModel` via JSON Pointers.

```json
{
  "version": "1.0",
  "createSurface": {
    "surfaceId": "restaurant-results",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
  }
}
```
