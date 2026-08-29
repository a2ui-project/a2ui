# A2UI Catalogs

## Overview

This guide defines the A2UI Catalog architecture and provides a roadmap for implementation. It explains the structure of catalog schemas, outlines strategies for using the pre-built "Basic Catalog” versus defining your own application-specific catalog, and details the technical protocols for catalog negotiation, versioning, and runtime validation.

## Catalog Schema

A catalog schema is a [JSON Schema file](../../../specification/v0_9/json/client_capabilities.json#L62C5-L95C6) outlining the components, functions, and themes that agents can use to define A2UI surfaces using server-driven UI. All A2UI JSON sent from the agent is validated against the chosen catalog.

[Catalog JSON Schema](../../../specification/v0_9/json/client_capabilities.json#L62C5-L95C6) is below

```json
{
  "Catalog": {
    "type": "object",
    "description": "A collection of component and function definitions.",
    "properties": {
      "catalogId": {
        "type": "string",
        "description": "Unique identifier for this catalog."
      },
      "components": {
        "type": "object",
        "description": "Definitions for UI components supported by this catalog.",
        "additionalProperties": {
          "$ref": "https://json-schema.org/draft/2020-12/schema"
        }
      },
      "functions": {
        "type": "array",
        "description": "Definitions for functions supported by this catalog.",
        "items": {
          "$ref": "#/$defs/FunctionDefinition"
        }
      },
      "theme": {
        "title": "A2UI Theme",
        "description": "A schema that defines a catalog of A2UI theme properties.",
        "type": "object",
        "additionalProperties": {
          "$ref": "https://json-schema.org/draft/2020-12/schema"
        }
      }
    },
    "required": ["catalogId"],
    "additionalProperties": false
  }
}
```

## Catalog Strategy

Every A2UI surface is driven by a Catalog. A catalog is simply a JSON Schema file that tells the agent which components, functions, and themes are available for it to use.

Whether you are building a simple prototype or a complex production application, the requirement is the same: you must provide a catalog definition that the agent uses to express UI.

### The Basic Catalog

To help developers get started quickly, the A2UI team maintains the [Basic Catalog](../../../specification/v0_9/catalogs/basic/catalog.json).

This is a pre-defined catalog file that contains a basic set of general-purpose components (Buttons, Inputs, Cards) and functions. It is not a special "type" of catalog; it is simply a version of a catalog that we have already written and have open source renderers for.

The basic catalog allows you to bootstrap an application or validate A2UI concepts without needing to write your own schema from scratch. It is intentionally sparse to remain easily implementable by different renderers.

Since A2UI is designed for LLMs to generate the UI at either design time or runtime, we do not think portability requires a standardized catalog across multiple clients; the LLM can interpret the catalog for each individual frontend.

[See the A2UI v0.9 basic catalog](../../../specification/v0_9/catalogs/basic/catalog.json)

### Defining Your Own Catalog

While the Basic Catalog is useful for starting out, most production applications will define their own catalog to reflect their specific design system.

By defining your own catalog, you restrict the agent to using exactly the components and visual language that exist in your application, rather than generic inputs or buttons. This catalog can be built entirely from scratch, or it can import definitions from the Basic Catalog to save time (e.g., using the Basic text definitions while defining your own unique Card component).

For simplicity we recommend building catalogs that directly reflect a client's design system rather than trying to map the Basic Catalog to it through an adapter. Since A2UI is designed for GenUI, we expect the LLM can interpret different catalogs for different clients.

[See an example Rizzcharts catalog](../../../samples/community/agent/adk/rizzcharts/catalog_schemas/0.9/rizzcharts_catalog_definition.json)

### Recommendations

| Usecase                             | Recommendation                                                                 | Effort                         |
| :---------------------------------- | :----------------------------------------------------------------------------- | :----------------------------- |
| Adding A2UI to a mature frontend    | Define a catalog that mirrors your existing design system.                     | Medium                         |
| Adding A2UI to a new/greenfield app | Start with Basic Catalog, then evolve into your own catalog as the app evolves | Low (assuming renderer exists) |

## Building a Catalog

A catalog is a JSON Schema file that conforms to the [Catalog schema](../../../specification/v0_9/json/client_capabilities.json#L62C5-L95C6) that defines the components, themes and functions an agent can use when building a surface.

### Example: A Minimal Catalog

Here is a simple catalog defining a single component.

```json
{
  "$id": "https://github.com/.../hello_world/v1/catalog.json",
  "catalogId": "https://github.com/.../hello_world/v1/catalog.json",
  "components": {
    "HelloWorldBanner": {
      "type": "object",
      "description": "A simple banner greeting.",
      "properties": {
        "message": {
          "type": "string",
          "description": "The banner text."
        },
        "backgroundColor": {
          "type": "string",
          "default": "#f0f0f0"
        }
      },
      "required": ["message"]
    }
  }
}
```

When the agent uses that catalog, it generates a payload strictly conforming to that structure:

```json
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "hello-world-surface",
      "catalogId": "https://github.com/.../hello_world/v1/catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "hello-world-surface",
      "components": [
        {
          "id": "root",
          "component": "HelloWorldBanner",
          "message": "Hello, world! Welcome to your first catalog.",
          "backgroundColor": "#4CAF50"
        }
      ]
    }
  }
]
```

### Catalog Linking

A2UI Catalogs must be standalone (no references to external files) to simplify LLM inference and dependency management.

While the final catalog must be freestanding, you may still author your catalogs modularly using JSON Schema `$ref` pointing to external documents during local development.

To automate bundling and registering these external file references, this catalog registration process is called **"Linking"** and is consolidated under a single, multi-platform Node.js script (**`register-catalogs.js`**).

This linking script is natively wrapped inside **Xcode Build Phases** (for iOS/macOS client builds) and **Gradle tasks** (for Android client builds) to compile, aggregate, and link static and dynamic schemas seamlessly during your application's build phase.

### Composition & Imports

You do not have to define everything from scratch. You can define a catalog which uses existing components from the basic or other catalogs, and one that reusing the existing rendering logic.

#### Example: Extending the Basic Catalog

This catalog imports all elements from the Basic Catalog and adds a new `SuggestionChips` component.

```json
{
  "$id": "https://github.com/.../hello_world_with_all_basic/v1/catalog.json",
  "catalogId": "https://github.com/.../hello_world_with_all_basic/v1/catalog.json",
  "components": {
    "allOf": [
      {"$ref": "basic_catalog_definition.json#/components"},
      {
        "SuggestionChips": {
          "type": "object",
          "description": "A list of suggested prompts",
          "properties": {
            "suggestions": {
              "type": "array",
              "description": "The suggested prompts."
            }
          },
          "required": ["suggestions"]
        }
      }
    ]
  }
}
```

**Make sure to link and resolve external references during compilation using your platform's Xcode Build Phase or Gradle task (running `register-catalogs.js`).**

#### Example: Cherry-picking Components

This catalog imports only `Text` from the Basic Catalog to build a simple Popup surface.

```json
{
  "$id": "https://github.com/.../hello_world_with_some_basic/v1/catalog.json",
  "catalogId": "https://github.com/.../hello_world_with_some_basic/v1/catalog.json",
  "components": {
    "allOf": [
      {"$ref": "catalogs/basic/catalog.json#/components/Text"},
      {
        "Popup": {
          "type": "object",
          "description": "A modal overlay that displays an icon and text.",
          "properties": {
            "text": {"$ref": "common_types.json#/$defs/ComponentId"}
          },
          "required": ["text"]
        }
      }
    ]
  }
}
```

**Make sure to link and resolve external references during compilation using your platform's Xcode Build Phase or Gradle task (running `register-catalogs.js`).**

### Implementing Renderers

Client renderers implement the catalog by mapping the schema definition to actual code.

First, define the component API in TypeScript matching your catalog schema:

```typescript
// api.ts
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

export const HelloWorldBannerApi = {
  name: 'HelloWorldBanner',
  schema: z.object({
    message: z.string(),
    backgroundColor: z.string().default('#f0f0f0'),
  }).strict(),
} satisfies ComponentApi;
```

Next, implement the component extending `CatalogComponent`:

```typescript
// hello_world_banner.ts
import {CatalogComponent} from '@a2ui/angular/v0_9';
import {Component, computed} from '@angular/core';
import {HelloWorldBannerApi} from './api';

@Component({
  selector: 'hello-world-banner',
  template: `
    <div [style.background-color]="backgroundColor()">
      <h2>Hello World Banner</h2>
      <p>{{ message() }}</p>
    </div>
  `,
})
export class HelloWorldBanner extends CatalogComponent<typeof HelloWorldBannerApi> {
  protected readonly message = computed(() => this.props()['message']?.value() || '');
  protected readonly backgroundColor = computed(() => this.props()['backgroundColor']?.value() || '#f0f0f0');
}
```

Finally, register your custom components in an `AngularCatalog`:

```typescript
// catalog.ts
import {AngularCatalog, BASIC_COMPONENTS, BASIC_FUNCTIONS} from '@a2ui/angular/v0_9';
import {HelloWorldBanner} from './hello_world_banner';
import {HelloWorldBannerApi} from './api';

const customBannerComponent = {
  ...HelloWorldBannerApi,
  component: HelloWorldBanner
};

export const MY_CATALOG = new AngularCatalog(
  'https://github.com/.../hello_world/v1/catalog.json',
  [...BASIC_COMPONENTS, customBannerComponent],
  BASIC_FUNCTIONS
);
```

You can see a working example of a client renderer in the [Orchestrator demo](../../../samples/community/client/angular/projects/orchestrator/src/a2ui-catalog/catalog.ts).

> [!NOTE]
> The Orchestrator demo currently uses v0.8 APIs. For a v0.9 example of catalog registration, see the [DemoCatalog](../../../renderers/angular/a2ui_explorer/src/app/demo-catalog.ts) in the Angular explorer.
>
> Additionally, for client-side functions, the client determines the function's execution boundary (such as `clientOnly` status) at runtime by reading its configuration from the active catalog definition.

## A2UI Catalog Negotiation

Because clients and agents can support multiple catalogs, they must agree on which catalog to use through a catalog negotiation handshake.

### Step 1: Agent advertises its support catalogs (optional)

The agent may optionally advertise which catalogs it is capable of speaking (e.g., in the A2A Agent Card). This is informational; it helps the client know if the agent supports their specific features, but the client doesn’t have to use it.

Example of an A2A AgentCard advertising that the agent supports the basic and rizzcharts catalogs

```json
{
  "name": "Ecommerce Dashboard Agent",
  "description": "This agent visualizes ecommerce data...",
  "capabilities": {
    "extensions": [
      {
        "uri": "https://a2ui.org/a2a-extension/a2ui/v0.8",
        "description": "Provides agent driven UI using the A2UI JSON format.",
        "params": {
          "supportedCatalogIds": [
            "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
            "https://github.com/.../rizzcharts_catalog_definition.json"
          ]
        }
      }
    ]
  }
}
```

### Step 2: Client advertises its support catalogs (required)

The client sends a list of supportedCatalogIds to the Agent, ordered by preference, in the metadata of every message. This tells the agent exactly what the client is prepared to render right now.

Example of A2A message containing the supportedCatalogIds in metadata

```json
{
  "parts": [
    {
      "text": "What is the current status of my flight?"
    }
  ],
  "metadata": {
    "a2uiClientCapabilities": {
      "supportedCatalogIds": [
        "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        "https://github.com/.../rizzcharts_catalog_definition.json"
      ]
    }
  }
}
```

### Step 3: Agent Selection

When the agent creates a new surface, it selects the best match from the client's `supportedCatalogIds` list. This choice is locked for the lifetime of that surface. If no compatible catalog is found, the agent will not send a UI.

Example A2UI Message from the agent defining the catalog_id used in a surface

```json
{
  "createSurface": {
    "surfaceId": "salesDashboard",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
  }
}
```

## Catalog Naming & Versioning

A2UI component catalogs require versioning because catalog definitions are often built in at compile time, so any mismatch between what an agent generates and what a client can render can affect the UI.

### CatalogId Naming Convention

The `catalogId` is a unique text identifier used for negotiation between the client and the agent.

- **Format:** While the `catalogId` is technically a string, the A2UI convention is to use a **URI** (e.g., `https://example.com/catalogs/mysurface/v1/catalog.json`).
- **Purpose:** We use URIs to make the ID globally unique and easy for human developers to inspect in a browser.
- **No Runtime Fetching:** This URI does not imply that the agent or client downloads the catalog at runtime. **The catalog definition must be known to the agent and client beforehand (at compile/deploy time)**. The URI serves only as a stable identifier.
- **JSON Schema Compatibility (`$id` and `catalogId`):** Because A2UI catalogs are currently represented as JSON Schema documents, catalog definitions should include both `$id` (for JSON Schema tooling) and `catalogId` (for A2UI SDKs and catalog negotiation), setting both fields to the same URI.

### Versioning Guidelines

Catalogs should be trated like APIs where version skew between agents and renderers is expected. Catalogs must maintain forward and backward compatibility across versions so that agents, renderers, and templates can evolve without breaking active sessions or stored transcripts.

#### Catalog Schema Evolution Rules

To maintain backward and forward compatibility, the following rules apply:

1. **Additive Only**: It's safe to add new components, functions, or optional properties.
2. **Deprecate Rather than Delete**: Never delete existing components, functions, or properties. Mark them `deprecated: true` along with an `x-deprecated-reason` instead. Renderers should retain handling logic for deprecated components and properties to maintain backward compatibility for historical transcripts, cached states, and templates.
3. **Strict Type Invariance**: Never alter the data type of an existing field.
4. **Open Enums**: Treat enum definitions as open so older renderers do not fail when new enum variants are introduced upstream.
5. **Graceful Degradation**: Renderers should provide a graceful fallback for unknown components instead of failing the entire view hierarchy or surface.
6. **Round-Trip Unknown Component/Field Preservation**: Intermediary services such as orchestrators should preserve unknown properties when serializing/deserializing messages.
7. **Major Version Bumps**: Reserve major catalog version bumps strictly for sweeping cleanups (e.g., removing long-deprecated fields) or fundamentally breaking structural changes.

#### Deprecating Catalog Properties

When deprecating an existing component, function, or property:

- **`deprecated`** (boolean, optional): Standard JSON Schema annotation indicating that a component, function, or property is deprecated.
- **`x-deprecated-reason`** (string, optional): Human-readable explanation of why the entity is deprecated and what to use instead.

```json
{
  "TextBox": {
    "type": "object",
    "properties": {
      "color": {
        "type": "string",
        "description": "Icon color specification.",
        "deprecated": true,
        "x-deprecated-reason": "Use style property to set color using CSS."
      },
      "style": {
        "type": "string",
        "description": "CSS properties such as color."
      }
    }
  }
}
```

### Major Version Bumps with CatalogId

When introducing fundamentally breaking changes that necessitate a major version bump, include the version in the `catalogId` URI. This allows using A2UI catalog negotiation to support multiple versions simultaneously during a migration, ensuring zero downtime.

**Recommended Pattern:**

| Change Type  | URI Example                    | Description                                                   |
| :----------- | :----------------------------- | :------------------------------------------------------------ |
| **Current**  | .../rizzcharts/v1/catalog.json | Version 1.x. Supports all additive updates in the 1.x branch. |
| **Breaking** | .../rizzcharts/v2/catalog.json | A new schema introducing breaking structural changes.         |

### Handling Migrations

To upgrade a catalog across major versions without breaking active agents, use A2UI Catalog Negotiation:

1. **Client Update:** The client updates its list of `supportedCatalogIds` to include _both_ the old and new versions (e.g., `[".../v2/...", ".../v1/..."]`).
2. **Agent Update:** Agents are rebuilt with the v2 schema. When they see the client supports v2, they prefer it.
3. **Legacy Support:** Older agents that have not yet been rebuilt will continue to match against v1 in the client's list, ensuring they remain functional.

## A2UI Schema Validation & Fallback

To ensure a stable user experience, A2UI employs a two-phase validation strategy. This "defense in depth" approach catches errors as early as possible while ensuring clients remain robust when facing unexpected payloads.

### Two-Phase Validation

1. **Agent-Side (Pre-Send):** Before transmitting any UI payload, the agent runtime validates the generated JSON against the catalog definition.
    - Purpose: To catch hallucinated properties or malformed structures at the source.
    - Outcome: If validation fails, the agent can attempt to fix or regenerate the A2UI JSON, or it can do graceful degradation such as falling back to text in a conversational app.
2. **Client-Side:** Upon receiving the payload, the client library validates the JSON against its local definition of the catalog.
    - Purpose: Security and stability. This ensures that the code executing on the user's device strictly conforms to the expected contract, protecting against version mismatches or compromised agent outputs.
    - Outcome: Failures here are reported back to the agent using the “error” client message

### Graceful Degradation

Even if a payload passes schema validation, the renderer may encounter runtime issues (e.g., a missing asset, a component implementation not yet loaded, or a platform-specific limitation).

Clients should not crash when encountering these errors. Instead, they should employ Graceful Degradation:

- **Unknown Components:** If a component is recognized in the schema but not implemented in the renderer, render a "safe" fallback (e.g., a generic card with the component's debug name) or skip rendering that specific node entirely.
- **Text Fallback:** If the entire surface fails to render, display the raw text description (if available) or a generic error message: _"This interface could not be displayed."_

### Client-to-Server Error Reporting

When the client detects a validation error or a runtime failure, it can report this back to the agent. This allows the agent system to log the failure for developers or adjust its future behavior.

The client sends a `VALIDATION_FAILED` event using the standard A2UI Client-to-Server Event Schema.

Example of client reporting a missing required field

```json
{
  "version": "v0.9",
  "error": {
    "code": "VALIDATION_FAILED",
    "surfaceId": "flight-status-card-123",
    "path": "/components/FlightCard/flightNumber",
    "message": "Missing required property 'flightNumber' in component 'FlightCard'."
  }
}
```

## Inline Catalogs

Inline catalogs sent by the client at runtime are supported but not recommended in production. More details about them can be found [here](../../../specification/v0_9/docs/a2ui_protocol.md#client-capabilities--metadata).
