# CopilotKit

Use this guide to add A2UI to an agent built with ADK, LangGraph, Strands,
Mastra, CrewAI, or any other framework that supports
[AG-UI](https://docs.ag-ui.com/), and render it in your app with
[CopilotKit](https://www.copilotkit.ai/).

- **AG-UI** (Agent-User Interaction protocol) is the transport. It carries
  your agent's events, including A2UI messages, to the client as typed
  events. It also carries the user's actions back to the agent on the same
  stream.
- **CopilotKit** is the app layer built on AG-UI: a runtime that connects
  your agent to your app, chat components, and an A2UI renderer for React
  and Angular, built on the official
  [`@a2ui/web_core`](../guides/client-setup.md#shared-web-library).

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

## How it works

1. You register a catalog in your app: the components the agent may use, and
   how each one renders.
2. The CopilotKit runtime sends the catalog to the agent with each run and
   gives the agent a tool for generating A2UI. Your agent needs no A2UI
   configuration of its own.
3. The agent writes A2UI. AG-UI streams it to the app, and the A2UI renderer
   draws it with your components as it arrives.
4. When the user acts on a surface, the values go back to the agent on the
   same stream, and the agent can update the same surface.

Because these steps are in the AG-UI toolkit, every AG-UI-compatible
framework gets them. The toolkit also:

- **Generates UI in a sub-agent.** The catalog and the protocol rules stay
  out of your main agent's context, and the surface streams to the client
  while the sub-agent writes it.
- **Repairs invalid output.** If the generated UI is invalid, the errors go
  back to the sub-agent for a correction, so broken UI doesn't reach the
  screen. If retries run out, the surface shows a short message, and the
  conversation goes on.
- **Updates surfaces in place.** The agent writes to the same `surfaceId`,
  so a form can turn into a confirmation without a second card.

## Agent skills

If you use a coding agent to set this up, load the
[AG-UI `ag-ui-a2ui-integration` skill](https://github.com/ag-ui-protocol/ag-ui/tree/main/skills/ag-ui-a2ui-integration)
first. It covers the framework adapters, the scaffold flags, transport setup,
and the A2UI runtime and renderer wiring. Also load the
[CopilotKit skill](https://github.com/CopilotKit/CopilotKit/blob/main/skills/copilotkit/SKILL.md)
for the CopilotKit runtime, provider, and catalog conventions.

## 1. Create an app

Scaffold an AG-UI app with CopilotKit for the framework you use:

```bash
npx create-ag-ui-app@latest
```

Or start directly from a framework template:

```bash
npx create-ag-ui-app@latest --adk
npx create-ag-ui-app@latest --langgraph-py
npx create-ag-ui-app@latest --langgraph-js
```

`create-ag-ui-app` also has `--mastra`, `--crewai-flows`, `--pydantic-ai`,
`--llamaindex`, `--agno`, and `--ag2`. It runs the CopilotKit CLI, which also
has an A2UI starter:

```bash
npx copilotkit@latest create --name my-app --framework a2ui
```

The CopilotKit CLI connects the app to a CopilotKit account, and opens a
browser to sign in if needed.

To add CopilotKit to an app you already have, install the packages:

```bash
npm install @copilotkit/react-core @copilotkit/runtime @copilotkit/a2ui-renderer @ag-ui/client@1.0.2 zod@3
```

!!! note "Versions"

    Passing a catalog to the provider turns A2UI on by itself from CopilotKit
    1.61.2. The CopilotKit A2UI renderer uses zod 3, and `@copilotkit/runtime`
    1.79 expects `@ag-ui/client` 1.0.2. Newer versions of either fail to type
    check.

## 2. Serve your agent over AG-UI

Wrap the agent you already have with its framework's AG-UI adapter. A2UI
needs no extra tools on the agent: the runtime adds the A2UI tool when your
app registers a catalog.

=== "ADK"

    The [AG-UI ADK middleware](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/adk-middleware/python)
    serves an ADK agent as an AG-UI endpoint on FastAPI:

    ```bash
    pip install ag-ui-adk
    ```

    ```python
    from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
    from fastapi import FastAPI
    from google.adk.agents import LlmAgent

    root_agent = LlmAgent(
        name="flight_agent",
        model="gemini-3.8-flash",
        instruction="Help users find and book flights. Show results as UI.",
    )

    adk_agent = ADKAgent(
        adk_agent=root_agent,
        app_name="flights",
        user_id="demo_user",
    )

    app = FastAPI()
    add_adk_fastapi_endpoint(app, adk_agent, path="/")
    ```

    To serve an ADK agent over A2A instead, see [ADK](adk.md).

=== "LangGraph (Python)"

    Add `CopilotKitMiddleware` to your LangGraph agent, and serve it with the
    [AG-UI LangGraph integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/python):

    ```bash
    pip install copilotkit ag-ui-langgraph langchain langchain-google-genai
    ```

    ```python
    from ag_ui_langgraph import add_langgraph_fastapi_endpoint
    from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
    from fastapi import FastAPI
    from langchain.agents import create_agent
    from langchain_google_genai import ChatGoogleGenerativeAI

    graph = create_agent(
        model=ChatGoogleGenerativeAI(model="gemini-3.8-flash"),
        tools=[],
        middleware=[CopilotKitMiddleware()],
        system_prompt="You are a helpful assistant.",
    )

    app = FastAPI()
    add_langgraph_fastapi_endpoint(
        app=app,
        agent=LangGraphAGUIAgent(
            name="default",
            description="An A2UI-capable agent",
            graph=graph,
        ),
        path="/",
    )
    ```

    The A2UI tool runs in `CopilotKitMiddleware`, so the middleware is
    required. The example uses Gemini through LangChain's
    [Google GenAI integration](https://docs.langchain.com/oss/python/integrations/chat/google_generative_ai).

=== "LangGraph (TypeScript)"

    Add `copilotkitMiddleware` to your LangGraph agent. See the
    [AG-UI LangGraph TypeScript integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/typescript)
    to serve it.

    ```ts
    import {copilotkitMiddleware} from '@copilotkit/sdk-js/langgraph';
    import {ChatOpenAI} from '@langchain/openai';
    import {createAgent} from 'langchain';

    export const graph = createAgent({
      model: new ChatOpenAI({model: 'gpt-4o'}),
      tools: [],
      middleware: [copilotkitMiddleware],
      systemPrompt: 'You are a helpful assistant.',
    });
    ```

=== "Strands (Python)"

    Wrap a Strands agent with the
    [AG-UI Strands adapter](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/aws-strands/python)
    and serve it:

    ```bash
    pip install ag-ui-strands
    ```

    ```python
    from ag_ui_strands import StrandsAgent, create_strands_app
    from strands import Agent

    strands_agent = Agent(
        system_prompt="You are a helpful assistant.",
    )

    agent = StrandsAgent(
        agent=strands_agent,
        name="my-agent",
        description="A Strands agent exposed via AG-UI",
    )

    app = create_strands_app(agent, path="/", origins=["http://localhost:3000"])
    ```

=== "Strands (TypeScript)"

    Wrap a Strands agent with the
    [AG-UI Strands adapter](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/aws-strands/typescript)
    and serve it:

    ```ts
    import {StrandsAgent} from '@ag-ui/aws-strands';
    import {createStrandsApp} from '@ag-ui/aws-strands/server';
    import {Agent} from '@strands-agents/sdk';

    const strandsAgent = new Agent({
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
    });

    const aguiAgent = new StrandsAgent({
      agent: strandsAgent,
      name: 'MyAgent',
      description: 'A Strands agent exposed via AG-UI',
    });

    const app = await createStrandsApp(aguiAgent, {path: '/invocations'});
    app.listen(8000);
    ```

Other frameworks, such as Mastra, CrewAI, Pydantic AI, LlamaIndex, Agno, and
AG2, have AG-UI adapters too. See the [AG-UI docs](https://docs.ag-ui.com/).

## 3. Connect the runtime

The CopilotKit runtime runs in your app's backend and connects the app to the
agent's AG-UI endpoint. In a Next.js app, add a route:

```ts title="app/api/copilotkit/route.ts"
import {HttpAgent} from '@ag-ui/client';
import {CopilotRuntime, createCopilotRuntimeHandler} from '@copilotkit/runtime/v2';

const agent = new HttpAgent({url: process.env.AGENT_URL ?? 'http://localhost:8000/'});

const runtime = new CopilotRuntime({
  agents: {default: agent},
});

export const POST = createCopilotRuntimeHandler({
  runtime,
  basePath: '/api/copilotkit',
  mode: 'single-route',
});
```

## 4. Register your catalog

A2UI turns on in the client, where your components are. Define the
components the agent may use, map each one to a renderer, and pass the
catalog to the CopilotKit provider.

```tsx
import {CopilotChat, CopilotKit} from '@copilotkit/react-core/v2';
import {
  createCatalog,
  type CatalogDefinitions,
  type CatalogRenderers,
} from '@copilotkit/a2ui-renderer';
import {z} from 'zod';

const catalogDefinitions = {
  FlightCard: {
    description: 'A flight result with airline, times, and stops.',
    props: z.object({
      airline: z.string(),
      departs: z.string(),
      arrives: z.string(),
      stops: z.number(),
    }),
  },
} satisfies CatalogDefinitions;

const catalogRenderers = {
  FlightCard: MyFlightCard, // Your React component.
} satisfies CatalogRenderers<typeof catalogDefinitions>;

const catalog = createCatalog(catalogDefinitions, catalogRenderers, {
  catalogId: 'flight-catalog',
  includeBasicCatalog: true,
});

export function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" a2ui={{catalog}}>
      <CopilotChat />
    </CopilotKit>
  );
}
```

- The `description` goes into the agent's prompt, so the model knows when to
  use `FlightCard` instead of a generic card.
- The zod schema validates the props that the agent sends.
- `includeBasicCatalog: true` keeps the
  [Basic Catalog](../reference/components.md) components available next to
  yours. Leave it out to allow only your components.

The runtime forwards the catalog to the agent with each run and adds the
A2UI tool, so the agent can produce surfaces with no runtime configuration.

### Runtime options

To control A2UI from the runtime instead, pass `a2ui` to `CopilotRuntime`:

```ts
// Turn A2UI on without a catalog in the provider.
new CopilotRuntime({agents: {default: agent}, a2ui: {injectA2UITool: true}});

// Turn it on for some agents only. The names are keys of `agents`.
new CopilotRuntime({agents: {default: agent}, a2ui: {injectA2UITool: true, agents: ['default']}});

// Fixed schema: the agent returns its own A2UI operations.
new CopilotRuntime({agents: {default: agent}, a2ui: {}});

// Turn A2UI off.
new CopilotRuntime({agents: {default: agent}, a2ui: {enabled: false}});
```

### Dynamic and fixed schemas

The example above uses a **dynamic schema**: the agent composes a new surface
for each request from your catalog. You can also define a surface ahead of
time, a **fixed schema**, and have the agent stream only the data at run
time. See CopilotKit's [A2UI docs](https://docs.copilotkit.ai/generative-ui/a2ui)
for both.

### Split the catalog across files

In a real app, keep the definitions, the renderers, and the provider in
separate files. The definitions don't depend on React, so you can share them
with other code.

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

`createCatalog` checks the renderers against the definitions, so a typo such
as `props.txt` is a compile error:

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
  includeBasicCatalog: true,
});
```

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

For multiple catalogs, theming, and other options, see CopilotKit's
[A2UI docs](https://docs.copilotkit.ai/generative-ui/a2ui).

## 5. Build multi-step flows

A2UI surfaces are two-way. When the user picks a date, chooses a flight, or
fills in a form, the values go back to the agent on the same AG-UI stream,
and the agent updates the surface from there. A whole booking flow (search,
results, passenger details, and confirmation) can live on one surface.

Two things make the round trip work: inputs bound to a path in the data
model, and a button whose action names the paths to send back.

```json
[
  {
    "id": "flights",
    "component": "ChoicePicker",
    "label": "Available flights",
    "variant": "mutuallyExclusive",
    "options": [
      {"label": "UA 100 · 08:05", "value": "UA100"},
      {"label": "DL 200 · 12:40", "value": "DL200"}
    ],
    "value": {"path": "/selectedFlight"}
  },
  {"id": "book_label", "component": "Text", "text": "Book flight"},
  {
    "id": "book",
    "component": "Button",
    "variant": "primary",
    "child": "book_label",
    "action": {
      "event": {
        "name": "book_flight",
        "context": {"flight": {"path": "/selectedFlight"}}
      }
    }
  }
]
```

Validation, such as checking an email address, runs in the client, so an
error shows at once without a model call. Nothing goes to the agent until the
button fires. Then the client sends the bound values, and the agent writes to
the same `surfaceId`. See [Data Binding](../concepts/data-binding.md) and
[Actions](../concepts/actions.md).

## Other clients

- **Without CopilotKit:** read the AG-UI event stream with `@ag-ui/client`
  and pass the A2UI operations to an official renderer, such as
  [`@a2ui/react`](../guides/client-setup.md#react), Lit, Angular, or Flutter.
  The [AG-UI A2UI skill](https://github.com/ag-ui-protocol/ag-ui/tree/main/skills/ag-ui-a2ui-integration)
  shows the wiring.
- **Other surfaces:** CopilotKit also has A2UI renderers for Vue, and
  harnesses such as Slack that reuse the same AG-UI agent endpoint. See
  CopilotKit's [A2UI docs](https://docs.copilotkit.ai/generative-ui/a2ui).

<video class="agui-demo-video" controls playsinline preload="metadata">
  <source src="https://cdn.copilotkit.ai/docs/a2ui/ag-ui-slack-demo.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

## Try it

- **[AG-UI Dojo](https://dojo.ag-ui.com/)**: Runnable A2UI demos for each
  framework: a fixed schema, a dynamic schema with a custom catalog, and
  recovery from an invalid first render.
- **[A2UI Composer](https://a2ui-composer.ag-ui.com/)**: Build widgets
  visually.
- **[CopilotKit ADK quickstart](https://docs.copilotkit.ai/google-adk/quickstart)**:
  Set up CopilotKit with an ADK agent step by step.

## Next steps

- **[Transports](../concepts/transports.md)**: How A2UI maps onto AG-UI.
- **[Defining Your Own Catalog](../guides/defining-your-own-catalog.md)**:
  Design a catalog for your app.
- **[v0.9.1 specification](../specification/v0.9.1-a2ui.md)**: The
  underlying protocol.
