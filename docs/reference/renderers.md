# Renderers (Client Libraries)

Renderers convert A2UI JSON messages into native UI components for different platforms.

The [agents](agents.md) are responsible for generating the A2UI messages,
and the [transports](../concepts/transports.md) are responsible for delivering the messages to the client.
The client renderer library must buffer and handle A2UI messages, implement the A2UI lifecycle, render widgets, and route user actions back to the agent.

Let's use the web as an analogy. The A2UI protocol is like HTML. It provides a language and the semantics of the UI model. The agent is like the server that serves HTML to the client. The renderer is like a browser. It talks to the agent, interprets the A2UI protocol, and renders the UI. Just like there are multiple browser engines for HTML, there are multiple different renderers for A2UI.

You have a lot of flexibility, to bring custom components to a renderer, or build your own renderer to support your UI component framework.

## Maintained Renderers

### Web

| Renderer                 | Platform           | v0.8      | v0.9.1    | v1.0       | Links                                                                                |
| ------------------------ | ------------------ | --------- | --------- | ---------- | ------------------------------------------------------------------------------------ |
| **React**                | Web                | ✅ Stable | ✅ Stable | 🚧 Planned | [Code](https://github.com/a2ui-project/a2ui/tree/main/renderers/react)               |
| **Lit (Web Components)** | Web                | ✅ Stable | ✅ Stable | 🚧 Planned | [Code](https://github.com/a2ui-project/a2ui/tree/main/renderers/lit)                 |
| **Angular**              | Web                | ✅ Stable | ✅ Stable | 🚧 Planned | [Code](https://github.com/a2ui-project/a2ui/tree/main/renderers/angular)             |
| **Flutter (GenUI SDK)**  | Mobile/Desktop/Web | ✅ Stable | ✅ Stable | 🚧 Planned | [Docs](https://docs.flutter.dev/ai/genui) · [Code](https://github.com/flutter/genui) |

### Mobile

| Renderer                | Platform           | v0.8      | v0.9.1    | v1.0       | Links                                                                                |
| ----------------------- | ------------------ | --------- | --------- | ---------- | ------------------------------------------------------------------------------------ |
| **Flutter (GenUI SDK)** | Mobile/Desktop/Web | ✅ Stable | ✅ Stable | 🚧 Planned | [Docs](https://docs.flutter.dev/ai/genui) · [Code](https://github.com/flutter/genui) |
| **SwiftUI**             | iOS/macOS          | —         | —         | 🚧 Planned | —                                                                                    |
| **Jetpack Compose**     | Android            | —         | —         | 🚧 Planned | —                                                                                    |

Check the [Roadmap](../roadmap.md) for more.

## Ecosystem Renderers

The community is building A2UI renderers for additional platforms:

- **[json-render](https://json-render.dev/docs/a2ui)** — Vercel's React library for rendering A2UI catalogs via Zod schemas ([comparison](https://dipjyotimetia.medium.com/vercels-json-render-vs-google-s-a2ui-the-head-to-head-6f213cf1a23b))
- **[A2UI-Android](https://github.com/lmee/A2UI-Android)** — Community Jetpack Compose renderer, 20+ components (~15 ⭐, v0.8)
- **[a2ui-react-native](https://github.com/sivamrudram-eng/a2ui-react-native)** — React Native renderer for iOS/Android (~9 ⭐, v0.8)
- **[Lynx A2UI](https://lynxjs.org/next/react/genui/a2ui.html)** — ReactLynx renderer for A2UI (v0.9)

See the **[full ecosystem renderers list](../ecosystem/renderers.md)** for more community projects and how to submit your own.

## How Renderers Work

The rendering process typically involves the following steps:

1. **Receive** A2UI messages from the transport.
2. **Parse** the JSON and validate against the schema.
3. **Render** using platform-native components.
4. **Style** according to your app's theme.

## Using a Renderer

Get started integrating A2UI into your application by following the setup guide for your chosen renderer:

- **[React](../guides/client-setup.md#react)**
- **[Lit (Web Components)](../guides/client-setup.md#web-components-lit)**
- **[Angular](../guides/client-setup.md#angular)**
- **[Flutter (GenUI SDK)](../guides/client-setup.md#flutter-genui-sdk)**

## Building a Renderer

Want to build a renderer for your platform?

- See the [Roadmap](../roadmap.md) for planned frameworks.
- Review existing renderers for patterns.
- Check out our [Renderer Development Guide](../guides/renderer-development.md) for details on implementing a renderer.

A compliant renderer must meet the following key requirements:

- Parse A2UI JSON messages, specifically the adjacency list format.
- Map A2UI components to native widgets.
- Handle data binding, lifecycle events.
- Process a sequence of incremental A2UI messages to build and update the UI.
- Support server-initiated updates.
- Support user actions.

For more information, see the following resources:

- **[Client Setup Guide](../guides/client-setup.md)**: Integration instructions.
- **[Quickstart](../quickstart.md)**: Try the Lit renderer.
- **[Component Reference](components.md)**: What components to support.
