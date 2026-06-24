# A2UI Renderer Implementation Guide

This document outlines the required features for a new renderer implementation of the A2UI protocol. It is intended for developers building new renderers (e.g., for React, Flutter, iOS, etc.).

> NOTE: Version-Aware Guide
>
> This guide provides implementation checklists for v0.8, v0.9.1 (Current Production), and v1.0 (Candidate). Use the tabs below to select the version you are targeting.

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
| **Expression parser**                    | Client-side function evaluation (v0.9+)                                                          |

### How the maintained renderers use it

All three web renderers follow the same pattern — `web_core` handles the protocol, the renderer handles the UI:

```typescript
// Types — shared across all renderers
import type * as Types from '@a2ui/web_core/types/types';
import type * as Primitives from '@a2ui/web_core/types/primitives';

// v0.8: Message processing and state
import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';

// v0.9.1 / v1.0: Message processing, surfaces, catalogs
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

`web_core` exports API sets per version:

- `@a2ui/web_core/v0_8` — stable v0.8
- `@a2ui/web_core/v0_9` — v0.9/v0.9.1 support with `createSurface`, custom catalogs, client-side functions
- `@a2ui/web_core/v1_0` — candidate v1.0 support including RPC action responses

> TIP: Start with `web_core`
>
> Building a web renderer without `web_core` means reimplementing ~3,000 lines of message processing, state management, and schema validation. Unless you have a specific reason to diverge, use it.

---

## I. Core Protocol Implementation Checklist

This section details the fundamental mechanics of the A2UI protocol. A compliant renderer must implement these systems to successfully parse the server stream, manage state, and handle user interactions.

=== "v0.8"

    - **JSONL Stream Parsing**: Read a streaming response line by line, decoding each line as a distinct JSON object.
    - **Message Dispatcher**: Identify message types (`beginRendering`, `surfaceUpdate`, `dataModelUpdate`, `deleteSurface`) and route to the correct handler.
    - **Surface Management**:
        - Key surfaces by `surfaceId`.
        - Handle `surfaceUpdate`: Add/update components in the surface's buffer.
        - Handle `deleteSurface`: Remove the surface and all associated data/components.
    - **Component Buffering**:
        - Maintain a component buffer (e.g., `Map<String, Component>`) for each surface.
        - Reconstruct the UI tree by resolving `id` references (`children.explicitList`, `child`, `contentChild`, etc.).
    - **Data Model Store**:
        - Maintain data model state for each surface.
        - Handle `dataModelUpdate`: Update values at paths using the adjacency list representation (`[{ "key": "name", "valueString": "Bob" }]`).
    - **Progressive Rendering**:
        - Buffer updates until `beginRendering` is received.
        - Start rendering from the specified `root` ID upon receiving `beginRendering`. Apply theme styles.
    - **Data Binding Resolution**:
        - Resolve `BoundValue` objects using `literalString` / `literalNumber` / `path`.
    - **Dynamic Lists**:
        - For `children.template`, iterate over the data list at `template.dataBinding` and render components using `template.componentId`.
    - **Client-to-Server**:
        - Dispatch `userAction` containing context with resolved paths to the server.
        - Include `a2uiClientCapabilities` in transport metadata.

=== "v0.9.1 (Current)"

    - **JSONL Stream Parsing**: Read a streaming response line by line, decoding each line as a distinct JSON object.
    - **Message Dispatcher**: Identify message types (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`) and route to the correct handler.
    - **MIME Type Validation**: Intercept payloads based on the standardized `application/a2ui+json` MIME type.
    - **Surface Management**:
        - Key surfaces by `surfaceId`.
        - Handle `createSurface`: Create surface, bind `catalogId`, register `theme` and `sendDataModel`.
        - Handle `updateComponents`: Add/update components in flat format using `"component": "Type"` discriminators.
        - Handle `deleteSurface`: Remove the surface and all associated data/components.
    - **Component Buffering**:
        - Maintain a component buffer (e.g., `Map<String, Component>`) for each surface.
        - Reconstruct the UI tree by resolving ID references in container component `children` arrays or `child` fields.
    - **Data Model Store**:
        - Maintain data model state for each surface.
        - Handle `updateDataModel`: Update data at paths using standard JSON objects with upsert semantics.
    - **Progressive Rendering**:
        - Render immediately upon parsing a valid root component (ID `root`) in `updateComponents`. Do not wait for a special rendering signal.
    - **Data Binding Resolution**:
        - Resolve simplified bound values (either literals or `{"path": "..."}`).
    - **Dynamic Lists**:
        - For child templates, iterate over data arrays at `path` and render templates specified by `componentId`.
    - **Client-side Functions**:
        - Evaluate registered catalog-defined functions (e.g. `formatString` interpolation).
    - **Client-to-Server**:
        - Dispatch `action` (replaces `userAction`) containing context with resolved paths.
        - Automatically include the full client-side data model in the metadata if `sendDataModel` was requested.
        - Send structured `ValidationFailed` error messages to the server if a schema validation fails.

=== "v1.0 (Candidate)"

    All requirements from v0.9.1, with the following extensions:
    - **Surface Properties**:
        - Handle `createSurface` with `surfaceProperties` (renamed from `theme`). Custom primary brand colors are no longer supported inside the surface schema.
    - **Action Responses (RPC)**:
        - Handle the `actionResponse` message from the server containing `actionId` and a return `value` or `error`.
    - **Client-to-Server**:
        - Generate and include an `actionId` inside `action` payloads.
        - Support `wantResponse: true` on actions when the client expects a response.
        - If using A2A, every A2A `Message` sent to the server must include an `a2uiClientCapabilities` object in the `metadata` field of the A2A `Message`.
    - **Capabilities**:
        - Expose `surfaceProperties` in place of `theme` during capabilities exchange.

---

## II. Basic Component Catalog Checklist

To ensure a consistent user experience across platforms, A2UI defines a basic set of components. Your client should map these abstract definitions to their corresponding native UI widgets.

=== "v0.8"

    - **Text**: Render text. Support `usageHint` (h1-h5, body, caption).
    - **Image**: Render image from URL. Support `fit` and `usageHint` (avatar, hero, etc.).
    - **Icon**: Render system icons.
    - **Video**: Render video player.
    - **AudioPlayer**: Render audio player with description.
    - **Divider**: Render horizontal/vertical lines.
    - **Row** / **Column**: Arrange children horizontally/vertically. Support `distribution` and `alignment`. Support child `weight`.
    - **List**: Render scrollable list.
    - **Card**: Box layout with rounded corners and shadows.
    - **Tabs**: Tabbed navigation using `tabItems`.
    - **Modal**: Popup triggered by `entryPointChild` displaying `contentChild`.
    - **Button**: Clickable button triggering `userAction`. Support `primary` variant.
    - **CheckBox**: Boolean checkbox.
    - **TextField**: Input field supporting `label`, `textFieldType` (`shortText`, `longText`, etc.), and `validationRegexp`.
    - **MultipleChoice**: Support `options`, `maxAllowedSelections`, and single/multiple value selections.
    - **Slider**: Support ranges using `minValue`, `maxValue`.

=== "v0.9.1 (Current)"

    - **Text**: Render text. Support `variant` (replaces `usageHint`).
    - **Image**: Render image from URL. Support `fit` and `variant`.
    - **Icon**: Render system icons.
    - **Video**: Render video player.
    - **AudioPlayer**: Render audio player with description.
    - **Divider**: Render horizontal/vertical lines.
    - **Row** / **Column**: Arrange children horizontally/vertically. Support `justify` and `align`. Support child `weight`.
    - **List**: Render scrollable list.
    - **Card**: Box layout with rounded corners and shadows.
    - **Tabs**: Tabbed navigation using `tabs`.
    - **Modal**: Popup triggered by `trigger` displaying `content`.
    - **Button**: Clickable button triggering `action`. Support `variant` (primary, borderless).
    - **CheckBox**: Boolean checkbox.
    - **TextField**: Input field supporting `label`, `value` (replaces `text`), `variant` (`shortText`, `longText`, etc.), and `checks` (validation functions).
    - **ChoicePicker**: (Replaces MultipleChoice) Support `options` and `variant` (`mutuallyExclusive`, `multipleSelection`).
    - **Slider**: Support ranges using `min`, `max` (replaces `minValue`, `maxValue`).

=== "v1.0 (Candidate)"

    All components from v0.9.1, with the following extensions:
    - **Video**: Support the `posterUrl` property to display a preview image.
    - **TextField**: Support the `placeholder` property.
