# Roadmap

This roadmap outlines the current state and future plans for the A2UI project. The project is under active development, and priorities may shift based on community feedback and emerging use cases.

## Current Status

### Protocol

| Version    | Status       | Notes                                   |
| ---------- | ------------ | --------------------------------------- |
| **v0.8**   | 🆗 Prior     | Initial public release, minimal support |
| **v0.9**   | 🆗 Prior     | Feature complete, legacy support        |
| **v0.9.1** | 🆗 Current   | stable release                          |
| **v1.0**   | 📋 Candidate | release candidate                       |

### Renderers

| Client libraries                                           | Status      | Platform             | Notes                                                               |
| ---------------------------------------------------------- | ----------- | -------------------- | ------------------------------------------------------------------- |
| **Web Core Lib**                                           | ✅ Stable   | Web                  | Shared core lib for all web renderers                               |
| **Web Components (Lit)**                                   | ✅ Stable   | Web                  | Framework-agnostic, works anywhere                                  |
| **Angular**                                                | ✅ Stable   | Web                  | Full Angular integration                                            |
| **Flutter (GenUI SDK)**                                    | ✅ Stable   | Multi-platform       | Works on mobile, web, desktop                                       |
| **React**                                                  | ✅ Stable   | Web                  | Official React renderer                                             |
| [**Lynx**](https://lynxjs.org/next/react/genui/a2ui.html)  | ✅ Stable   | Mobile, Web, Desktop | ReactLynx renderer for A2UI v0.9                                    |
| **SwiftUI**                                                | 📋 Planned  | iOS/macOS            | Planned for Q2 2026                                                 |
| **Jetpack Compose**                                        | 📋 Planned  | Android              | Planned for Q2 2026                                                 |
| **Vue**                                                    | 💡 Proposed | Web                  | Community interest                                                  |
| [**Svelte/Kit**](https://svelte.dev/docs/kit/introduction) | 💡 Proposed | Web                  | [Community interest](https://news.ycombinator.com/item?id=46287728) |
| **ShadCN (React)**                                         | 💡 Proposed | Web                  | Community interest                                                  |

### Transports

| Transport                        | Status      | Notes                      |
| -------------------------------- | ----------- | -------------------------- |
| **A2A Protocol**                 | ✅ Complete | Native A2A transport       |
| **AG-UI**                        | ✅ Complete | Day-zero compatibility     |
| **REST API**                     | ✅ Complete | Request/response over HTTP |
| **WebSockets**                   | ✅ Complete | Bidirectional WS           |
| **MCP (Model Context Protocol)** | ✅ Complete | Context sharing            |

### Agent frameworks

| Integration                      | Status         | Notes                                                                              |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| **Any agent with A2A support**   | ✅ Complete    | Day-zero compatibility thanks to A2A protocol                                      |
| **Any agent with AG-UI support** | ✅ Complete    | Day-zero compatibility thanks to AG-UI protocol                                    |
| **AG2**                          | ✅ Complete    | [A2UIAgent](https://docs.ag2.ai/latest/docs/user-guide/reference-agents/a2uiagent) |
| **ADK**                          | 🚧 In Progress | Still designing developer ergonomics, see [samples](../samples/agent/adk)          |
| **Genkit**                       | 💡 Proposed    | Community interest                                                                 |
| **LangGraph**                    | 💡 Proposed    | Community interest                                                                 |
| **CrewAI**                       | 💡 Proposed    | Community interest                                                                 |
| **Claude Agent SDK**             | 💡 Proposed    | Community interest                                                                 |
| **OpenAI Agent SDK**             | 💡 Proposed    | Community interest                                                                 |
| **Microsoft Agent Framework**    | 💡 Proposed    | Community interest                                                                 |
| **AWS Strands Agent SDK**        | 💡 Proposed    | Community interest                                                                 |

## Recent Milestones

### Q2 2025

Many research projects across multiple Google teams, including integration into internal products and agents.

### Q4 2025 v0.8

- v0.8.0 spec released
- A2A extension (thanks Google A2A team! teased at [a2asummit.ai](https://a2asummit.ai))
- Flutter renderer (thanks Flutter team!)
- Angular renderer (thanks Angular team!)
- Web components (Lit) renderer (thanks Opal team & friends!)
- AG-UI / CopilotKit integration (thanks CopilotKit team!)
- Github public release (Apache 2.0)

### Q2 2026 v0.9

- Release spec 0.9
- Release web core and renderers to support spec 0.9
- Launch official A2UI React renderer
- Improve theming support for renderers
- Launch A2UI Agents SDK (python)
- Improve developer ergonomics

## Upcoming Milestones

### Q3 2026 v0.9 & v1.0

**Jetpack Compose Renderer (Android):**

- Native Compose UI components
- Material Design 3 support
- Android platform integration

**SwiftUI Renderer (iOS/macOS):**

- Native SwiftUI components
- iOS design language support
- macOS compatibility

**Performance Optimizations**

- Renderer performance benchmarks
- Lazy loading for large component trees
- Virtual scrolling for lists
- Component memoization strategies

### Q4 2026 v1.0

**Finalize v1.0 of the protocol with:**

- Stability guarantees
- Migration path from v0.9
- Comprehensive test suite
- Certification program for renderers

## Long-Term Vision

### Full App UIs

Configurable, Customizable UIs - facilitated by A2UI (agent optional)

- Developer tooling for A2UI at build time
- Patterns for A2UI caching, as config layer for static UI
- Designs and samples for full app composition

### Multi-Agent Coordination

Enhanced support for multiple agents contributing to the same UI:

- Recommended agent composition patterns
- Conflict resolution strategies
- Shared surface management

### Accessibility Features

First-class accessibility support:

- ARIA attribute generation
- Screen reader optimization
- Keyboard navigation standards
- Contrast and color guidance

### Advanced UI Patterns

Support for more complex UI interactions:

- Drag and drop
- Gestures and animations
- 3D rendering
- AR/VR interfaces (exploratory)

### Ecosystem Growth

- More framework integrations
- Third-party component libraries
- Agent marketplace integration
- Enterprise features and support

## How to Influence the Roadmap

We welcome community input on priorities:

1. **Submit feedback form**: Use [this anonymous form](https://forms.gle/Tj8E3dMsJ1NcvQnFA) to share your requirements and feedback
2. **Vote on Issues**: Give 👍 to GitHub issues you care about
3. **Propose Features**: Open a discussion on GitHub (search for existing discussions first)
4. **Submit PRs**: Build the features you need (search for existing PRs first)
5. **Join Discussions**: Share your use cases and requirements (search for existing discussions first)

## Planned Release Cycle

- **Major versions** (1.0, 2.0): Annual or when significant breaking changes are needed
- **Minor versions** (1.1, 1.2): Quarterly with new features
- **Patch versions** (1.1.1, 1.1.2): As needed for bug fixes

## Versioning Policy

A2UI follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: Incompatible protocol changes
- **MINOR**: Backward-compatible functionality additions
- **PATCH**: Backward-compatible bug fixes

## Stay Updated

- Watch the [GitHub repository](https://github.com/a2ui-project/a2ui) for updates
- Star the repo to show your support
- Follow releases to get notified of new versions

---

**Last Updated:** June 2026

Have questions about the roadmap? [Start a discussion on GitHub](https://github.com/a2ui-project/a2ui/discussions).
