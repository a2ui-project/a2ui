# Authoring Custom Components

!!! tip "Authoring components for multiple frameworks?"

    See [Authoring Universal Components](authoring-universal-components.md) to learn how to write a single W3C Custom Element that works directly across Lit, React, and Angular renderers.

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

In the [`rizzcharts`](../../../samples/community/agent/adk/rizzcharts/python/README.md) example, the catalog schema is defined in [`rizzcharts_catalog_definition.json`](../../../samples/community/agent/adk/rizzcharts/catalog_schemas/0.9/rizzcharts_catalog_definition.json).

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

Implement your component using your client-side framework. For Angular, your component should extend `CatalogComponent` provided by `@a2ui/angular/v0_9`.

In the `rizzcharts` example, the `Chart` component is defined in `chart.ts`.

First, define the component API in TypeScript. This should match the JSON Schema defined in Step 1.

```typescript
// api.ts
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

export const ChartApi = {
  name: 'Chart',
  schema: z.object({
    type: z.enum(['doughnut', 'pie']),
    title: z.string().optional(),
    chartData: z.array(
      z.object({
        label: z.string(),
        value: z.number(),
        drillDown: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
          })
        ).optional(),
      })
    ),
  }).strict(),
} satisfies ComponentApi;
```

Now implement the Angular component:

```typescript
import {CatalogComponent} from '@a2ui/angular/v0_9';
import {Component, computed} from '@angular/core';
import {BaseChartDirective} from 'ng2-charts';
import {ChartApi} from './api';

@Component({
  selector: 'a2ui-chart',
  imports: [BaseChartDirective],
  template: `
    <div>
      <h2>{{ title() }}</h2>
      <canvas baseChart [data]="chartData()" [type]="chartType()"></canvas>
    </div>
  `,
})
export class Chart extends CatalogComponent<typeof ChartApi> {
  protected readonly chartType = computed(() => this.props()['type']?.value() || 'pie');
  protected readonly title = computed(() => this.props()['title']?.value() || '');
  protected readonly chartData = computed(() => {
    const rawData = this.props()['chartData']?.value() || [];
    return {
      labels: rawData.map(item => item.label),
      datasets: [
        {
          data: rawData.map(item => item.value),
        },
      ],
    };
  });
}
```

Keep these key points in mind when implementing components:

- **Extend `CatalogComponent`**: This gives you access to the type-safe `props` signal input.
- **Use `props()` Signal**: Access resolved properties reactively via `this.props()['propertyName']?.value()`. The framework automatically handles resolving data bindings and expressions.

---

## 3. Registering with the Renderer (Client)

Once the component is implemented, register it in your client catalog. This maps the component name (used by agents) to the implementation class.

You use the `AngularCatalog` class to define your catalog.

```typescript
import {AngularCatalog, BASIC_COMPONENTS, BASIC_FUNCTIONS} from '@a2ui/angular/v0_9';
import {Chart} from './chart';
import {ChartApi} from './api';

const customChartComponent = {
  ...ChartApi,
  component: Chart
};

export const RIZZ_CHARTS_CATALOG = new AngularCatalog(
  'https://github.com/.../rizzcharts_catalog_definition.json',
  [...BASIC_COMPONENTS, customChartComponent],
  BASIC_FUNCTIONS
);
```

Key points for registration:

- **Eager Registration**: Component classes are registered directly in the catalog definition.

---

## 4. Invoking from the Agent

To use the custom component, you initialize the agent with tools from the A2UI SDK that understand your catalog. The SDK handles resolving the catalog and providing examples to the model.

Here is how the flow wires up:

### 4.1 Session Preparation (Executor)

The execution layer (e.g., `RizzchartsAgentExecutor`) intercepts the incoming message to detect if A2UI is enabled and what catalogs the client supports. It negotiates an `A2uiRequestProcessor` for the client's capabilities and puts it in an `A2uiProcessorStore`, keyed by the session ID. The processor stays out of ADK's session state, which the persistent session services save as JSON.

```python
# In agent_executor.py
from a2ui.a2a import try_activate_a2ui_extension
from a2ui.adk import A2uiProcessorStore
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY

processors = A2uiProcessorStore()

processor = None
active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)
if active_ui_version:
    capabilities = (context.message.metadata or {}).get(A2UI_CLIENT_CAPABILITIES_KEY)
    processor = self._agent.create_processor(active_ui_version, capabilities)

# A request without A2UI clears the processor of an earlier one.
processors.set(session.id, processor)
```

### 4.2 Agent Tool Setup

The Agent uses [SendA2uiToClientToolset](../../../python/a2ui_adk/src/a2ui/adk/send_a2ui_to_client_toolset.py) to give the agent a tool that it can use to send A2UI to the client. Pass the store's provider, or pass one processor directly when the catalogs do not vary per request.

```python
from a2ui.adk import SendA2uiToClientToolset

agent.tools = [
    SendA2uiToClientToolset(
        a2ui_enabled=processors.is_enabled,
        a2ui_processor=processors.get,
    )
]
```

### 4.3 Tool Execution

Invocations of the tool in [SendA2uiToClientToolset](../../../python/a2ui_adk/src/a2ui/adk/send_a2ui_to_client_toolset.py) by the LLM are intercepted in the A2A Agent Executor using the [A2uiEventConverter](../../../python/a2ui_adk/src/a2ui/adk/a2a/event_converter.py). This automatically translates tool calls into A2A Dataparts with the A2UI payload. The converter gets the request's processor from the same store.

```python
from a2ui.adk import A2uiEventConverter

config = A2aAgentExecutorConfig(
    event_converter=A2uiEventConverter(a2ui_processor=processors.get)
)
```
