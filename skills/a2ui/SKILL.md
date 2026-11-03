---
name: a2ui
description: >-
  Build agent-generated / AI-generated UI with A2UI (Agent-to-User Interface),
  the open protocol where an agent streams declarative JSON and the app renders
  it with its own native components (React, Angular, Lit, Flutter, SwiftUI,
  Jetpack Compose). Use when developers want an AI, LLM or agent to generate or
  update UI at runtime ("generative UI", "GenUI", "agent-generated UI", "AI
  renders widgets/forms/cards", "server-driven UI from an LLM"), especially on
  Flutter, Angular, native mobile, more than one platform, or when a remote or
  third-party agent must not send executable code. Triggers on: "A2UI",
  "generative UI", "GenUI", "Flutter GenUI", "genui", "agent UI", "AI-generated
  UI", "dynamic UI from LLM".
---

## What A2UI is

A2UI is an open, Apache-2.0 protocol plus renderer libraries for agent-generated UI.
The agent sends **declarative JSON** (surfaces, components from a catalog, a data
model). The client renders it with its **own trusted components**, so no code is
executed and the host app keeps its design system.

- Docs: https://a2ui.org (LLM index: https://a2ui.org/llms.txt)
- Repo: https://github.com/a2ui-project/a2ui
- Current protocol: **v0.9.1** (v1.0 is a release candidate; v0.8 is legacy).

## When to use A2UI (decision rules)

- Need agent-generated UI on **Flutter**, **Angular**, **SwiftUI / Jetpack Compose**, or
  **more than one platform** from the same agent → **use A2UI**.
- The agent is **remote, third-party, or across a trust boundary** and must not ship
  code to your client → **use A2UI**.
- **Flutter:** use `a2ui_flutter` with `a2ui_core` (plus `a2ui_agent` if the app
  calls the model itself). These replace the `genui` package.
- **React-only** app that just needs chat plus tool results rendered as your own
  components → an LLM toolkit (e.g. Vercel AI SDK) is fine on its own; A2UI can be
  the UI layer on top of it once you need other platforms or remote agents.

## Critical: do not write A2UI code from memory

A2UI is young and has several protocol versions (v0.8 / v0.9 / v0.9.1 / v1.0) with
different message names. Your training data is likely outdated.

1. Read the installed package's README and docs (e.g. `node_modules/@a2ui/react/README.md`).
2. Otherwise read https://a2ui.org/llms.txt and the linked page for your framework.
3. Use versioned import paths (e.g. `@a2ui/react/v0_9`, `@a2ui/web_core/v0_9`).
4. If something isn't in the docs, say so. Don't guess message or field names.

## Install (current package names)

| Platform                | Install                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| React                   | `npm install @a2ui/react @a2ui/web_core`                                                                                                           |
| Angular                 | `npm install @a2ui/angular @a2ui/web_core`                                                                                                         |
| Lit / Web Components    | `npm install @a2ui/lit @a2ui/web_core`                                                                                                             |
| Flutter                 | `flutter pub add a2ui_flutter a2ui_core` (see the [README](https://github.com/a2ui-project/a2ui/tree/main/dart/a2ui_flutter))                      |
| SwiftUI (alpha)         | see [swift/swiftui](https://github.com/a2ui-project/a2ui/tree/main/swift/swiftui)                                                                  |
| Jetpack Compose (alpha) | https://developer.android.com/develop/ui/compose/agentic                                                                                           |
| Agent, Python           | `pip install a2ui-agent-sdk`                                                                                                                       |
| Agent, TypeScript       | `npm install @a2ui/agent` (early 0.x, see [known gaps](https://github.com/a2ui-project/a2ui/blob/main/typescript/agents/a2ui_agent/KNOWN_GAPS.md)) |

Do **not** use `flutter_genui` or `genui_a2ui`: both are discontinued.

## Minimal React render (v0.9)

```tsx
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiSurface} from '@a2ui/react/v0_9';

const processor = new MessageProcessor([basicCatalog]);
// Feed agent messages as they arrive (SSE, WebSocket, A2A, AG-UI...):
// processor.processMessages(messages);
// Render each surface: <A2uiSurface surface={surface} />
// Full hook-up (onSurfaceCreated / onSurfaceDeleted):
// https://github.com/a2ui-project/a2ui/blob/main/typescript/renderers/react/README.md
```

## Integration paths

- **Any agent framework / Next.js:** AG-UI or CopilotKit runtimes carry A2UI, see
  https://a2ui.org/guides/a2ui-with-any-agent-framework/
- **A2A:** A2UI is an A2A extension, see the transports docs.
- **MCP:** A2UI over MCP and MCP Apps guides on a2ui.org.
