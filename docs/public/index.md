---
hide:
  - toc
---

<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD033 -->
<div style="text-align: center; margin: 2rem 0 3rem 0;" markdown>

<!-- Logo for Light Mode (shows dark logo on light background) -->
<img src="assets/A2UI_dark.svg" alt="A2UI Logo" width="120" class="light-mode-only" style="margin-bottom: 1rem;">
<!-- Logo for Dark Mode (shows light logo on dark background) -->
<img src="assets/A2UI_light.svg" alt="A2UI Logo" width="120" class="dark-mode-only" style="margin-bottom: 1rem;">

# A Protocol for Agent-Driven Interfaces

<p style="font-size: 1.2rem; max-width: 800px; margin: 0 auto 1rem auto; opacity: 0.9; line-height: 1.6;">
A2UI enables AI agents to generate rich, interactive user interfaces that render natively across web, mobile, and desktop—without executing arbitrary code.
</p>

</div>

## Specification Versions

| Version                                    | Status        | Description                                                                                                                                                                                                                                           |
| ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[v1.0](specification/v1.0-a2ui.md)**     | **Candidate** | Release candidate. Adds client-to-server RPC (`actionResponse`), action IDs, and renames theme to surfaceProperties. (Previously designated as v0.10 when in draft). [Evolution guide →](specification/v1.0-evolution-guide.md)                       |
| **[v0.9.1](specification/v0.9.1-a2ui.md)** | **Current**   | Current production release. Minor refinements to v0.9, standardizing on the `application/a2ui+json` MIME type and relaxing surfaceId constraints. [Evolution guide →](specification/v0.9.1-evolution-guide.md)                                        |
| **[v0.9](specification/v0.9-a2ui.md)**     | **Stable**    | Previous stable version. Philosophical shift to Prompt-First. Introduces `createSurface`, client-side functions, custom catalogs, modular schemas, and validation failed error formatting. [Evolution guide →](specification/v0.9-evolution-guide.md) |
| **[v0.8](specification/v0.8-a2ui.md)**     | **Legacy**    | Legacy version. Structured Output first. Baseline surfaces, components, data binding, and adjacency list model.                                                                                                                                       |

A2UI is Apache 2.0 licensed,
created by Google with contributions from
[CopilotKit](https://docs.copilotkit.ai/generative-ui/a2ui) and the open source community,
and is in active development [on GitHub](https://github.com/a2ui-project/a2ui).

A2UI solves the following problem: **how can AI agents safely send rich UIs across trust boundaries?**

Instead of text-only responses or risky code execution, A2UI lets agents send **declarative component descriptions** that clients render using their own native widgets. It's like having agents speak a universal UI language.

This repository contains:

- **[A2UI specifications](specification/v0.9.1-a2ui.md)** (v0.9.1 current, v1.0 candidate).
- **Implementations for [renderers](reference/renderers.md)** (Angular, Flutter, Lit, Markdown, etc.) on the client side.
- **Transports like [A2A](concepts/transports.md)** which communicate A2UI messages between agents and clients.

<div class="grid cards" markdown>

- :material-shield-check: **Secure by Design**

    ***

    Declarative data format, not executable code. Agents can only use pre-approved components from your catalog—no UI injection attacks.

- :material-rocket-launch: **LLM-Friendly**

    ***

    Flat, streaming JSON structure designed for easy generation. LLMs can build UIs incrementally without perfect JSON in one shot.

- :material-devices: **Framework-Agnostic**

    ***

    One agent response works everywhere. Render the same UI on Angular, Flutter, React, or native mobile with your own styled components.

- :material-chart-timeline: **Progressive Rendering**

    ***

    Stream UI updates as they're generated. Users see the interface building in real-time instead of waiting for complete responses.

</div>

## Get Started in 5 Minutes

<div class="grid cards" markdown>

- :material-clock-fast:{ .lg .middle } **[Quickstart Restaurant Finder Demo](quickstart.md)**

    ***

    Run the full-stack demo locally with a Gemini powered ADK agent and Lit renderer. Learn A2UI end-to-end and customize to your use case.

    [:octicons-arrow-right-24: Run the demo](quickstart.md)

- :material-react:{ .lg .middle } **[Use A2UI with Any Agent Framework & Harness](guides/a2ui-with-any-agent-framework.md)**

    ***

    Scaffold an AG-UI app or harness for your agent framework, then enable A2UI rendering in the client surface.

    [:octicons-arrow-right-24: Use with any agent](guides/a2ui-with-any-agent-framework.md)

- :material-palette-outline:{ .lg .middle } **[A2UI Composer](https://a2ui-composer.ag-ui.com/)**

    ***

    Generate A2UI JSON from a visual editor — no install required. Paste the output into any agent prompt.

    [:octicons-arrow-right-24: Open the composer](https://a2ui-composer.ag-ui.com/)

- :material-play-circle-outline:{ .lg .middle } **[A2UI Theater](https://a2ui-composer.ag-ui.com/theater)**

    ***

    Step through pre-built A2UI streaming scenarios across Lit, React, and Angular renderers. See the protocol in motion before writing code.

    [:octicons-arrow-right-24: Open the playground](https://a2ui-composer.ag-ui.com/theater)

- :material-book-open-variant:{ .lg .middle } **[Core Concepts](concepts/overview.md)**

    ***

    Understand surfaces, components, data binding, and the adjacency list model.

    [:octicons-arrow-right-24: Learn concepts](concepts/overview.md)

- :material-code-braces:{ .lg .middle } **[Developer Guides](guides/client-setup.md)**

    ***

    Integrate A2UI renderers into your app or build agents that generate UIs.

    [:octicons-arrow-right-24: Start building](guides/client-setup.md)

- :material-file-document:{ .lg .middle } **Protocol Specifications**

    ***

    Dive into the complete technical specs: [v0.8 (legacy)](specification/v0.8-a2ui.md) · [v0.9 (stable)](specification/v0.9-a2ui.md) · [v0.9.1 (current)](specification/v0.9.1-a2ui.md) · [v1.0 (candidate)](specification/v1.0-a2ui.md)

    [:octicons-arrow-right-24: Read the v0.9.1 spec](specification/v0.9.1-a2ui.md)

</div>

## How It Works

The typical interaction flow consists of these steps:

1. **User sends a message** to an AI agent
2. **Agent generates A2UI messages** describing the UI (structure + data)
3. **Messages stream** to the client application
4. **Client renders** using native components (Angular, Flutter, React, etc.)
5. **User interacts** with the UI, sending actions back to the agent
6. **Agent responds** with updated A2UI messages

![End-to-End Data Flow](assets/end-to-end-data-flow.png)

## A2UI in Action

### Landscape Architect Demo

<div style="margin: 2rem 0;">
  <div style="border-radius: .8rem; overflow: hidden; box-shadow: var(--md-shadow-z2);">
    <video width="100%" height="auto" controls playsinline style="display: block; aspect-ratio: 16/9; object-fit: cover;">
      <source src="assets/landscape-architect-demo.mp4" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  </div>
  <p style="text-align: center; margin-top: 1rem; opacity: 0.8;">
    Watch an agent generate all of the interfaces for a landscape architect application. The user uploads a photo; the agent uses Gemini to understand it and generate a custom form for landscaping needs.
  </p>
</div>

### Custom Components: Interactive Charts & Maps

<div style="margin: 2rem 0;">
  <div style="border-radius: .8rem; overflow: hidden; box-shadow: var(--md-shadow-z2);">
    <video width="100%" height="auto" controls playsinline style="display: block; aspect-ratio: 16/9; object-fit: cover;">
      <source src="assets/a2ui-custom-component.mp4" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  </div>
  <p style="text-align: center; margin-top: 1rem; opacity: 0.8;">
    Watch an agent chose to respond with a chart component to answer a numerical summary question.  Then the agent chooses a Google Map component to answer a location question.  Both are custom components offered by the client.
  </p>
</div>

### A2UI Composer

CopilotKit has a public [A2UI Widget Builder](https://go.copilotkit.ai/A2UI-widget-builder) to try out as well.

[![A2UI Composer](assets/A2UI-widget-builder.png)](https://go.copilotkit.ai/A2UI-widget-builder)
