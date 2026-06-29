# How Does A2UI Compare?

The agentic UI space is evolving rapidly. Here's how A2UI relates to the other major approaches.

## At a Glance

|                    | **A2UI**                                        | **MCP Apps**                                                                     | **AG-UI**                                                |
| ------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Approach**       | Declarative component blueprints                | Pre-built HTML via `ui://` URIs                                                  | High-bandwidth protocol connecting backends to frontends |
| **Rendering**      | Native components (Angular, Flutter, Lit, etc.) | Sandboxed `iframe`                                                               | Developer-defined (any framework)                        |
| **Styling**        | Host app controls: inherits design system       | Isolated: remote server controls appearance                                      | Developer controls: part of the host app                 |
| **Security**       | Declarative data, no code execution             | Sandboxed iframe isolation                                                       | Trusted code within your own app                         |
| **Multi-agent**    | ✅ Across trust boundaries                      | ✅ Multiple MCP servers                                                          | ⚠️ Primarily single-agent                                |
| **Cross-platform** | ✅ Web, mobile, desktop, native                 | ⚠️ Web-focused (iframe)                                                          | ✅ Protocol is framework-agnostic                        |
| **LLM generation** | ✅ Designed for streaming output                | ❌ Pre-built by server                                                           | ✅ Via A2UI integration                                  |
| **Spec**           | Open protocol (Apache 2.0)                      | [MCP extension](https://modelcontextprotocol.io/docs/extensions/apps) (SEP-1865) | Open source (by CopilotKit)                              |

## A2UI vs MCP Apps

[MCP Apps](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/) treat UI as a **resource**: servers provide pre-built HTML via `ui://` URIs, rendered in sandboxed iframes. The remote integration controls all content and appearance, with configuration happening through tool calling. A2UI takes a **declarative UI** approach: agents send component blueprints, but the host application controls styling, theming, and how those components are configured and rendered. Choose MCP Apps when the server should own the full UI experience; choose A2UI when you want dynamic, cross-platform UI that fits naturally into your app.

## A2UI vs AG-UI / CopilotKit

[AG-UI](https://ag-ui.com/) is a **transport protocol** connecting agent backends to frontends with real-time state sync. A2UI is a **UI format**: the payload that describes what to render. They're complementary: use AG-UI as the pipe, A2UI as the content. AG-UI is a project by the [CopilotKit](https://copilotkit.ai) team, who also contributed the [A2UI Composer](../composer.md). AG-UI has day-zero A2UI compatibility.

## A2UI vs ChatKit (OpenAI)

[ChatKit](https://platform.openai.com/docs/guides/chatkit) offers a tightly integrated experience within the OpenAI ecosystem. A2UI shares some design philosophy with ChatKit: both define a set of basic components and use a configurable, declarative abstraction layer. A2UI is **platform-agnostic** and designed for developers building their own agentic surfaces across web, mobile, and desktop, or for multi-agent systems where agents need to render UI across trust boundaries.

## Using Them Together

These approaches are complementary, not competing:

- **A2UI + AG-UI**: AG-UI as transport, A2UI as the generative UI format.
- **A2UI + A2A**: A2UI messages sent via the [A2A protocol](../concepts/transports.md) for multi-agent systems.
- **A2UI + MCP**: Upcoming bridge lets MCP servers provide A2UI blueprints alongside HTML resources.

## Further Reading

For more information, see the following resources:

- [What is A2UI?](what-is-a2ui.md): Protocol overview.
- [Transports](../concepts/transports.md): How A2UI messages travel between agents and clients.
- [Where is A2UI Used?](../ecosystem/a2ui-in-the-world.md): Case studies and adopters.
