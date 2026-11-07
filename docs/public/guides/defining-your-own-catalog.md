# Defining Your Own Catalog

While the [Basic Catalog](../../../specification/v0_9/catalogs/basic/catalog.json) is useful for starting out and bootstrapping an application, most production applications will define their own catalog to reflect their specific design system.

By defining your own catalog, you restrict the agent to using exactly the components and visual language that exist in your application, rather than generic inputs or buttons.

## Why Define Your Own Catalog?

Every A2UI surface is driven by a **Catalog**. A catalog is simply a JSON Schema file that tells the agent which components, functions, and themes are available for it to use.

Defining your own catalog offers the following benefits:

- **Design System Alignment**: Restrict the agent to using exactly the components and visual language that exist in your application.
- **Security and Type Safety**: You register entire catalogs with your client application, ensuring that only trusted components are rendered.
- **No Mappers Needed**: It is recommended to build catalogs that directly reflect your client's design system rather than trying to map a generic catalog (like the Basic Catalog) to it through an adapter.

The Basic Catalog is just one example and is intentionally sparse to remain easily implementable by different renderers.

## How It Works

1.  **Define the Catalog**: Create a catalog definition (JSON Schema) listing the components, functions, and styles your application supports.
2.  **Register the Catalog**: Register the catalog and its corresponding component implementations (renderers) with your client application.
3.  **Announce Support**: The client informs the agent which catalogs it supports (via `supportedCatalogIds`).
4.  **Agent Selects Catalog**: The agent chooses a catalog for a given UI surface (via `catalogId` inside the creation message, like `createSurface`).
5.  **Agent Generates UI**: The agent generates component messages using the components defined in that catalog by name.

## Implementation Guide

It is recommended to create catalogs that directly map to your existing component library.

=== "Web (Lit / Angular / React)"

    To implement your own catalog on the web:

    - Create a JSON Schema containing your component definitions.
    - Create your own `Component` objects and `Catalog` object within your chosen web renderer.
        - Provide the schema or reference ID to the agent.

    _Detailed guides for each framework coming soon._

=== "Flutter"

    To implement your own catalog in Flutter:

    - Define a JSON Schema describing your widget properties.
    - Map the schema to Flutter widgets using a custom renderer.

    *Detailed Flutter integration guide coming soon.*

## Accessibility

Accessible custom catalogs divide responsibility between the component schema and the native widget implementation. JSON Schema alone cannot tell whether a control gets its screen reader name from a schema property, visible child text, or fixed native code. Design each component schema around how much its meaning varies across instances.

### Generic vs. domain-specific components

Generic, reusable controls such as `TextField`, `CheckBox`, and `Slider` need a `label` property in their component schema because their purpose changes per instance. Without a schema `label` property, the agent has no standard field to name what the user is editing or toggling.

Domain-specific components such as `UsernameInput` or `SearchSubmitButton` already have a fixed purpose. Build their default accessible labels directly into the native widget implementation instead of exposing a schema `label` property. Omitting a redundant `label` property saves model tokens and prevents inconsistent model-generated text across screens.

### Inherited accessibility attributes and renderer mapping

Every component automatically inherits the optional `accessibility` object from `ComponentCommon` (see [Common Properties](../reference/components.md#common-properties)). Do not redeclare `accessibility` inside individual component schemas, and in v1.0 do not wrap component definitions with `ComponentCommon`.

In v0.9.1 and v1.0, `accessibility` provides `label` and `description`, and both accept literal strings, data bindings, or function calls. Version 1.0 also adds `live` (`"off"`, `"polite"`, or `"assertive"`) for live-region announcements and `hidden` for excluding decorative elements from assistive technologies.

Agents can set `accessibility` on any component instance to supply or override assistive text when visual context is missing, such as an icon-only `Button`:

=== "v1.0 (Candidate)"

    ```json
    {
      "id": "close_button",
      "component": "Button",
      "child": "close_icon",
      "action": {"event": {"name": "close_dialog"}},
      "accessibility": {
        "label": "Close dialog",
        "description": {"@path": "/dialog/unsavedWarning"}
      }
    }
    ```

=== "v0.9.1 (Current)"

    ```json
    {
      "id": "close_button",
      "component": "Button",
      "child": "close_icon",
      "action": {"event": {"name": "close_dialog"}},
      "accessibility": {
        "label": "Close dialog",
        "description": {"path": "/dialog/unsavedWarning"}
      }
    }
    ```

Notice that v1.0 data bindings use `@path`, whereas v0.9.1 bindings use `path`.

In your native component implementation, map resolved `AccessibilityAttributes` and visible child text or titles to platform accessibility APIs. Use WAI-ARIA attributes on the web, `Semantics` widgets in Flutter, and `.accessibilityLabel` or `.accessibilityHint` modifiers in SwiftUI. When an instance sets `accessibility.label` or `accessibility.description`, let those values override any label inferred from visible text (see [Catalog-Agnostic Accessibility Requirements](../../../specification/v1_0/docs/a2ui_protocol.md#catalog-agnostic-accessibility-requirements)).

## Security Considerations

When defining and registering catalogs:

1.  **Allowlist components**: Only register components you trust in your catalog definition. Don't expose components that offer dangerous capabilities (e.g., executing arbitrary scripts) unless strictly controlled.
2.  **Validate properties**: Always validate component properties from agent messages to ensure they match expected type constraints.
3.  **Sanitize text**: Avoid rendering un-sanitized content provided by the agent unless safe bounds are established.

## Next Steps

- **[Theming & Styling](theming.md)**: Customize the look and feel of components.
- **[Component Reference](../reference/components.md)**: Explore standard types that might be available for reuse.
- **[Agent Development](agent-development.md)**: Build agents that interact with your Catalog.
