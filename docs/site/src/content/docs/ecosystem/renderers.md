---
title: "Ecosystem Renderers & Tools"
description: "Community renderers, developer utilities, adopter case studies, and ecosystem tooling for A2UI."
---

This directory lists community renderers, transport adapters, agent libraries, developer utilities, and production case studies built around the A2UI protocol.

> [!NOTE] Community Maintenance
> Third-party projects listed here are maintained by their respective authors and organizations, not by the core A2UI maintainers. Check each repository for license terms, protocol version support, and release status.

> [!TIP] Official SDKs
> For first-party SDKs maintained by the A2UI team, see the [Agent SDKs](/concepts/agent-sdks/) guide (TypeScript, Python, Dart) and [Renderer SDKs](/concepts/renderer-sdks/) guide (Flutter, Web/React, Swift, Jetpack Compose), as well as the official [`@a2ui/react`](https://www.npmjs.com/package/@a2ui/react) package.

## Community renderers

The following table lists client-side renderers implemented and maintained by the community across web, mobile, desktop, and terminal environments.

| Renderer                                                                               | Platform / Framework                                      | v0.8 | v0.9.1 | v1.0 | Links                                                                                                                                                                                                  |
| :------------------------------------------------------------------------------------- | :-------------------------------------------------------- | :--: | :----: | :--: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **easyops-cn/a2ui-sdk** (`@a2ui-sdk/react`)                                            | React (Web)                                               |  ✅  |   —    |  —   | [GitHub](https://github.com/easyops-cn/a2ui-sdk) · [npm](https://www.npmjs.com/package/@a2ui-sdk/react) · [Docs](https://a2ui-sdk.js.org/)                                                             |
| **lmee/A2UI-Android**                                                                  | Android (Compose)                                         |  ✅  |   —    |  —   | [GitHub](https://github.com/lmee/A2UI-Android)                                                                                                                                                         |
| **sivamrudram-eng/a2ui-react-native**                                                  | React Native                                              |  ✅  |   —    |  —   | [GitHub](https://github.com/sivamrudram-eng/a2ui-react-native)                                                                                                                                         |
| **zhama/a2ui** (`@zhama/a2ui`)                                                         | React (Web)                                               |  ✅  |   —    |  —   | [npm](https://www.npmjs.com/package/@zhama/a2ui)                                                                                                                                                       |
| **jem-computer/A2UI-react**                                                            | React (Web)                                               |  ✅  |   —    |  —   | [GitHub](https://github.com/jem-computer/A2UI-react)                                                                                                                                                   |
| **BBC6BAE9/a2ui-swift**                                                                | Apple native (SwiftUI, UIKit, AppKit)                     |  ✅  |   ✅   |  —   | [GitHub](https://github.com/BBC6BAE9/a2ui-swift)                                                                                                                                                       |
| **a2ui-vue** (`a2ui-vue`)                                                              | Vue (Web)                                                 |  ✅  |   ✅   |  —   | [GitHub](https://github.com/shawnwang15/a2ui-vue) · [npm](https://www.npmjs.com/package/a2ui-vue) · [Docs](https://shawnwang15.github.io/a2ui-vue/en/)                                                 |
| **AGenUI/AGenUI**                                                                      | iOS, Android, HarmonyOS                                   |  —   |   ✅   |  —   | [GitHub](https://github.com/AGenUI/AGenUI) · [Website](https://genui.amap.com/)                                                                                                                        |
| **lynx-family/lynx-stack** (`@lynx-js/genui/a2ui`)                                     | Lynx (Mobile, Web, Desktop)                               |  —   |   ✅   |  —   | [GitHub](https://github.com/lynx-family/lynx-stack/tree/main/packages/genui/a2ui) · [npm](https://www.npmjs.com/package/@lynx-js/genui) · [Docs](https://lynxjs.org/next/react/genui/a2ui.html)        |
| **BoteAI/a2ui** (`@boteai/a2ui-render`)                                                | React (Web)                                               |  ✅  |   ✅   |  —   | [GitHub](https://github.com/BoteAI/a2ui) · [npm](https://www.npmjs.com/package/@boteai/a2ui-render)                                                                                                    |
| **kokoro-ele/a2ui-ink** (`@evanyu/a2ui-ink`)                                           | Terminal / CLI (Ink)                                      |  —   |   ✅   |  —   | [GitHub](https://github.com/kokoro-ele/a2ui-ink) · [npm](https://www.npmjs.com/package/@evanyu/a2ui-ink)                                                                                               |
| **yessGlory17/generative-mui** (`@yessglory/generative-mui-react`)                     | React + Material UI (Web)                                 |  —   |   ✅   |  —   | [GitHub](https://github.com/yessGlory17/generative-mui) · [npm](https://www.npmjs.com/package/@yessglory/generative-mui-react)                                                                         |
| **ChaliceForAuri/a2ui-svelte** (`svelte-a2ui`)                                         | Svelte 5 (Web)                                            |  —   |   ✅   |  ✅  | [GitHub](https://github.com/ChaliceForAuri/a2ui-svelte) · [npm](https://www.npmjs.com/package/svelte-a2ui) · [Demo](https://chaliceforauri.github.io/a2ui-svelte/)                                     |
| **Language-Lit/material3-expressive-a2ui** (`@language-lit/material3-expressive-a2ui`) | React + Material 3 Expressive (Web)                       |  —   |   ✅   |  —   | [GitHub](https://github.com/Language-Lit/material3-expressive-a2ui) · [npm](https://www.npmjs.com/package/@language-lit/material3-expressive-a2ui) · [Demo & Docs](https://m3e.language-lit.com/a2ui/) |
| **uny/a2ui-compose** (`dev.ynagai.a2ui:a2ui-material3`)                                | Compose Multiplatform (Android, iOS, desktop, macOS, Web) |  —   |   —    |  ✅  | [GitHub](https://github.com/uny/a2ui-compose) · [Maven Central](https://central.sonatype.com/namespace/dev.ynagai.a2ui) · [Docs](https://uny.github.io/a2ui-compose/)                                  |

### Project summaries

**easyops-cn/a2ui-sdk** (`@a2ui-sdk/react`) provides a React renderer with Radix UI primitives, Tailwind CSS styling, and documentation. It was discussed on the [A2UI community discussions](https://github.com/a2ui-project/a2ui/discussions/489). For the official React renderer maintained by the core team, see [`@a2ui/react`](https://www.npmjs.com/package/@a2ui/react).

**lmee/A2UI-Android** implements a Jetpack Compose renderer covering Android 5.0+ with more than 20 component mappings, two-way data binding, and accessibility support.

**sivamrudram-eng/a2ui-react-native** implements a React Native renderer, supporting iOS and Android clients from a single TypeScript codebase.

**BBC6BAE9/a2ui-swift** is a native Apple renderer targeting SwiftUI, UIKit, and AppKit through a shared `A2UISwiftCore` layer. It runs on iOS, iPadOS, macOS, tvOS, visionOS, and watchOS, supporting A2UI v0.8 and v0.9/v0.9.1 with native controls following Apple Human Interface Guidelines.

**AGenUI/AGenUI** is a cross-platform native renderer supporting iOS, Android, and HarmonyOS through a shared C++ core. It implements A2UI v0.9, provides runtime APIs for extending UI components and functions, and includes a [custom catalog](https://github.com/AGenUI/AGenUI/blob/main/agenui_catalog.json) that adds Table, Carousel, Web, and RichText components.

**lynx-family/lynx-stack** (`@lynx-js/genui/a2ui`) provides a ReactLynx renderer for A2UI v0.9 across mobile, web, and desktop. It processes server-to-client messages through a `MessageStore`, renders approved components from caller-supplied catalogs, and forwards generated actions through `onAction`.

**yessGlory17/generative-mui** (`@yessglory/generative-mui-react`) maps all 18 Basic Catalog components onto Material UI. It renders inside the host application's existing `<ThemeProvider>` so the surface inherits the host palette and typography. The implementation divides into a framework-neutral core (`@yessglory/generative-mui-core`) and a React/MUI adapter, supporting data binding, validation checks, streaming placeholders, and an optional extended catalog.

**ChaliceForAuri/a2ui-svelte** (`svelte-a2ui`) is a Svelte 5 renderer built with runes, targeting the v1.0 Candidate specification while maintaining component compatibility with v0.9. It covers all 18 Basic Catalog components, the complete icon set, built-in functions, and collection templates. It supports HTTP JSONL/SSE, the A2A extension binding (`application/a2ui+json`), and AG-UI transports.

**Language-Lit/material3-expressive-a2ui** (`@language-lit/material3-expressive-a2ui`) maps Basic Catalog components onto the Material 3 Expressive React design system. Built on `@a2ui/web_core`, it provides a `useA2ui` hook, an `A2uiSurface` component, data binding, validation checks, and streaming placeholders. The same catalog also works with `@a2ui/react`.

**uny/a2ui-compose** (`dev.ynagai.a2ui:a2ui-material3`) is a Compose Multiplatform renderer that targets Android, iOS, desktop (JVM), macOS, and Web (Kotlin/JS and Kotlin/Wasm) from a single shared codebase. It targets the v1.0 specification and provides the 18 Basic Catalog components, built-in functions, validation checks, and collection templates.

### Notable mentions

The following projects represent early-stage or experimental community implementations:

1. **[xpert-ai/a2ui-react](https://www.npmjs.com/package/@xpert-ai/a2ui-react)** (`@xpert-ai/a2ui-react`) — React renderer built with ShadCN UI components.
2. **[josh-english-2k18/a2ui-3d-renderer](https://github.com/josh-english-2k18/a2ui-3d-renderer)** — Experimental Three.js and WebGL 3D renderer for A2UI surfaces.
3. **[AINative-Studio/ai-kit-a2ui](https://github.com/AINative-Studio/ai-kit-a2ui)** — React and ShadCN renderer designed for the AIKit framework.

### Related generative UI projects

These projects are related generative UI tools that interact with or support the A2UI protocol:

| Project                                        | Platform                                   | Description                                                                                                                                                  | Links                                                                                                                                                                                 |
| :--------------------------------------------- | :----------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **vercel-labs/json-render** (`@json-render/*`) | React, Vue, Svelte, Solid, React Native    | Generative UI framework by Vercel that uses its own JSON schema with Zod-based component catalogs, streaming, and cross-platform rendering.                  | [GitHub](https://github.com/vercel-labs/json-render) · [npm](https://www.npmjs.com/package/@json-render/core) · [Docs](https://json-render.dev/)                                      |
| **thesysdev/openui** (`@openuidev/a2ui`)       | Framework-agnostic core with React adapter | Generative UI profile from OpenUI that follows A2UI v1.0 surface and envelope lifecycles while transmitting component definitions as OpenUI Lang statements. | [GitHub](https://github.com/thesysdev/openui/tree/main/packages/a2ui) · [npm](https://www.npmjs.com/package/@openuidev/a2ui) · [Docs](https://www.openui.com/docs/api-reference/a2ui) |

## Agent libraries and developer utilities

In addition to client renderers, the community maintains server-side libraries and developer tools:

### Agent libraries

| Project                                              | Language   | Description                                                                                                                                                                 | Links                                                                                                                                                               |
| :--------------------------------------------------- | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Max-Health-Inc/prefab** (`@maxhealth.tech/prefab`) | TypeScript | Server-side component library that generates A2UI payloads from a typed component tree, validates catalog compatibility, and serves A2UI over MCP as an `a2ui://` resource. | [GitHub](https://github.com/Max-Health-Inc/prefab) · [npm](https://www.npmjs.com/package/@maxhealth.tech/prefab) · [Docs](https://maxhealth.tech/prefab/guide/a2ui) |

### Developer utilities

- **[@a2ui/markdown-it](https://www.npmjs.com/package/@a2ui/markdown-it)** — Markdown rendering plugin for A2UI text components across web renderers.

## Production deployments and case studies

Organizations and teams at Google and partner companies use A2UI to deliver stateful generative agent interfaces in production environments.

### Google Opal

[Opal](http://opal.google) lets users create, edit, and share AI mini-applications using natural language prompts without manual code authoring.

The Opal team at Google is a core contributor to the A2UI specification and uses A2UI to power the generative UI system in Opal. The protocol enables rapid interface prototyping and user-generated applications without hardcoded front-end templates.

> "A2UI is foundational to our work. It gives us the flexibility to let the AI drive the user experience in novel ways, without being constrained by a fixed front-end. Its declarative nature and focus on security allow us to experiment quickly and safely."
>
> — **Dimitri Glazkov**, Principal Engineer, Opal Team

### Gemini Enterprise

Gemini Enterprise allows organizations to build custom agents configured for internal workflows and business data.

A2UI integration enables enterprise agents to display structured, interactive interfaces within business tools, including data collection forms, approval workflows, and task dashboards.

> "Our customers need their agents to do more than just answer questions; they need them to guide employees through complex workflows. A2UI will allow developers building on Gemini Enterprise to have their agents generate the dynamic, custom UIs needed for any task, from data entry forms to approval dashboards, dramatically accelerating workflow automation."
>
> — **Fred Jabbour**, Product Manager, Gemini Enterprise

A2UI rendering in Gemini Enterprise currently operates with self-serve agents registered through the Agent-to-Agent (A2A) path (`a2aAgentDefinition`). Managed agents registered through the `adkAgentDefinition` path on Vertex AI Agent Engine do not currently support direct A2UI rendering.

### Flutter GenUI SDK

The [Flutter GenUI SDK](https://docs.flutter.dev/ai/genui) brings agent-generated interfaces to Flutter applications on mobile, desktop, and web platforms.

GenUI uses A2UI as its underlying wire protocol between server agents and client Flutter widgets. This allows a single backend agent to drive native client surfaces across iOS, Android, desktop, and web with consistent design system bindings.

> "Our developers choose Flutter because it lets them quickly create expressive, brand-rich, custom design systems that feel great on every platform. A2UI was a great fit for Flutter's GenUI SDK because it ensures that every user, on every platform, gets a high quality native feeling experience."
>
> — **Vijay Menon**, Engineering Director, Dart & Flutter

Resources:

1. [Flutter GenUI documentation](https://docs.flutter.dev/ai/genui)
2. [Flutter GenUI introduction video](https://www.youtube.com/watch?v=nWr6eZKM6no)
3. [Verdure client-server sample](https://github.com/flutter/genui/tree/main/examples/verdure)

### Google Agent Development Kit (ADK)

The [Agent Development Kit](https://google.github.io/adk-docs/) (ADK) is Google's open-source framework for building and running AI agents. Its developer interface, [ADK Web](https://github.com/google/adk-web), includes built-in A2UI rendering support.

ADK maps A2UI Basic Catalog components to native chat UI elements, converts between A2UI messages and A2A DataPart metadata events, and integrates with the [Python Agent SDK](https://github.com/a2ui-project/a2ui/tree/main/python/a2ui_agent) via an ADK extension.

Resources:

1. [ADK documentation](https://google.github.io/adk-docs/)
2. [ADK Web repository](https://github.com/google/adk-web)
3. [Agent integration guide](/guides/agent-integration/)

### Google internal products

Teams across Google use A2UI to standardize how agents produce user interfaces alongside text output. Common patterns include multi-agent surfaces where several agents contribute to one view, remote agent orchestration, and unified UI contracts across product boundaries.

> "Much like A2A lets any agent talk to another agent regardless of platform, A2UI standardizes the user interface layer and supports remote agent use cases through an orchestrator. This has been incredibly powerful for internal teams, allowing them to rapidly develop agents where rich user interfaces are the norm, not the exception. As Google pushes further into generative UI, A2UI provides a perfect platform for server-driven UI that renders on any client."
>
> — **James Wren**, Senior Staff Engineer, AI Powered Google

### Partner integrations

#### AG-UI / CopilotKit

[AG-UI](https://ag-ui.com/) provides an event protocol and [CopilotKit](https://www.copilotkit.ai/) provides a full-stack framework for agentic applications with day-zero A2UI compatibility. AG-UI manages application state synchronization and real-time streaming, while A2UI defines the structured declarative component layout.

> "AG-UI excels at creating a high-bandwidth connection between a custom-built front-end and its dedicated agent. By adding support for A2UI, we're giving developers the best of both worlds. They can now build rich, state-synced applications that can also render dynamic UIs from third-party agents via A2UI. It's a perfect match for a multi-agent world."
>
> — **Atai Barkai**, Founder of CopilotKit and AG-UI

#### AG2

[AG2](https://ag2.ai/) is an open-source multi-agent orchestration framework. Its `A2UIAgent` class provides built-in prompt engineering, schema validation, and action handling for generating A2UI surfaces served over both A2A (JSON-RPC) and AG-UI (SSE) transports.

> "A2UIAgent brings the A2UI protocol to AG2, enabling agent expression with dynamic, rich, and interactive UIs. Reliable, client-agnostic rendering means our developers spend less time on integration and more time building great experiences."
>
> — **Mark Sze**, Founding Engineer, AG2

Resources:

1. [A2UIAgent documentation](https://docs.ag2.ai/latest/docs/user-guide/reference-agents/a2uiagent)
2. [Technical overview](https://docs.ag2.ai/latest/docs/blog/2026/03/20/AG2-A2UI/)
3. [AG2 + Flutter sample](https://github.com/ag2ai/build-with-ag2/tree/main/a2ui/flutter)

### Third-party integrations and examples

1. **[OpenClaw Canvas](https://docs.openclaw.ai/platforms/mac/canvas)** — OpenClaw uses A2UI to display agent-generated interfaces across connected devices through its canvas system. See the [system architecture overview](https://ppaolo.substack.com/p/openclaw-system-architecture-overview).
2. **[Restaurant Finder demo](https://github.com/a2ui-project/a2ui/tree/main/samples/agent/adk/restaurant_finder)** — Sample reservation agent using Google ADK and Gemini with automated form generation.
3. **[Component Gallery](https://github.com/a2ui-project/a2ui/tree/main/samples/client/angular)** — Interactive showcase of Basic Catalog components with code examples.

## Community showcase and contributing

The A2UI project welcomes contributions, third-party renderers, and ecosystem tools.

### How to submit a project

To submit a renderer, library, or tool for inclusion in this directory:

1. **Fork the repository**: Create a fork of [a2ui-project/a2ui](https://github.com/a2ui-project/a2ui).
2. **Update the directory**: Add your project to `docs/site/src/content/docs/ecosystem/renderers.md` with package details, platform support, supported protocol versions, and repository links.
3. **Submit a pull request**: Open a PR with a description of the project and test instructions.
4. **Share on GitHub Discussions**: Introduce your project on [GitHub Discussions](https://github.com/a2ui-project/a2ui/discussions) with an optional demo video or walkthrough.

### Listing criteria

Submissions are evaluated against the following guidelines:

1. **Public source code**: The project should have an open-source repository (typically Apache 2.0 or MIT).
2. **Clear protocol versioning**: Documentation must state supported protocol versions (`v0.8`, `v0.9.1`, or `v1.0`).
3. **Basic Catalog coverage**: Client renderers should support core layout, text, input, and action components.
4. **Setup documentation**: The repository should include clear installation instructions and a minimal runnable example.
5. **Active maintenance**: Projects should reflect active maintenance; archived projects should be labeled accordingly.

Experimental, research, and early-stage tools are welcome in the [Notable mentions](#notable-mentions) section.

### Code of conduct and participation

All community members and contributors are expected to follow the project standards:

1. Be respectful and constructive in code reviews and discussions.
2. Welcome new contributors and assist with questions.
3. Report any issues or security concerns through [GitHub Issues](https://github.com/a2ui-project/a2ui/issues).
4. Discuss new feature ideas and protocol proposals on [GitHub Discussions](https://github.com/a2ui-project/a2ui/discussions).
