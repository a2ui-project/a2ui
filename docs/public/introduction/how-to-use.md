# How to Use A2UI

Choose the integration path that matches your role and use case.

## Three Paths

### Path 1: Building a Host Application (Frontend)

Integrate A2UI rendering into your existing app or build a new agent-powered frontend.

**Choose a renderer:**

- **Web:** Lit, Angular, React.
- **Mobile/Desktop:** Flutter GenUI SDK.

**Quick setup:**

For Angular:

```bash
npm install @a2ui/angular @a2ui/web_core
```

For React:

```bash
npm install @a2ui/react @a2ui/web_core
```

Connect to agent messages (SSE, WebSockets, or A2A) and customize styling to match your brand.

**Next:** [Client Setup Guide](../guides/client-setup.md) | [Theming](../guides/theming.md)

---

### Path 2: Building an Agent (Backend)

Create an agent that generates A2UI responses for any compatible client.

**Choose your framework:**

- **Node.js / TypeScript:** Google Genkit (`@genkit-ai/a2ui`), A2A SDK, Vercel AI SDK, custom.
- **Go:** Google Genkit (`github.com/firebase/genkit/go/plugins/a2ui/exp`).
- **Dart:** Google Genkit (`genkit_a2ui`), A2UI Dart SDK.
- **Python:** Google ADK, LangChain, custom.

Include the A2UI schema in your LLM prompts, generate JSONL messages, and stream to clients over SSE, WebSockets, or A2A.

**Next:** [Genkit Guide](../guides/genkit.md) | [Agent Development Guide](../guides/agent-development.md)

---

### Path 3: Using an Existing Framework

Use A2UI through frameworks with built-in support:

- **[Google Genkit](https://genkit.dev/docs/agents/a2ui)** - Open-source AI framework with first-class A2UI middleware in TypeScript/JavaScript, Go, and Dart.
- **[AG-UI / CopilotKit](https://ag-ui.com/)** - Full-stack agentic app framework with A2UI rendering.
- **[Flutter GenUI SDK](https://docs.flutter.dev/ai/genui)** - Cross-platform generative UI (uses A2UI internally).

**Next:** [Agent UI Ecosystem](agent-ui-ecosystem.md) | [Where is A2UI Used?](../ecosystem/a2ui-in-the-world.md)
