---
template: home.html
hide:
  - navigation
  - toc
---

<!-- markdownlint-disable MD041 -->
<!-- markdownlint-disable MD033 -->

# UI is a Better Output Format Than Text for Agents

Chat is a great input, but walls of prose are a terrible output. **A2UI** is the open standard and SDK suite created by Google with contributions from [CopilotKit](https://docs.copilotkit.ai/generative-ui/a2ui) and the open-source community that lets AI agents respond with stateful, interactive user interfaces—rendered natively across **Flutter**, **SwiftUI**, **Jetpack Compose**, **React**, **Angular**, and **Lit** without executing arbitrary code.

- **Instant comprehension over walls of text**: Graphical surfaces show structured comparisons, statuses, and controls at a glance instead of forcing users to hold state in their heads.
- **60fps stateful manipulation & v1.0 RPC**: Decoupled structure (`updateComponents`) and reactive data bindings (`updateDataModel`) let users adjust steppers, inputs, and filters at 60fps and settle actions via `actionResponse`.
- **Battle-tested in production at Google**: A2UI powers real-world production experiences across Google, including [Google Opal](ecosystem/a2ui-in-the-world.md).

## Express: ~3x Faster Inference with an LLM-Optimized Format

- **77% smaller output with A2UI Express**: A2UI Express cuts output tokens by 55–70% across the specification, making Generative UI fast even on small on-device models.
- **Decoupled inference and wire formats**: Choosing A2UI never locks you into making your LLM output JSON. JSON is the universal wire interchange format that keeps agents and renderers compatible, while the Agent SDK lets you swap inference formats (`Express`, `Direct JSON`, `Atom`) on the server.

## Macros: Give the Model Bigger Words

- **Domain nouns for the model**: Define rich UI treatments in server code (`@macro`) with embedded data bindings, then let the LLM instantiate them with a single high-level call like `FlightCard(...)`.
- **Ship new UI treatments without App Store updates**: `MacroExpander` compiles each macro call into standard primitive components (`Card`, `Column`, `Row`, `Text`) before sending over the wire.

## One Environment for the Entire Agentic UI Spectrum

- **Mix and match autonomy and guardrails**: Use one protocol and one set of SDKs across **Prebuilt Server-Driven UIs**, **[MCP Apps](guides/mcp-apps-in-a2ui.md)**, **Controlled Macro Generation**, and **Open-Ended Generative UI**.
- **Future-proof renderer investment**: Integrate A2UI renderers into your client app once and evolve how your backend drives them over time.

## Native Rendering with Flutter, SwiftUI, Jetpack Compose, and Web

- **Official SDKs across Mobile, Desktop, and Web**: Maintained [renderers](reference/renderers.md) for **SwiftUI**, **Jetpack Compose**, **Flutter**, **React**, **Angular**, and **Lit**.
- **Transport and framework agnostic**: Works over [A2A](concepts/transports.md), [AG-UI](guides/a2ui-with-any-agent-framework.md), and [MCP](guides/a2ui_over_mcp.md).

## Get Started

- [Quickstart Demo](quickstart.md)
- [Use A2UI with Any Agent Framework & Harness](guides/a2ui-with-any-agent-framework.md)
- [A2UI Composer](https://a2ui-project.github.io/composer/) ([Composer Docs](composer/index.md))
- [Core Concepts](concepts/overview.md)
- [Developer Guides](guides/client-setup.md)
- [Component Reference](reference/components.md)

## Specification Versions

| Version | Status | Description |
| --- | --- | --- |
| **[v1.0](specification/v1.0-a2ui.md)** | **Candidate** | Adds client-to-server RPC (`actionResponse`), action IDs, and `surfaceProperties`. [Evolution guide →](specification/v1.0-evolution-guide.md) |
| **[v0.9.1](specification/v0.9.1-a2ui.md)** | **Current** | Current production release. Standardizes on `application/a2ui+json` MIME type and relaxed `surfaceId` constraints. [Evolution guide →](specification/v0.9.1-evolution-guide.md) |
| **[v0.9](specification/v0.9-a2ui.md)** | **Stable** | Prompt-first architecture: introduces `createSurface`, client-side functions, custom catalogs, and modular schemas. [Evolution guide →](specification/v0.9-evolution-guide.md) |
| **[v0.8](specification/v0.8-a2ui.md)** | **Legacy** | Legacy baseline specification and [v0.8 A2A Extension](specification/v0.8-a2a-extension.md). |
