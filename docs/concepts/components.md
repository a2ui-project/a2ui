# Components & Structure

A2UI uses an **adjacency list model** for component hierarchies. Instead of nested JSON trees, components are a flat list with ID references.

## Why Flat Lists?

**Traditional nested approach:**

- LLM must generate perfect nesting in one pass
- Hard to update deeply nested components
- Difficult to stream incrementally

**A2UI adjacency list:**

- Flat structure, easy for LLMs to generate.
- Send components incrementally.
- Update any component by ID.
- Clear separation of structure and data.

## The Adjacency List Model

=== "v0.8"

    ```json
    {
      "surfaceUpdate": {
        "components": [
          {
            "id": "root",
            "component": {
              "Column": {
                "children": { "explicitList": ["greeting", "buttons"] }
              }
            }
          },
          {
            "id": "greeting",
            "component": {
              "Text": { "text": { "literalString": "Hello" } }
            }
          },
          {
            "id": "buttons",
            "component": {
              "Row": {
                "children": { "explicitList": ["cancel-btn", "ok-btn"] }
              }
            }
          },
          {
            "id": "cancel-btn",
            "component": {
              "Button": {
                "child": "cancel-text",
                "action": { "name": "cancel" }
              }
            }
          },
          {
            "id": "cancel-text",
            "component": {
              "Text": { "text": { "literalString": "Cancel" } }
            }
          },
          {
            "id": "ok-btn",
            "component": {
              "Button": {
                "child": "ok-text",
                "action": { "name": "ok" }
              }
            }
          },
          {
            "id": "ok-text",
            "component": {
              "Text": { "text": { "literalString": "OK" } }
            }
          }
        ]
      }
    }
    ```

=== "v0.9 and later"

    ```json
    {
      "version": "v0.9.1",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {
            "id": "root",
            "component": "Column",
            "children": ["greeting", "buttons"]
          },
          {
            "id": "greeting",
            "component": "Text",
            "text": "Hello"
          },
          {
            "id": "buttons",
            "component": "Row",
            "children": ["cancel-btn", "ok-btn"]
          },
          {
            "id": "cancel-btn",
            "component": "Button",
            "child": "cancel-text",
            "action": { "event": { "name": "cancel" } }
          },
          {
            "id": "cancel-text",
            "component": "Text",
            "text": "Cancel"
          },
          {
            "id": "ok-btn",
            "component": "Button",
            "child": "ok-text",
            "action": { "event": { "name": "ok" } }
          },
          {
            "id": "ok-text",
            "component": "Text",
            "text": "OK"
          }
        ]
      }
    }
    ```

    v0.9 and later use a flatter component format: `"component": "Text"` instead of nested `{"Text": {...}}`, and children are simple arrays instead of `{"explicitList": [...]}`.

Components reference children by ID, not by nesting.

## Component Basics

Every component has:

1. **ID**: Unique identifier (`"welcome"`)
2. **Type**: Component type (`Text`, `Button`, `Card`)
3. **Properties**: Configuration specific to that type

=== "v0.8"

    ```json
    {
      "id": "welcome",
      "component": {
        "Text": {
          "text": { "literalString": "Hello" },
          "usageHint": "h1"
        }
      }
    }
    ```

=== "v0.9 and later"

    ```json
    {
      "id": "welcome",
      "component": "Text",
      "text": "Hello",
      "variant": "h1"
    }
    ```

## The Basic Catalog

To help developers get started quickly, the A2UI team maintains the [Basic Catalog](../specification/v0_9_1/catalogs/basic/catalog.json).

This is a pre-defined catalog file that contains a basic set of general-purpose components (Buttons, Inputs, Cards). It is not a special "type" of catalog; it is simply a version of a catalog that has open source renderers available.

For the complete component gallery with examples, see [Component Reference](../reference/components.md).

## Static vs. Dynamic Children

=== "v0.8"

    **Static (`explicitList`)** - Fixed list of child IDs:

    ```json
    {
      "children": {
        "explicitList": ["back-btn", "title", "menu-btn"]
      }
    }
    ```

    **Dynamic (`template`)** - Generate children from data array:

    ```json
    {
      "children": {
        "template": {
          "dataBinding": "/items",
          "componentId": "item-template"
        }
      }
    }
    ```

    For each item in `/items`, render the `item-template`. See [Data Binding](data-binding.md) for details.

=== "v0.9 and later"

    **Static** - Fixed list of child IDs:

    ```json
    {
      "children": ["back-btn", "title", "menu-btn"]
    }
    ```

    **Dynamic** - Generate children from data array:

    ```json
    {
      "children": {
        "path": "/items",
        "componentId": "item-template"
      }
    }
    ```

    For each item in `/items`, render the `item-template`. See [Data Binding](data-binding.md) for details.

## Hydrating with Values

Components get their values two ways:

=== "v0.8"

    - **Literal** - Fixed value: `{"text": {"literalString": "Welcome"}}`
    - **Data-bound** - From data model: `{"text": {"path": "/user/name"}}`

=== "v0.9 and later"

    - **Literal** - Fixed value: `{"text": "Welcome"}`
    - **Data-bound** - From data model: `{"text": {"path": "/user/name"}}`

LLMs can generate components with literal values or bind them to data paths for dynamic content.

## Composing Surfaces

Components compose into **surfaces** (widgets):

=== "v0.8"

    1. LLM generates component definitions via `surfaceUpdate`
    2. LLM populates data via `dataModelUpdate`
    3. LLM signals render via `beginRendering`
    4. Client renders all components as native widgets

=== "v0.9 and later"

    1. LLM creates a surface via `createSurface` (specifying catalog; in v1.0, can also include initial data model and components)
    2. LLM generates component definitions via `updateComponents`
    3. LLM populates data via `updateDataModel`
    4. Client renders all components as native widgets

A surface is a complete, cohesive UI (form, dashboard, chat, etc.).

## Incremental Updates

Incremental updates support the following operations:

- **Add** - Send new component definitions with new IDs
- **Update** - Send component definitions with existing ID and new properties
- **Remove** - Update parent's `children` list to exclude removed IDs

The flat structure makes all updates simple ID-based operations.

## Defining Your Own Catalog

While the Basic Catalog is useful for starting out, most production applications will define their own catalog to reflect their specific design system.

By defining your own catalog, you restrict the agent to using exactly the components and visual language that exist in your application, rather than generic inputs or buttons.

See [Defining Your Own Catalog Guide](../guides/defining-your-own-catalog.md) for implementation details.

## Best Practices

1. **Descriptive IDs**: Use `"user-profile-card"` not `"c1"`
2. **Shallow hierarchies**: Avoid deep nesting
3. **Separate structure from content**: Use data bindings, not literals
4. **Reuse with templates**: One template, many instances via dynamic children
