# Use A2UI with Any Agent Framework & Harness

A2UI is a declarative UI format. [AG-UI](https://ag-ui.com/) is the transport
that carries A2UI messages between an agent and an app. Use this guide to add
A2UI to an AG-UI app or harness backed by ADK, LangGraph, Mastra, Strands,
CrewAI, Google Chat, Slack, or any other agent framework or service that
supports AG-UI.

<style>
  .agui-demo-video {
    border-radius: 8px;
    display: block;
    margin: 24px auto;
    max-width: 100%;
    width: 75%;
  }

  @media (max-width: 700px) {
    .agui-demo-video {
      width: 100%;
    }
  }
</style>

<video class="agui-demo-video" controls playsinline preload="metadata">
  <source src="https://cdn.copilotkit.ai/docs/a2ui/ag-ui-a2ui-demo.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

The examples below use AG-UI-compatible runtime tooling so you can focus on
the A2UI surface: enabling the renderer, giving your agent a catalog, and
streaming UI updates back to the user. For protocol-level setup and concepts,
see the [AG-UI docs](https://docs.ag-ui.com/).

## Agent skills

If you are using a coding agent to wire this up, load the
[AG-UI `ag-ui-a2ui-integration` skill](https://github.com/ag-ui-protocol/ag-ui/tree/main/skills/ag-ui-a2ui-integration)
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
```

Strands has no scaffold flag yet — wrap an existing Strands agent (see the
Strands panels below).

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

=== "ADK"

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

=== "LangGraph (Python)"

    Use LangGraph when your agent workflow is a graph of stateful nodes. Start from
    your normal LangGraph agent — A2UI needs no extra tool wiring on the graph:

    ```python
    from copilotkit import CopilotKitMiddleware
    from langchain.agents import create_agent
    from langchain_google_genai import ChatGoogleGenerativeAI

    gemini = ChatGoogleGenerativeAI(
        model="gemini-2.5-pro",
        thinking_budget=1024,
    )

    # A plain LangGraph agent — no A2UI tool wiring on the graph. The CopilotKit
    # runtime forwards your frontend catalog and injects the `generate_a2ui` tool;
    # include CopilotKitMiddleware to get A2UI capability.
    graph = create_agent(
        model=gemini,
        tools=[],
        middleware=[CopilotKitMiddleware()],
        system_prompt="You are a helpful assistant.",
    )
    ```

    LangGraph's A2UI tool runs in the CopilotKit middleware layer, so include
    `CopilotKitMiddleware` to get A2UI capability. The CopilotKit runtime forwards
    your catalog and injects `generate_a2ui` automatically. The example uses Gemini
    via LangChain's Google GenAI integration.

    See the
    [AG-UI LangGraph integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/python)
    and the
    [ChatGoogleGenerativeAI integration](https://docs.langchain.com/oss/python/integrations/chat/google_generative_ai).

=== "LangGraph (FastAPI)"

    Use the FastAPI variant when you serve the same LangGraph graph behind a FastAPI
    app. The agent shape is identical — export the same `graph` and serve it through
    the AG-UI LangGraph endpoint:

    ```python
    from copilotkit import CopilotKitMiddleware
    from langchain.agents import create_agent
    from langchain_google_genai import ChatGoogleGenerativeAI

    gemini = ChatGoogleGenerativeAI(
        model="gemini-2.5-pro",
        thinking_budget=1024,
    )

    graph = create_agent(
        model=gemini,
        tools=[],
        middleware=[CopilotKitMiddleware()],
        system_prompt="You are a helpful assistant.",
    )
    ```

    See the
    [AG-UI LangGraph integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/python).

=== "LangGraph (TypeScript)"

    Use the TypeScript variant when your LangGraph agent is written in TypeScript.
    The shape mirrors the Python agent — a plain graph plus the CopilotKit
    middleware:

    ```ts
    import { createAgent } from "langchain";
    import { ChatOpenAI } from "@langchain/openai";
    import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";

    export const graph = createAgent({
      model: new ChatOpenAI({ model: "gpt-4o" }),
      tools: [],
      middleware: [copilotkitMiddleware],
      systemPrompt: "You are a helpful assistant.",
    });
    ```

    See the
    [AG-UI LangGraph TypeScript integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/typescript).

=== "Strands (Python)"

    Use Strands when your agent orchestration is built on AWS Strands. Wrap a plain
    Strands agent with the AG-UI Strands adapter:

    ```python
    from strands import Agent
    from ag_ui_strands import StrandsAgent

    strands_agent = Agent(
        system_prompt="You are a helpful assistant.",
    )

    agent = StrandsAgent(
        agent=strands_agent,
        name="my-agent",
        description="A Strands agent exposed via AG-UI",
    )
    ```

    See the
    [AG-UI AWS Strands integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/aws-strands/python).

=== "Strands (TypeScript)"

    Use the TypeScript variant when your Strands agent is written in TypeScript. The
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

=== "Slack"

    Use Slack when the user experience lives in a Slack app. Route the Slack thread
    into the same AG-UI agent endpoint. The same AG-UI event stream can feed a
    Slack harness and render A2UI through the surface's client bridge.

    <video class="agui-demo-video" controls playsinline preload="metadata">
      <source src="https://cdn.copilotkit.ai/docs/a2ui/ag-ui-slack-demo.mp4" type="video/mp4">
      Your browser does not support the video tag.
    </video>

    CopilotKit's Slack adapter already implements this pattern:

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
          url: process.env.AGENT_URL!,
        });
        agent.threadId = threadId;
        return agent;
      },
      tools: [...defaultSlackTools],
      context: [...defaultSlackContext],
    });

    bot.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    await bot.start();
    ```

These snippets establish the AG-UI server connection. Slack uses the same
AG-UI/A2UI contract through its own harness and client bridge. The next
sections turn on A2UI rendering, catalogs, and component definitions inside the
app surface.

## 3. Enable A2UI

Start from the developer experience you want: define the catalog definitions the
agent can see, map each definition to a renderer, create the catalog, and pass
that catalog into CopilotKit. The frontend catalog config is the target A2UI
activation surface.

{% raw %}

```tsx
import {CopilotKit, CopilotChat} from '@copilotkit/react-core/v2';
import {
  createCatalog,
  type CatalogDefinitions,
  type CatalogRenderers,
} from '@copilotkit/a2ui-renderer';
import {z} from 'zod';

// catalog definitions — describe the building block components to the agent
export const catalogDefinitions = {
  Card: {
    description: 'A titled card container.',
    props: z.object({title: z.string(), subtitle: z.string().optional()}),
  },
  PrimaryButton: {
    description: 'A styled primary button.',
    props: z.object({label: z.string(), action: z.any().optional()}),
  },
} satisfies CatalogDefinitions;

// catalog renderers — how each primitive renders in the DOM (React, in this example)
export const catalogRenderers = {
  Card: MyCard,
  PrimaryButton: MyPrimaryButton,
} satisfies CatalogRenderers<typeof catalogDefinitions>;

// definitions + renderers together define a catalog declaration
const catalog = createCatalog(catalogDefinitions, catalogRenderers, {
  catalogId: 'my-catalog',
  includeBasicCatalog: true,
});

<CopilotKit runtimeUrl="/api/copilotkit" a2ui={{catalog}}>
  <CopilotChat />
</CopilotKit>;
```

{% endraw %}

Passing a catalog to the provider auto-enables A2UI and injects the
`generate_a2ui` tool, so your agent can produce surfaces with no extra runtime
config (CopilotKit ≥ 1.61.2). You can opt out, or opt in manually without a
catalog, by configuring the runtime directly:

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

### Custom components (BYOC)

A2UI ships with a built-in catalog (Text, Image, Card, …) that gets you a
working surface immediately. The expanded BYOC flow below shows the same
catalog pattern split across files for a real app:

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
