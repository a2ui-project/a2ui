# What is A2UI?

**A2UI (Agent to UI) is a declarative UI protocol for agent-driven interfaces.** AI agents generate rich, interactive UIs that render natively across platforms (web, mobile, desktop) without executing arbitrary code.

## The Problem

**Text-only agent interactions are inefficient:**

```
User: "Book a table for 2 tomorrow at 7pm"
Agent: "Okay, for what day?"
User: "Tomorrow"
Agent: "What time?"
...
```

**Better:** Agent generates a form with date picker, time selector, and submit button. Users interact with UI, not text.

## The Challenge

In multi-agent systems, agents often run remotely (different servers, organizations). They can't directly manipulate your UI—they must send messages.

**Traditional approach:** Send HTML/JavaScript in iframes.

- Heavy, visually disjointed.
- Security complexity.
- Doesn't match app styling.

**Need:** Transmit UI that's safe like data, expressive like code.

## The Solution

A2UI: JSON messages describing UI that:

- LLMs generate as structured output.
- Travel over any transport (A2A, AG-UI, SSE, WebSockets).
- Client renders using its own native components.

**Result:** Client controls security and styling, agent-generated UI feels native.

### Example

=== "v0.8 (Legacy)"

    ```jsonl
    {
      "surfaceUpdate": {
        "surfaceId": "booking",
        "components": [
          {
            "id": "title",
            "component": {
              "Text": {
                "text": { "literalString": "Book Your Table" },
                "usageHint": "h1"
              }
            }
          },
          {
            "id": "datetime",
            "component": {
              "DateTimeInput": {
                "value": { "path": "/booking/date" },
                "enableDate": true
              }
            }
          },
          {
            "id": "submit-text",
            "component": {
              "Text": {
                "text": { "literalString": "Confirm" }
              }
            }
          },
          {
            "id": "submit-btn",
            "component": {
              "Button": {
                "child": "submit-text",
                "action": { "name": "confirm_booking" }
              }
            }
          }
        ]
      }
    }
    {
      "dataModelUpdate": {
        "surfaceId": "booking",
        "contents": [
          {
            "key": "booking",
            "valueMap": [
              { "key": "date", "valueString": "2025-12-16T19:00:00Z" }
            ]
          }
        ]
      }
    }
    {
      "beginRendering": {
        "surfaceId": "booking",
        "root": "title"
      }
    }
    ```

=== "v0.9 (Stable)"

    ```jsonl
    {
      "version": "v0.9.1",
      "createSurface": {
        "surfaceId": "booking",
        "catalogId": "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
      }
    }
    {
      "version": "v0.9.1",
      "updateComponents": {
        "surfaceId": "booking",
        "components": [
          {
            "id": "title",
            "component": "Text",
            "text": "Book Your Table",
            "variant": "h1"
          },
          {
            "id": "datetime",
            "component": "DateTimeInput",
            "value": { "path": "/booking/date" },
            "enableDate": true
          },
          {
            "id": "submit-text",
            "component": "Text",
            "text": "Confirm"
          },
          {
            "id": "submit-btn",
            "component": "Button",
            "child": "submit-text",
            "variant": "primary",
            "action": {
              "event": { "name": "confirm_booking" }
            }
          }
        ]
      }
    }
    {
      "version": "v0.9.1",
      "updateDataModel": {
        "surfaceId": "booking",
        "path": "/booking",
        "value": {
          "date": "2025-12-16T19:00:00Z"
        }
      }
    }
    ```

    Key differences in v0.9: `createSurface` replaces `beginRendering`, components use a flatter structure with `"component": "Text"` instead of nested objects, and all messages include a `version` field.

Client renders these messages as native components (Angular, Flutter, React, etc.).

## Core Value

**1. Security:** Declarative data, not code. Agent requests components from client's trusted catalog. No code execution risk.

**2. Native Feel:** No iframes. Client renders with its own UI framework. Inherits app styling, accessibility, performance.

**3. Portability:** One agent response works everywhere. Same JSON renders on web (Lit/Angular/React), mobile (Flutter/SwiftUI/Jetpack Compose), desktop.

## Design Principles

**1. LLM-Friendly:** Flat component list with ID references. Easy to generate incrementally, correct mistakes, stream.

**2. Framework-Agnostic:** Agent sends abstract component tree. Client maps to native widgets (web/mobile/desktop).

**3. Separation of Concerns:** Three layers—UI structure, application state, client rendering. Enables data binding, reactive updates, clean architecture.

## What A2UI Is NOT

- Not a framework (it is a protocol).
- Not a replacement for HTML (for agent-generated UIs, not static sites).
- Not a robust styling system (client controls styling with limited server-side styling support).
- Not limited to web (works on mobile and desktop).

## Key Concepts

A2UI relies on the following key concepts:

- **Surface**: Canvas for components (dialog, sidebar, main view).
- **Component**: UI element (Button, TextField, Card, etc.).
- **Data Model**: Application state, components bind to it.
- **Catalog**: Available component types.
- **Message**: JSON object (`surfaceUpdate`, `dataModelUpdate`, `beginRendering`, etc.).

For a comparison of similar projects, see [Agent UI Ecosystem](agent-ui-ecosystem.md).
