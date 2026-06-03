# A2UI Renderer Implementation Guide

This document outlines the required features for a new renderer implementation of the A2UI protocol. It is intended for developers building new renderers (e.g., for React, Flutter, iOS, etc.).

> NOTE: Version Notes
>
> This guide primarily describes the v0.8 message flow. v0.9 renames several messages (`surfaceUpdate` → `updateComponents`, `dataModelUpdate` → `updateDataModel`, `beginRendering` → `createSurface`) and uses a flatter component format. See the [v0.9 specification](../specification/v0.9-a2ui.md) for details.

## Web Renderers: Use `@a2ui/web_core` (`web_core`)

If you're building a renderer for the web (React, Vue, Svelte, etc.), you don't need to implement message processing, state management, or schema validation from scratch. The **[`@a2ui/web_core`](https://github.com/a2ui-project/a2ui/tree/main/renderers/web_core)** package (`web_core`) provides all the framework-agnostic logic that the maintained Lit, Angular, and React renderers share.

### What `web_core` provides

| Module                                   | What it does                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **`MessageProcessor`**                   | Processes the A2UI JSONL stream, dispatches messages, manages surface lifecycle                  |
| **`SurfaceModel` / `SurfaceGroupModel`** | State management for surfaces, components, and data models                                       |
| **`DataModel` / `DataContext`**          | Data binding resolution, path-based lookups, template list rendering                             |
| **`ComponentModel`**                     | Component tree state, adjacency list → tree resolution                                           |
| **Types & Schemas**                      | TypeScript types for all A2UI components, primitives, colors, styles, and JSON schema validation |
| **Expression parser**                    | Client-side function evaluation (v0.9)                                                           |

### How the maintained renderers use it

All three web renderers follow the same pattern — `web_core` handles the protocol, the renderer handles the UI:

```typescript
// Types — shared across all renderers
import type * as Types from '@a2ui/web_core/types/types';
import type * as Primitives from '@a2ui/web_core/types/primitives';

// v0.8: Message processing and state
import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';

// v0.9: Message processing, surfaces, catalogs
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {SurfaceModel} from '@a2ui/web_core/v0_9';

// Styles and layout helpers
import * as Styles from '@a2ui/web_core/styles/index';
```

Your renderer only needs to:

1. **Map A2UI component types to your framework's components** (e.g., `Text` → `<p>`, `Button` → `<button>`)
2. **Subscribe to state changes** from `web_core` and re-render
3. **Forward user actions** back through the `MessageProcessor`

See the [React renderer](https://github.com/a2ui-project/a2ui/tree/main/renderers/react), [Lit renderer](https://github.com/a2ui-project/a2ui/tree/main/renderers/lit), and [Angular renderer](https://github.com/a2ui-project/a2ui/tree/main/renderers/angular) for working examples of this pattern.

### Version support

`web_core` exports both v0.8 and v0.9 APIs:

- `@a2ui/web_core/v0_8` or `@a2ui/web_core` (default) — stable v0.8
- `@a2ui/web_core/v0_9` — v0.9 with `createSurface`, custom catalogs, client-side functions
- `@a2ui/web_core/v0_9/basic_catalog` — v0.9 basic catalog expression parser and built-in functions

> TIP: Start with `web_core`
>
> Building a web renderer without `web_core` means reimplementing ~3,000 lines of message processing, state management, and schema validation. Unless you have a specific reason to diverge, use it.

---

## I. Core Protocol Implementation Checklist

This section details the fundamental mechanics of the A2UI protocol. A compliant renderer must implement these systems to successfully parse the server stream, manage state, and handle user interactions.

### Message Processing & State Management

A compliant renderer must implement the following message processing and state management features:

- **JSONL Stream Parsing**: Implement a parser that can read a streaming response line by line, decoding each line as a distinct JSON object.
- **Message Dispatcher**: Create a dispatcher to identify the message type (`beginRendering`, `surfaceUpdate`, `dataModelUpdate`, `deleteSurface`) and route it to the correct handler.
- **Surface Management**:
    - Implement a data structure to manage multiple UI surfaces, each keyed by its `surfaceId`.
    - Handle `surfaceUpdate`: Add or update components in the specified surface's component buffer.
    - Handle `deleteSurface`: Remove the specified surface and all its associated data and components.
- **Component Buffering (Adjacency List)**:
    - For each surface, maintain a component buffer (e.g., a `Map<String, Component>`) to store all component definitions by their `id`.
    - Be able to reconstruct the UI tree at render time by resolving `id` references in container components (`children.explicitList`, `child`, `contentChild`, etc.).
- **Data Model Store**:
    - For each surface, maintain a separate data model store (e.g., a JSON object or a `Map<String, any>`).
    - Handle `dataModelUpdate`: Update the data model at the specified `path`. The `contents` will be in an adjacency list format (e.g., `[{ "key": "name", "valueString": "Bob" }]`).

### Rendering Logic

Implement the following rendering logic:

- **Progressive Rendering Control**:
    - Buffer all incoming `surfaceUpdate` and `dataModelUpdate` messages without rendering immediately.
    - Handle `beginRendering`: This message acts as the explicit signal to perform the initial render of a surface and set the root component ID.
        - Start rendering from the specified `root` component ID.
        - If a `catalogId` is provided, ensure the corresponding component catalog is used (defaulting to the standard catalog if omitted).
        - Apply any global `styles` (e.g., `font`, `primaryColor`) provided in this message.
- **Data Binding Resolution**:
    - Implement a resolver for `BoundValue` objects found in component properties.
    - If only a `literal*` value is present (`literalString`, `literalNumber`, etc.), use it directly.
    - If only a `path` is present, resolve it against the surface's data model.
    - If both `path` and `literal*` are present, first update the data model at `path` with the literal value, then bind the component property to that `path`.
- **Dynamic List Rendering**:
    - For containers with a `children.template`, iterate over the data list found at `template.dataBinding` (which resolves to a list in the data model).
    - For each item in the data list, render the component specified by `template.componentId`, making the item's data available for relative data binding within the template.

### Client-to-Server Communication

Implement the following communication features:

- **Event Handling**:
    - When a user interacts with a component that has an `action` defined, construct a `userAction` payload.
    - Resolve all data bindings within the `action.context` against the data model.
    - Send the complete `userAction` object to the server's event handling endpoint.
- **Client Capabilities Reporting**:
    - In **every** A2A message sent to the server (as part of the metadata), include an `a2uiClientCapabilities` object.
    - This object should declare the component catalog your client supports via `supportedCatalogIds` (e.g., including the URI for the standard 0.8 catalog).
    - Optionally, if the server supports it, provide `inlineCatalogs` for custom, on-the-fly component definitions.
- **Error Reporting**: Implement a mechanism to send an `error` message to the server to report any client-side errors (e.g., failed data binding, unknown component type).

## II. Basic Component Catalog Checklist

To ensure a consistent user experience across platforms, A2UI defines a basic set of components. Your client should map these abstract definitions to their corresponding native UI widgets.

### Basic Content

The basic catalog includes the following basic content components:

- **Text**: Render text content. Must support data binding on `text` and a `usageHint` for styling (h1-h5, body, caption).
- **Image**: Render an image from a URL. Must support `fit` (cover, contain, etc.) and `usageHint` (avatar, hero, etc.) properties.
- **Icon**: Render a predefined icon from the basic set specified in the catalog.
- **Video**: Render a video player for a given URL.
- **AudioPlayer**: Render an audio player for a given URL, optionally with a description.
- **Divider**: Render a visual separator, supporting both `horizontal` and `vertical` axes.

### Layout & Containers

The basic catalog includes the following layout and container components:

- **Row**: Arrange children horizontally. Must support `distribution` (justify-content) and `alignment` (align-items). Children can have a `weight` property to control flex-grow behavior.
- **Column**: Arrange children vertically. Must support `distribution` and `alignment`. Children can have a `weight` property to control flex-grow behavior.
- **List**: Render a scrollable list of items. Must support `direction` (`horizontal`/`vertical`) and `alignment`.
- **Card**: A container that visually groups its child content, typically with a border, rounded corners, and/or shadow. Has a single `child`.
- **Tabs**: A container that displays a set of tabs. Includes `tabItems`, where each item has a `title` and a `child`.
- **Modal**: A dialog that appears on top of the main content. It is triggered by an `entryPointChild` (e.g. a button) and displays the `contentChild` when activated.

### Interactive & Input Components

The basic catalog includes the following interactive and input components:

- **Button**: A clickable element that triggers a `userAction`. Must be able to contain a `child` component (typically Text or Icon) and may vary in style based on the `primary` boolean.
- **CheckBox**: A checkbox that can be toggled, reflecting a boolean value.
- **TextField**: An input field for text. Must support a `label`, `text` (value), `textFieldType` (`shortText`, `longText`, `number`, `obscured`, `date`), and `validationRegexp`.
- **DateTimeInput**: A dedicated input for selecting a date and/or time. Must support `enableDate` and `enableTime`.
- **MultipleChoice**: A component for selecting one or more options from a list (`options`). Must support `maxAllowedSelections` and bind `selections` to a list or single value.
- **Slider**: A slider for selecting a numeric value (`value`) from a defined range (`minValue`, `maxValue`).
