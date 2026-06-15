# A2UI in the World

A2UI is being adopted by teams at Google and partner organizations to build the next generation of agent-driven applications. Here are real-world examples of where A2UI is making an impact.

## Production Deployments

### Google Opal: AI Mini-Apps for Everyone

[Opal](http://opal.google) enables hundreds of thousands of people to build, edit, and share AI mini-apps using natural language—no coding required.

**How Opal uses A2UI:**

The Opal team at Google has been a **core contributor to A2UI** from the beginning. They use A2UI to power the dynamic, generative UI system that makes Opal's AI mini-apps possible.

- **Rapid prototyping**: Build and test new UI patterns quickly.
- **User-generated apps**: Anyone can create apps with custom UIs.
- **Dynamic interfaces**: UIs adapt to each use case automatically.

> "A2UI is foundational to our work. It gives us the flexibility to let the AI drive the user experience in novel ways, without being constrained by a fixed front-end. Its declarative nature and focus on security allow us to experiment quickly and safely."
>
> **— Dimitri Glazkov**, Principal Engineer, Opal Team

**Learn more:** [opal.google](http://opal.google)

---

### Gemini Enterprise: Custom Agents for Business

Gemini Enterprise enables businesses to build powerful, custom AI agents tailored to their specific workflows and data.

**How Gemini Enterprise uses A2UI:**

A2UI is being integrated to allow enterprise agents to render **rich, interactive UIs** within business applications—going beyond simple text responses to guide employees through complex workflows.

- **Data entry forms**: AI-generated forms for structured data collection.
- **Approval dashboards**: Dynamic UIs for review and approval processes.
- **Workflow automation**: Step-by-step interfaces for complex tasks.
- **Custom enterprise UIs**: Tailored interfaces for industry-specific needs.

> "Our customers need their agents to do more than just answer questions; they need them to guide employees through complex workflows. A2UI will allow developers building on Gemini Enterprise to have their agents generate the dynamic, custom UIs needed for any task, from data entry forms to approval dashboards, dramatically accelerating workflow automation."
>
> **— Fred Jabbour**, Product Manager, Gemini Enterprise

**Learn more:** [Gemini Enterprise](https://cloud.google.com/gemini)

---

### Flutter GenUI SDK: Generative UI for Mobile

The [Flutter GenUI SDK](https://docs.flutter.dev/ai/genui) brings dynamic, AI-generated UIs to Flutter applications across mobile, desktop, and web.

**How GenUI uses A2UI:**

GenUI SDK uses **A2UI as the underlying protocol** for communication between server-side agents and Flutter applications. When you use GenUI, you're using A2UI under the covers.

- **Cross-platform support**: Same agent works on iOS, Android, web, desktop.
- **Native performance**: Flutter widgets rendered natively on each platform.
- **Brand consistency**: UIs match your app's design system.
- **Server-driven UI**: Agents control what's shown without app updates.

> "Our developers choose Flutter because it lets them quickly create expressive, brand-rich, custom design systems that feel great on every platform. A2UI was a great fit for Flutter's GenUI SDK because it ensures that every user, on every platform, gets a high quality native feeling experience."
>
> **— Vijay Menon**, Engineering Director, Dart & Flutter

**Try it:**

- [GenUI Documentation](https://docs.flutter.dev/ai/genui)
- [Getting Started Video](https://www.youtube.com/watch?v=nWr6eZKM6no)
- [Verdure Example](https://github.com/flutter/genui/tree/main/examples/verdure) (client-server A2UI sample)

---

### Google ADK: Agent Development Kit

The [Agent Development Kit](https://google.github.io/adk-docs/) (ADK) is Google's open-source framework for building and deploying AI agents. The built-in developer UI, [ADK Web](https://github.com/google/adk-web), includes native A2UI rendering.

**How ADK uses A2UI:**

ADK integrated the A2UI v0.8 basic catalog to automatically render spec-compliant agent parts as native UI components directly in the chat. ADK also handles A2UI↔A2A message conversion, so agents built with ADK can send rich UI to any A2UI-capable client.

- **Built-in rendering**: ADK Web renders A2UI components natively in the dev UI.
- **A2A integration**: A2UI messages are converted between A2A DataPart metadata and ADK events.
- **Agent SDK**: The [A2UI Python agent SDK](https://github.com/a2ui-project/a2ui/tree/main/agent_sdks/python) provides an ADK extension for generating A2UI from agents.

**Try it:**

- [ADK Documentation](https://google.github.io/adk-docs/)
- [ADK Web](https://github.com/google/adk-web) (developer UI with A2UI support)
- [Agent Development Guide](../guides/agent-development.md) (building A2UI agents with ADK)

---

## Partner Integrations

### AG-UI / CopilotKit: Full-Stack Agentic Framework

[AG-UI](https://ag-ui.com/) provides the protocol and [CopilotKit](https://www.copilotkit.ai/) provides the primary full-stack framework for building agentic applications, with **day-zero A2UI compatibility**.

**How they work together:**

AG-UI excels at creating high-bandwidth connections between custom frontends and their dedicated agents. By adding A2UI support, developers get the best of both worlds:

- **State synchronization**: AG-UI handles app state and chat history.
- **A2UI rendering**: Render dynamic UIs from third-party agents.
- **Multi-agent support**: Coordinate UIs from multiple agents.
- **Framework integrations**: React, Vue, Angular, and other app surfaces through CopilotKit.

> "AG-UI excels at creating a high-bandwidth connection between a custom-built front-end and its dedicated agent. By adding support for A2UI, we're giving developers the best of both worlds. They can now build rich, state-synced applications that can also render dynamic UIs from third-party agents via A2UI. It's a perfect match for a multi-agent world."
>
> **— Atai Barkai**, Founder of CopilotKit and AG-UI

**Learn more:**

- [AG-UI](https://ag-ui.com/)
- [CopilotKit](https://www.copilotkit.ai/)

---

### AG2: Multi-Agent Framework with Native A2UI

[AG2](https://ag2.ai/) is a popular multi-agent framework, offering advanced orchestration of agents. Its [A2UIAgent](https://docs.ag2.ai/latest/docs/user-guide/reference-agents/a2uiagent) is a reference agent with native A2UI support, enabling AG2 agents to generate rich, interactive UI served over both A2A and AG-UI.

**How AG2 uses A2UI:**

A2UIAgent extends AG2's ConversableAgent with built-in A2UI capabilities — prompt engineering, schema validation with retry, and action handling — so developers can add generative UI to their agents without custom rendering code.

- **Validated output**: Built-in schema validation and retry ensures reliable A2UI generation.
- **Dual transport**: Serves the same UI over A2A (JSON-RPC) and AG-UI (SSE).
- **Cross-platform**: One agent serves web, desktop, and mobile clients.
- **Custom catalogs**: Extend the component catalog with domain-specific components.

> "A2UIAgent brings the A2UI protocol to AG2, enabling agent expression with dynamic, rich, and interactive UIs. Reliable, client-agnostic rendering means our developers spend less time on integration and more time building great experiences."
>
> **— Mark Sze**, Founding Engineer, AG2

**Learn more:**

- [A2UIAgent Documentation](https://docs.ag2.ai/latest/docs/user-guide/reference-agents/a2uiagent)
- [Technical Deep Dive](https://docs.ag2.ai/latest/docs/blog/2026/03/20/AG2-A2UI/) — Building A2UI agents with AG2
- [A2UIAgent + Flutter Example](https://github.com/ag2ai/build-with-ag2/tree/main/a2ui/flutter) — A2UIAgent served over A2A to a Flutter GenUI client
- [AG2](https://ag2.ai/)

---

### Google's AI-Powered Products

As Google adopts AI across the company, A2UI provides a **standardized way for AI agents to exchange user interfaces**, not just text.

**Internal agent adoption:**

- **Multi-agent workflows**: Multiple agents contribute to the same surface.
- **Remote agent support**: Agents running on different services can provide UI.
- **Standardization**: Common protocol across teams reduces integration overhead.
- **External exposure**: Internal agents can be easily exposed externally (e.g., Gemini Enterprise).

> "Much like A2A lets any agent talk to another agent regardless of platform, A2UI standardizes the user interface layer and supports remote agent use cases through an orchestrator. This has been incredibly powerful for internal teams, allowing them to rapidly develop agents where rich user interfaces are the norm, not the exception. As Google pushes further into generative UI, A2UI provides a perfect platform for server-driven UI that renders on any client."
>
> **— James Wren**, Senior Staff Engineer, AI Powered Google

---

## Community Projects

The A2UI community is building exciting projects:

### Open Source Examples

- **Restaurant Finder** ([samples/agent/adk/restaurant_finder](https://github.com/a2ui-project/a2ui/tree/main/samples/agent/adk/restaurant_finder))
    - Table reservation with dynamic forms
    - Gemini-powered agent
    - Full source code available

- **Component Gallery** ([samples/client/angular - gallery mode](https://github.com/a2ui-project/a2ui/tree/main/samples/client/angular))
    - Interactive showcase of all components
    - Live examples with code
    - Great for learning

### Third-Party Integrations

- **[json-render](https://json-render.dev/docs/a2ui)** — Vercel's React library for rendering A2UI component catalogs via Zod schemas. See [json-render vs. A2UI comparison](https://dipjyotimetia.medium.com/vercels-json-render-vs-google-s-a2ui-the-head-to-head-6f213cf1a23b).
- **[OpenClaw Canvas](https://docs.openclaw.ai/platforms/mac/canvas)** — OpenClaw uses A2UI to render agent-generated UI on connected devices via its canvas system. See [architecture overview](https://ppaolo.substack.com/p/openclaw-system-architecture-overview).

### Community Contributions

Have you built something with A2UI? [Share it with the community!](community.md)

---

## Next Steps

For more information, see the following resources:

- [Quickstart Guide](../quickstart.md) - Try the demo.
- [Agent Development](../guides/agent-development.md) - Build an agent.
- [Client Setup](../guides/client-setup.md) - Integrate a renderer.
- [Community](community.md) - Join the community.

---

**Using A2UI in production?** Share your story on [GitHub Discussions](https://github.com/a2ui-project/a2ui/discussions).
