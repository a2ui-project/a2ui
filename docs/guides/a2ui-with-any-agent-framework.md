# Use A2UI with Any Agent Framework & Harness

A2UI is a declarative UI format. [AG-UI](https://ag-ui.com/) is the transport
that carries A2UI messages between an agent and an app. Use this guide to add
A2UI to an AG-UI app or harness backed by ADK, LangGraph, Mastra, Strands,
CrewAI, Google Chat, Slack, Teams, or any other agent framework or service that
supports AG-UI.

<style>
  .agui-framework-picker {
    margin: 24px 0;
  }

  .agui-framework-select {
    background: var(--md-default-bg-color);
    border: 1px solid var(--md-default-fg-color--lighter);
    border-radius: 6px;
    color: var(--md-default-fg-color);
    font: inherit;
    max-width: 100%;
    padding: 8px 12px;
    width: 320px;
  }

  .agui-framework-panel {
    margin-top: 16px;
  }

  .agui-framework-panel[hidden] {
    display: none;
  }

  .js #agui-framework-panels:not([data-agui-framework-ready])
    .agui-framework-panel {
    display: none;
  }

  .agui-framework-panel-title {
    color: var(--md-default-fg-color);
    font-size: 1.25em;
    font-weight: 700;
    margin: 1.6em 0 0.6em;
  }
</style>

<div class="agui-framework-picker">
  <select id="agui-framework-select" class="agui-framework-select" aria-controls="agui-framework-panels">
    <option value="adk">ADK</option>
    <option value="langgraph">LangGraph</option>
    <option value="mastra">Mastra</option>
    <option value="strands">Strands</option>
    <option value="crewai">CrewAI</option>
    <option value="google-chat">Google Chat</option>
    <option value="slack">Slack</option>
    <option value="teams">Teams</option>
  </select>
</div>

<video width="100%" height="auto" controls playsinline preload="metadata" style="display: block; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; margin: 24px 0;">
  <source src="../../assets/ag-ui-a2ui-demo.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

The examples below use AG-UI-compatible runtime tooling so you can focus on
the A2UI surface: enabling the renderer, giving your agent a catalog, and
streaming UI updates back to the user. For protocol-level setup and concepts,
see the [AG-UI docs](https://docs.ag-ui.com/).

## Agent skills

If you are using a coding agent to wire this up, load the
[AG-UI `ag-ui-a2ui-integration` skill](https://github.com/ag-ui-protocol/ag-ui/blob/codex/ag-ui-a2ui-skill/skills/ag-ui-a2ui-integration/SKILL.md)
before it modifies your app. It covers AG-UI framework adapters, supported
`create-ag-ui-app` flags, transport setup, A2UI runtime and renderer wiring,
and end-to-end verification for AG-UI + A2UI apps.

If your app uses CopilotKit for A2UI rendering, also load the
[CopilotKit `a2ui-renderer` skill](https://github.com/CopilotKit/CopilotKit/blob/main/skills/a2ui-renderer/SKILL.md)
for CopilotKit v2 runtime, provider, theme, and catalog conventions.

## 1. Set up AG-UI

Start from the agent framework you already use, then add an AG-UI runtime
connection between the agent and your app. The runtime streams agent events,
including A2UI messages, to the client surface.

Use the AG-UI CLI to scaffold an AG-UI app with the client and agent framework
you want:

```bash
npx create-ag-ui-app@latest
```

You can also start directly from supported framework templates:

```bash
npx create-ag-ui-app@latest --adk
npx create-ag-ui-app@latest --langgraph-py
npx create-ag-ui-app@latest --langgraph-js
npx create-ag-ui-app@latest --crewai-flows
npx create-ag-ui-app@latest --mastra
```

The important part is the transport contract: your app receives AG-UI events
and routes A2UI payloads to an A2UI renderer. Some scaffold paths use
[CopilotKit's A2UI runtime](https://docs.copilotkit.ai/generative-ui/a2ui)
with Next.js under the hood, but the setup surface stays AG-UI-first.

## 2. Set up your agent or harness

The A2UI steps are the same across frameworks: connect your agent to AG-UI,
enable A2UI payloads, and render those payloads in the app. Start with the
framework or harness you already use. The snippets below come from the
corresponding AG-UI integrations and show the framework-native agent shape
that AG-UI wraps.

<div id="agui-framework-panels" markdown="1">
<div class="agui-framework-panel" data-framework-panel="adk" markdown="1">

<p class="agui-framework-panel-title">ADK</p>

Use ADK when your agent already runs on Google's Agent Development Kit. The
AG-UI ADK middleware exposes the agent as an AG-UI event stream:

```python
from fastapi import FastAPI
from ag_ui_adk import ADKAgent, AGUIToolset, add_adk_fastapi_endpoint
from google.adk.agents import Agent

my_agent = Agent(
    name="assistant",
    instruction="You are a helpful assistant.",
    tools=[
        AGUIToolset(),  # Adds tools provided by the AG-UI client.
    ],
)

agent = ADKAgent(
    adk_agent=my_agent,
    app_name="my_app",
    user_id="user123",
)

app = FastAPI()
add_adk_fastapi_endpoint(app, agent, path="/chat")
```

See the
[AG-UI ADK middleware](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/adk-middleware/python).

</div>
<div class="agui-framework-panel" data-framework-panel="langgraph" markdown="1" hidden>

<p class="agui-framework-panel-title">LangGraph</p>

Use LangGraph when your agent workflow is a graph of stateful nodes. The AG-UI
LangGraph adapter wraps the compiled graph and streams AG-UI events. Start with
a normal compiled LangGraph graph, then wrap it with AG-UI:

```python
from typing import Any

from ag_ui_langgraph import (
    LangGraphAgent,
    add_langgraph_fastapi_endpoint,
    get_a2ui_tools,
)
from fastapi import FastAPI
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

gemini = ChatGoogleGenerativeAI(
    model="gemini-3.1-pro",
    thinking_budget=1024,
)
a2ui_tool = get_a2ui_tools({"model": gemini})
TOOLS = [a2ui_tool]

class AgentState(MessagesState):
    tools: list[Any]

async def chat_node(state: AgentState, config: RunnableConfig):
    model_with_tools = gemini.bind_tools(
        TOOLS,
        parallel_tool_calls=False,
    )

    response = await model_with_tools.ainvoke(
        [
            SystemMessage(content="You are a helpful assistant."),
            *state["messages"],
        ],
        config,
    )
    return {"messages": [response]}

def route_after_chat(state: AgentState):
    last_message = state["messages"][-1]
    if getattr(last_message, "tool_calls", None):
        return "tool_node"
    return END

workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=TOOLS))
workflow.set_entry_point("chat_node")
workflow.add_conditional_edges("chat_node", route_after_chat)
workflow.add_edge("tool_node", "chat_node")

graph = workflow.compile()

agent = LangGraphAgent(
    name="travel-assistant",
    graph=graph,
    description="A Gemini-powered LangGraph agent exposed over AG-UI.",
)

app = FastAPI()
add_langgraph_fastapi_endpoint(app, agent, "/agent")
```

`LangGraphAgent` converts LangGraph events into AG-UI events, while
`get_a2ui_tools` gives the model an AG-UI-aware A2UI generation tool. The
example uses Gemini via LangChain's Google GenAI integration.

See the
[AG-UI LangGraph integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/python)
and the
[ChatGoogleGenerativeAI integration](https://docs.langchain.com/oss/python/integrations/chat/google_generative_ai).

</div>
<div class="agui-framework-panel" data-framework-panel="mastra" markdown="1" hidden>

<p class="agui-framework-panel-title">Mastra</p>

Use Mastra when your agent service is TypeScript-first. The AG-UI Mastra adapter
exposes the Mastra agent through the same runtime contract:

```ts
import { MastraAgent } from "@ag-ui/mastra";
import { mastra } from "./mastra";

const agent = new MastraAgent({
  agent: mastra.getAgent("weather-agent"),
  resourceId: "user-123",
});

const result = await agent.runAgent({
  messages: [{ role: "user", content: "What's the weather like?" }],
});
```

See the
[AG-UI Mastra integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/mastra/typescript).

</div>
<div class="agui-framework-panel" data-framework-panel="strands" markdown="1" hidden>

<p class="agui-framework-panel-title">Strands</p>

Use Strands when your agent orchestration is already built on AWS Strands. The
AG-UI Strands adapter wraps the Strands agent for AG-UI clients:

```ts
import { Agent } from "@strands-agents/sdk";
import { StrandsAgent } from "@ag-ui/aws-strands";
import { createStrandsApp } from "@ag-ui/aws-strands/server";

const strandsAgent = new Agent({
  systemPrompt: "You are a helpful assistant.",
  tools: [],
});

const aguiAgent = new StrandsAgent({
  agent: strandsAgent,
  name: "MyAgent",
  description: "A Strands agent exposed via AG-UI",
});

const app = await createStrandsApp(aguiAgent, { path: "/invocations" });
app.listen(8000);
```

See the
[AG-UI AWS Strands integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/aws-strands/typescript).

</div>
<div class="agui-framework-panel" data-framework-panel="crewai" markdown="1" hidden>

<p class="agui-framework-panel-title">CrewAI</p>

Use CrewAI when your backend is built around CrewAI flows or crews. The AG-UI
CrewAI integration streams flow output to the client surface:

```python
from crewai.flow.flow import Flow, start
from litellm import acompletion
from ag_ui_crewai import (
    add_crewai_flow_fastapi_endpoint,
    copilotkit_stream,
    CopilotKitState,
)
from fastapi import FastAPI

class MyFlow(Flow[CopilotKitState]):
    @start()
    async def chat(self):
        response = await copilotkit_stream(
            await acompletion(
                model="gemini/gemini-3.1-pro",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    *self.state.messages,
                ],
                tools=self.state.copilotkit.actions,
                stream=True,
            )
        )
        self.state.messages.append(response.choices[0].message)

app = FastAPI()
add_crewai_flow_fastapi_endpoint(app, MyFlow(), "/flow")
```

See the
[AG-UI CrewAI integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/crew-ai/python).

</div>
<div class="agui-framework-panel" data-framework-panel="google-chat" markdown="1" hidden>

<p class="agui-framework-panel-title">Google Chat</p>

Use Google Chat when the user experience lives in a Google Workspace chat
surface. The same AG-UI event stream can feed a chat harness and render A2UI
through the surface's client bridge. Route the conversation into the same AG-UI
agent endpoint, then render A2UI operations through your Google Chat bridge:

```ts
import { createBot } from "@copilotkit/bot";
import {
  googleChat,
  defaultGoogleChatContext,
} from "@copilotkit/bot-google-chat";

const bot = createBot({
  adapters: [
    googleChat({
      projectId: process.env.GOOGLE_CLOUD_PROJECT!,
      credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS!,
    }),
  ],
  agent: (threadId) => makeAgent(threadId),
  tools: [...appTools],
  context: [...defaultGoogleChatContext, ...appContext],
});

bot.onMessage(({ thread }) => thread.runAgent());

await bot.start();
```

</div>
<div class="agui-framework-panel" data-framework-panel="slack" markdown="1" hidden>

<p class="agui-framework-panel-title">Slack</p>

Use Slack when the user experience lives in a Slack app. Route the Slack thread
into the same AG-UI agent endpoint. The same AG-UI event stream can feed a
Slack harness and render A2UI through the surface's client bridge. CopilotKit's
Slack adapter already implements this pattern:

```ts
import { createBot } from "@copilotkit/bot";
import {
  slack,
  SanitizingHttpAgent,
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/bot-slack";

const bot = createBot({
  adapters: [
    slack({
      botToken: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
    }),
  ],
  agent: (threadId) => {
    const agent = new SanitizingHttpAgent({
      url: process.env.AGENT_RUN_URL!,
    });
    agent.threadId = threadId;
    return agent;
  },
  tools: [...defaultSlackTools, ...appTools],
  context: [...defaultSlackContext, ...appContext],
});

bot.onMention(({ thread }) => thread.runAgent());

await bot.start();
```

</div>
<div class="agui-framework-panel" data-framework-panel="teams" markdown="1" hidden>

<p class="agui-framework-panel-title">Teams</p>

Use Teams when the user experience lives in Microsoft Teams. Route the Teams
conversation into the same AG-UI agent endpoint. The same AG-UI event stream
can feed a Teams harness and render A2UI through the surface's client bridge.
Use `@copilotkit/bot-teams` to receive Teams activities, render Adaptive Cards,
stream updates, and optionally run local DevTools.

```ts
import { CopilotKitCore, ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import { createTeamsAgentBot } from "@copilotkit/bot-teams/bot";

const agentId = "assistant";
const runtimeUrl = process.env.COPILOTKIT_RUNTIME_URL!;

const core = new CopilotKitCore({ runtimeUrl });
core.setDefaultThrottleMs(1000);
core.addAgent__unsafe_dev_only({
  id: agentId,
  agent: new ProxiedCopilotRuntimeAgent({
    agentId,
    runtimeAgentId: agentId,
    runtimeUrl,
  }),
});

const bot = createTeamsAgentBot({
  core,
  agentId,
  approvalTimeoutMs: 5 * 60 * 1000,
  reviewerName: "Reviewer",
});

await bot.start(Number(process.env.PORT ?? 3978));
```

</div>
</div>

<script>
  (function () {
    function initAguiFrameworkSelector(root) {
      var select = root.querySelector("#agui-framework-select");
      var panelsRoot = root.querySelector("#agui-framework-panels");
      var panels = root.querySelectorAll("[data-framework-panel]");
      var storageKey = "agui-framework:" + window.location.pathname;

      if (!select || !panels.length) {
        return;
      }

      function hasOption(value) {
        return Array.prototype.some.call(select.options, function (option) {
          return option.value === value;
        });
      }

      function readFramework() {
        try {
          var stored = window.sessionStorage.getItem(storageKey);
          if (stored && hasOption(stored)) {
            return stored;
          }
        } catch (error) {
          // Ignore storage failures; the selector still works for the session.
        }
        return select.value;
      }

      function writeFramework(value) {
        try {
          window.sessionStorage.setItem(storageKey, value);
        } catch (error) {
          // Ignore storage failures; the selector still works for the session.
        }
      }

      function clearSetupHash() {
        if (
          window.location.hash !== "#2-set-up-your-agent-or-harness" ||
          !window.history ||
          !window.history.replaceState
        ) {
          return;
        }
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search,
        );
      }

      function showFramework(value) {
        select.value = value;
        panels.forEach(function (panel) {
          panel.hidden = panel.getAttribute("data-framework-panel") !== value;
        });
        if (panelsRoot) {
          panelsRoot.setAttribute("data-agui-framework-ready", "");
        }
      }

      if (!select.getAttribute("data-agui-framework-initialized")) {
        select.setAttribute("data-agui-framework-initialized", "true");
        select.addEventListener("change", function () {
          writeFramework(select.value);
          showFramework(select.value);
          clearSetupHash();
        });
      }
      showFramework(readFramework());
    }

    if (window.document$ && typeof window.document$.subscribe === "function") {
      window.document$.subscribe(function () {
        initAguiFrameworkSelector(document);
      });
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        initAguiFrameworkSelector(document);
      });
    }
  })();
</script>

These snippets establish the AG-UI server connection. Google Chat, Slack, and
Teams use the same AG-UI/A2UI contract through their own harnesses and client
bridges. The next sections turn on A2UI rendering, catalogs, and component
definitions inside the app surface.

## 3. Enable A2UI

### Backend

Turn on A2UI in `CopilotRuntime`. For dynamic-schema flows, inject the
`render_a2ui` tool so your agent can produce A2UI surfaces:

```ts title="app/api/copilotkit/route.ts"
import {CopilotRuntime} from '@copilotkit/runtime';

const runtime = new CopilotRuntime({
  agents: {default: myAgent},
  a2ui: {injectA2UITool: true},
});
```

Scope to specific agents with `a2ui: { injectA2UITool: true, agents: ["my-agent"] }`.
For fixed-schema flows where your agent already returns `a2ui_operations`,
`a2ui: true` or `a2ui: {}` is enough.

### Frontend

The A2UI renderer activates automatically. This guide uses React/Next.js
snippets; CopilotKit also supports A2UI through additional app surfaces,
including Vue, Angular, and React Native/headless clients. Optionally pass
a theme:

{% raw %}

```tsx
import {CopilotKitProvider} from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import {myCustomTheme} from '@copilotkit/a2ui-renderer';

<CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{theme: myCustomTheme}}>
  {children}
</CopilotKitProvider>;
```

{% endraw %}

### Custom components (BYOC)

A2UI ships with a built-in catalog (Text, Image, Card, …) that gets you a
working surface immediately. The real power is extending it with _your_
React components from your design system and data shapes, so the agent
can compose interfaces from primitives you already trust. A catalog has
three pieces:

1. **Definitions**: Zod schemas plus a natural-language description. This
   is what the agent sees in its system prompt. Note that for client-side functions, the client determines the function's execution boundary (such as clientOnly status) at runtime by reading its configuration from the active catalog definition.
2. **Renderers**: Typed React components, one per definition. This is
   what the user sees.
3. **Registration**: Pass the catalog through the provider so the A2UI
   renderer knows how to draw your components.

#### 1. Define component schemas

Create platform-agnostic definitions with Zod. The `description` field
gets injected into the agent's prompt so the LLM knows when to reach for
each component; the schema validates the props the agent sends.

```ts title="lib/a2ui/definitions.ts"
import {z} from 'zod';

export const myDefinitions = {
  StatusBadge: {
    description: 'A colored status badge.',
    props: z.object({
      text: z.string(),
      variant: z.enum(['success', 'warning', 'error']).optional(),
    }),
  },
  Metric: {
    description: 'A key metric with label and value.',
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(['up', 'down']).optional(),
    }),
  },
};

export type MyDefinitions = typeof myDefinitions;
```

#### 2. Create React renderers

Map each definition to a React component. `createCatalog` is generic over
the definitions type, so the props your renderer receives are type-checked
against the Zod schema, so a typo in `props.text` is a compile error.

{% raw %}

```tsx title="lib/a2ui/renderers.tsx"
'use client';

import {createCatalog, type CatalogRenderers} from '@copilotkit/a2ui-renderer';
import {myDefinitions, type MyDefinitions} from './definitions';

const myRenderers: CatalogRenderers<MyDefinitions> = {
  StatusBadge: ({props}) => {
    const colors = {
      success: {bg: '#dcfce7', text: '#166534'},
      warning: {bg: '#fef3c7', text: '#92400e'},
      error: {bg: '#fee2e2', text: '#991b1b'},
    };
    const c = colors[props.variant ?? 'success'];
    return (
      <span
        style={{
          padding: '2px 8px',
          borderRadius: 9999,
          fontSize: '0.75rem',
          background: c.bg,
          color: c.text,
        }}
      >
        {props.text}
      </span>
    );
  },

  Metric: ({props}) => (
    <div>
      <div style={{fontSize: '0.75rem', color: '#6b7280'}}>{props.label}</div>
      <div style={{fontSize: '1.5rem', fontWeight: 700}}>
        {props.value} {props.trend === 'up' ? '↑' : props.trend === 'down' ? '↓' : ''}
      </div>
    </div>
  ),
};

export const myCatalog = createCatalog(myDefinitions, myRenderers, {
  catalogId: 'my-app-catalog',
  includeBasicCatalog: true, // merges with built-in components
});
```

{% endraw %}

`catalogId` is the stable handle the agent uses to target this catalog;
`includeBasicCatalog: true` keeps the built-in components available
alongside your own (omit it to render _only_ your components).

#### 3. Pass the catalog to CopilotKit

{% raw %}

```tsx title="app/layout.tsx"
'use client';

import {CopilotKitProvider} from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import {myCatalog} from '@/lib/a2ui/renderers';

export default function Layout({children}: {children: React.ReactNode}) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" a2ui={{catalog: myCatalog}}>
      {children}
    </CopilotKitProvider>
  );
}
```

{% endraw %}

Agents will now see your custom components alongside the built-ins and
can use them in any A2UI surface they emit.

For the full BYOC reference (multiple catalogs, theming hooks, advanced
patterns), see CopilotKit's
[Custom Components (BYOC) section](https://docs.copilotkit.ai/generative-ui/a2ui).

## 4. Advanced usage

For the full A2UI integration surface (custom catalogs, fine-grained control,
advanced patterns), see CopilotKit's
[A2UI docs](https://docs.copilotkit.ai/generative-ui/a2ui).

## What's next

- **[A2UI Composer](https://a2ui-composer.ag-ui.com/)**: Build widgets visually.
- **[Concepts › Transports](../concepts/transports.md)**: How A2UI maps onto AG-UI.
- **[v0.9 specification](../specification/v0.9-a2ui.md)**: The underlying protocol.
