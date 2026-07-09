# Authoring Custom Components

Learn how to define, implement, and register custom components in A2UI using the `rizzcharts` sample as an example. This guide focuses on authoring a component around your Angular code.

## Overview

Authoring a new component involves four main steps:

1.  **Define the Catalog Schema**: Specify the component's properties and types in a JSON Schema.
2.  **Define the Component (Client)**: Implement the UI using your framework (e.g., Angular).
3.  **Register with the Renderer (Client)**: Add the component to your client-side catalog.
4.  **Invoke from the Agent**: Instruct the agent to use the component via `send_a2ui_json_to_client`.

---

## 1. Defining the Catalog Schema

The catalog schema defines the API of your catalog. It lists available components and their properties, which the agent uses to construct UI payloads.

**This schema acts as a contract between the client and the server (agent).** Both must agree on this schema for rendering to work. The client advertises what catalogs it supports, and the server selects a compatible one. For details on how this handshake works, see [A2UI Catalog Negotiation](../concepts/catalogs.md#a2ui-catalog-negotiation).

In the [`rizzcharts`](../../samples/community/agent/adk/rizzcharts/python/README.md) example, the catalog schema is defined in [`rizzcharts_catalog_definition.json`](../../samples/community/agent/adk/rizzcharts/catalog_schemas/0.9/rizzcharts_catalog_definition.json).

Here is the schema for the `Chart` component:

```json
"Chart": {
  "type": "object",
  "description": "An interactive chart that uses a hierarchical list of objects for its data.",
  "properties": {
    "type": {
      "type": "string",
      "description": "The type of chart to render.",
      "enum": [
        "doughnut",
        "pie"
      ]
    },
    "title": {
      "type": "object",
      "description": "The title of the chart. Can be a literal string or a data model path.",
      "properties": {
        "literalString": {
          "type": "string"
        },
        "path": {
          "type": "string"
        }
      }
    },
    "chartData": {
      "type": "object",
      "description": "The data for the chart, provided as a list of items. Can be a literal array or a data model path.",
      "properties": {
        "literalArray": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "label": {
                "type": "string"
              },
              "value": {
                "type": "number"
              },
              "drillDown": {
                "type": "array",
                "description": "An optional list of items for the next level of data.",
                "items": {
                  "type": "object",
                  "properties": {
                    "label": {
                      "type": "string"
                    },
                    "value": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "label",
                    "value"
                  ]
                }
              }
            },
            "required": [
              "label",
              "value"
            ]
          }
        },
        "path": {
          "type": "string"
        }
      }
    }
  },
  "required": [
    "type",
    "chartData"
  ]
}
```

---

## 2. Implementing the Component (Client)

Implement your component using your client-side framework. For Angular, your component should extend `DynamicComponent` provided by `@a2ui/angular`.

In the [`orchestrator`](../../samples/community/client/angular/projects/orchestrator/README.md) example, the `Chart` component is defined in [`chart.ts`](../../samples/community/client/angular/projects/orchestrator/src/a2ui-catalog/chart.ts).

{% raw %}

```typescript
import {DynamicComponent} from '@a2ui/angular';
import * as Primitives from '@a2ui/web_core/types/primitives';
import * as Types from '@a2ui/web_core/types/types';
import {Component, computed, input, Signal, signal} from '@angular/core';

@Component({
  selector: 'a2ui-chart',
  template: `
    <div>
      <h2>{{ resolvedTitle() }}</h2>
      <canvas baseChart [data]="currentData()" [type]="chartType()"></canvas>
    </div>
  `,
})
export class Chart extends DynamicComponent<Types.CustomNode> {
  readonly type = input.required<string>();
  protected readonly chartType = computed(() => this.type() as ChartType);

  readonly title = input<Primitives.StringValue | null>();
  protected readonly resolvedTitle = computed(() => super.resolvePrimitive(this.title() ?? null));

  readonly chartData = input.required<Primitives.StringValue | null>();
  // ... data resolution logic using super.resolvePrimitive for data paths
}
```

{% endraw %}

Keep these key points in mind when implementing components:

- **Extend `DynamicComponent`**: This gives you access to `resolvePrimitive` for data binding resolution.
- **Use Angular Inputs**: Map properties from the schema to Angular inputs.

---

## 3. Registering with the Renderers (Client)

Register the component with your renderer so that A2UI can instantiate it when the agent sends a payload referencing it. The steps differ by renderer.

### Angular renderer

Once the component is implemented, register it in your client catalog. This maps the component name (used by agents) to the implementation class.

In the [`orchestrator`](../../samples/community/client/angular/projects/orchestrator/README.md) example, this is done in [`catalog.ts`](../../samples/community/client/angular/projects/orchestrator/src/a2ui-catalog/catalog.ts).

```typescript
import {Catalog, DEFAULT_CATALOG} from '@a2ui/angular';
import {inputBinding} from '@angular/core';

export const RIZZ_CHARTS_CATALOG = {
  ...DEFAULT_CATALOG,
  Chart: {
    type: () => import('./chart').then(r => r.Chart),
    bindings: ({properties}) => [
      inputBinding('type', () => ('type' in properties && properties['type']) || undefined),
      inputBinding('title', () => ('title' in properties && properties['title']) || undefined),
      inputBinding(
        'chartData',
        () => ('chartData' in properties && properties['chartData']) || undefined,
      ),
    ],
  },
} as Catalog;
```

Key points for registration:

- **Lazy Loading**: Use `import()` to lazy-load the component code.
- **Input Bindings**: Use `inputBinding` to map properties from the schema to Angular inputs.

### Lit v0.9 (recommended)

With `@a2ui/lit/v0_9`, catalog registration is handled at the protocol level. Define a `Catalog` object with your components and pass it to the `MessageProcessor`. When the agent sends a `createSurface` message with a matching `catalogId`, the processor automatically resolves and binds your catalog — no client-side flags required.

```typescript
import {z} from 'zod';
import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import type {LitComponentApi} from '@a2ui/lit/v0_9';

// 1. Define your component's API using a Zod schema
const MyChartApi = {
  name: 'MyChart',
  tagName: 'my-chart',   // your custom element tag
  schema: z.object({
    title: z.string().optional(),
    data: z.array(z.object({label: z.string(), value: z.number()})),
  }),
} satisfies LitComponentApi;

// 2. Create a named catalog containing your component(s)
const myCatalog = new Catalog<LitComponentApi>(
  'mycompany.com:my-catalog',  // must match what the agent sends in createSurface.catalogId
  [MyChartApi],
);

// 3. Register it with the MessageProcessor alongside any other catalogs you support
const processor = new MessageProcessor<LitComponentApi>([basicCatalog, myCatalog]);
```

The agent then selects your catalog by referencing its ID in the `createSurface` message:

```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "main",
    "catalogId": "mycompany.com:my-catalog"
  }
}
```

The `A2uiSurface` element in v0.9 receives a fully-resolved `SurfaceModel` (with catalog already bound), so custom components render automatically alongside standard ones.

### Lit v0.8 (legacy)

When using the `@a2ui/lit` renderer with the v0.8 protocol, register your custom components via the `componentRegistry`, then opt in on the `<a2ui-surface>` element by setting `enableCustomElements = true`.

```typescript
import {v0_8 as a2uiModule} from '@a2ui/lit';

// Register custom components in the component registry
// MyChartElement is your Lit component class (extends LitElement)
a2uiModule.componentRegistry.register('MyChart', MyChartElement);
```

Then set `enableCustomElements = true` on the surface element **before** assigning `surface` and `processor`, so the flag is active on the first render pass:

```typescript
const surfaceElement = document.querySelector('a2ui-surface');

surfaceElement.enableCustomElements = true;  // must come first
surfaceElement.surfaceId = 'main';
surfaceElement.surface = surface;       // the SurfaceModel instance
surfaceElement.processor = processor;  // the A2uiMessageProcessor instance
```

> **Note:** Without `enableCustomElements = true`, custom components will not render even if they are properly registered, because the flag defaults to `false`.

---

## 4. Invoking from the Agent

To use the custom component, you initialize the agent with tools from the A2UI SDK that understand your catalog. The SDK handles resolving the catalog and providing examples to the model.

Here is how the flow wires up:

### 4.1 Session Preparation (Executor)

The execution layer (e.g., `RizzchartsAgentExecutor`) intercepts the incoming message to detect if A2UI is enabled and what catalogs the client supports. It resolves the catalog and saves it to the session state.

```python
# In agent_executor.py

use_ui = try_activate_a2ui_extension(context)
if use_ui:
    # Resolve catalog based on client capabilities
    a2ui_catalog = self.schema_manager.get_selected_catalog(
        client_ui_capabilities=capabilities
    )
    examples = self.schema_manager.load_examples(a2ui_catalog, validate=True)

    # Save to session (Event contains state_delta)
    await runner.session_service.append_event(
        session,
        Event(
            actions=EventActions(
                state_delta={
                    _A2UI_ENABLED_KEY: True,
                    _A2UI_CATALOG_KEY: a2ui_catalog,
                    _A2UI_EXAMPLES_KEY: examples,
                }
            ),
        ),
    )
```

### 4.2 Agent Tool Setup

The Agent uses [SendA2uiToClientToolset](../../agent_sdks/python/a2ui_agent/src/a2ui/adk/send_a2ui_to_client_toolset.py) to give the agent a tool that it can use to send A2UI to the client.

```python
from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset

a2ui_catalog = self.schema_manager.get_selected_catalog(
    client_ui_capabilities=capabilities
)
agent.tools = [
    SendA2uiToClientToolset(
        a2ui_catalog=a2ui_catalog,
        a2ui_enabled=True,
    )
]
```

### 4.3 Tool Execution

Invocations of the tool in [SendA2uiToClientToolset](../../agent_sdks/python/a2ui_agent/src/a2ui/adk/send_a2ui_to_client_toolset.py) by the LLM are intercepted in the A2A Agent Executor using the [A2uiEventConverter](../../agent_sdks/python/a2ui_agent/src/a2ui/adk/a2a/event_converter.py). This automatically translates tool calls into A2A Dataparts with the A2UI payload.

```python
from a2ui.adk.a2a.event_converter import (
    A2uiEventConverter,
)

config = A2aAgentExecutorConfig(event_converter=A2uiEventConverter())
```
