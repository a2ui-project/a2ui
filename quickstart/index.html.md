# Quickstart

> Run a small A2UI app, a Python agent server with a React web client and a Flutter mobile client, from one prompt to your coding agent or in three commands.

Canonical URL: https://a2ui.org/quickstart/

**A2UI** lets an AI agent answer with an interface instead of a paragraph:
cards your users can tap, dates they can drag, a panel that keeps up with them.

This quickstart runs **Travel A2UI**, a small trip planner built on the official
A2UI SDKs. It is simple on purpose: **one Python server** holds the agent, and
a **React** client (web) and a **Flutter** client (mobile) draw what it sends.
Paste one of these prompts into your coding agent:
- **Web + Mobile (Python + React + Flutter):** `Follow the steps at https://a2ui.org/quickstart/agent.md to set up the A2UI quickstart web and mobile apps and explain them to me.`
- **Web only (Python + React):** `Follow the steps at https://a2ui.org/quickstart/agent/web.md to set up the A2UI quickstart web app and explain it to me.`
- **Mobile only (Python + Flutter):** `Follow the steps at https://a2ui.org/quickstart/agent/mobile.md to set up the A2UI quickstart mobile app and explain it to me.`

Or follow the [step-by-step walkthrough](/quickstart/step-by-step/).
> **Note**
  Travel A2UI lives in A2UI Labs, at
  [samples/travel-a2ui](https://github.com/a2ui-project/labs/tree/main/samples/travel-a2ui). It is a
  sample for learning A2UI and is not meant for production use.

## How A2UI fits into this app

A2UI is an SDK for your agent and a renderer for your app. Here is where each
part lives in Travel A2UI:

One server serves the API, the React app at `/` and the Flutter app at
`/flutter/`. The clients know nothing about travel: each knows how to draw the
catalog's components. You, the builder, decide what is in the catalog; the
agent decides what to draw from it. [How A2UI works](/concepts/overview/)
walks through the same picture for any A2UI app.

## What you will learn

Once it runs, your agent (or the [step-by-step walkthrough](/quickstart/step-by-step/))
explains, with the app open:

1. **What on screen is A2UI** and what is ordinary app code: surfaces, the
   components in them, and the data they show.
2. **The catalog**: the components and client functions the agent may use,
   and why it is the guardrail.
3. **Agent skills**: how the model is taught to write A2UI for the catalog.
4. **What the model writes versus what the client receives**: A2UI Express,
   the A2UI messages the agent SDK turns it into, and the MessageProcessor
   that applies them.
5. **Renderers**: the two here, and the others A2UI has.

## Other fast paths

To try A2UI without cloning anything:

- **Agent skills**: run `npx skills add a2ui-project/a2ui` in your project to give your coding agent A2UI's protocol rules, SDK integration guides and catalog authoring workflows (see [Get Help](/get-help/)).
- **[A2UI Composer](https://a2ui-editor.ag-ui.com)** ([source](https://github.com/a2ui-project/a2ui/tree/main/tools/composer)): a visual workspace for prompting an assistant, inspecting streamed messages and `dataModel` updates, and editing surfaces side by side.
- **[A2UI Playground](https://go.copilotkit.ai/a2ui-playground)**: a browser sandbox for trying A2UI prompts and component catalogs with no local setup.
