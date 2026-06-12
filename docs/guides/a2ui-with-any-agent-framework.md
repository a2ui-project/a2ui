# Use A2UI with Any Agent Framework (Using AG-UI)

A2UI is a declarative UI format. [AG-UI](https://ag-ui.com/) is the transport
that carries A2UI messages between an agent and an app. CopilotKit's
AG-UI implementation is the fastest path to putting A2UI in front of users
today. Any agent framework CopilotKit supports (ADK, LangGraph, CrewAI,
Mastra, custom Python/TS services, etc.) can emit A2UI and render it in a
supported app surface with no transport glue.

!!! info "Source of truth"

    This guide mirrors the key steps from CopilotKit's
    [A2UI docs](https://docs.copilotkit.ai/generative-ui/a2ui).
    For Google ADK-specific setup, see the
    [Google ADK + A2UI guide](https://docs.copilotkit.ai/google-adk/generative-ui/a2ui).
    Refer to the CopilotKit docs for the latest API surface.

## 1. Set up CopilotKit

Install CopilotKit into your app with the agent framework of your choice
(ADK, LangGraph, CrewAI, Mastra, etc.):

```bash
npx copilotkit@latest init
```

Or follow the [CopilotKit quickstart](https://docs.copilotkit.ai/quickstart)
to wire it into an existing project. This is the standard CopilotKit setup,
with no A2UI-specific scaffold.

## 2. Enable A2UI

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

## 3. Advanced usage

For the full A2UI integration surface (custom catalogs, fine-grained control,
advanced patterns), see CopilotKit's
[A2UI docs](https://docs.copilotkit.ai/generative-ui/a2ui).

## What's next

- **[A2UI Composer](https://a2ui-composer.ag-ui.com/)**: Build widgets visually.
- **[Concepts › Transports](../concepts/transports.md)**: How A2UI maps onto AG-UI.
- **[v0.9 specification](../specification/v0.9-a2ui.md)**: The underlying protocol.
