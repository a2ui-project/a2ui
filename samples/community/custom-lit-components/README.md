# A2UI custom component integration guide

This folder is a self-contained catalog of example custom Lit components for A2UI, restored from
the retired `samples/client/lit/custom-components-example/ui/custom-components` sample. It depends
only on the **published** `@a2ui/*` packages from npm (`@a2ui/lit`, `@a2ui/web_core`) — not on the
monorepo workspace — so it can be copied into any project as a starting point.

> **Unmaintained community sample.** It lives under `samples/community` and is covered by
> [`.github/workflows/community_code.yml`](../../../.github/workflows/community_code.yml), which
> type-checks it and bundles its verification pages on every change.

## Components

| Type name   | Tag                       | File                                           | Notes                                         |
| ----------- | ------------------------- | ---------------------------------------------- | --------------------------------------------- |
| `OrgChart`  | `org-chart`               | [org-chart.ts](org-chart.ts)                   | Renders a reporting chain; dispatches actions |
| `WebFrame`  | `a2ui-web-frame`          | [web-frame.ts](web-frame.ts)                   | Sandboxed iframe with a postMessage bridge    |
| `McpApp`    | `a2ui-mcp-apps-component` | [mcp-apps-component.ts](mcp-apps-component.ts) | Hosts an MCP Apps UI resource                 |
| `TextField` | `premium-text-field`      | [premium-text-field.ts](premium-text-field.ts) | **Override** of the standard `TextField`      |

All four are wired up in [register-components.ts](register-components.ts) via
`registerSampleComponents()`.

## Build and verify

```bash
# from samples/community
yarn install
yarn workspace custom-lit-components run build   # tsc type-check + vite bundle of the test pages
yarn workspace custom-lit-components run dev     # vite dev server
```

With the dev server running, open the verification pages described in
[test/README.md](test/README.md).

## Create the component

Create a new Lit component file next to the others, e.g. `my-component.ts`:

```typescript
import {html, css} from 'lit';
import {property} from 'lit/decorators.js';

import {Root} from '@a2ui/lit/ui';

export class MyComponent extends Root {
  @property() accessor myProp: string = 'Default';

  static styles = [
    ...Root.styles, // Inherit base styles
    css`
      :host {
        display: block;
        padding: 16px;
        border: 1px solid #ccc;
      }
    `,
  ];

  render() {
    return html`
      <div>
        <h2>My Custom Component</h2>
        <p>Prop value: ${this.myProp}</p>
      </div>
    `;
  }
}
```

Do **not** add a `@customElement` decorator — the registry defines the element for you (see
[Troubleshooting](#troubleshooting)).

## Register the component

Update `register-components.ts` to register your new component. You must pass the desired tag name
as the third argument, and optionally a JSON schema as the fourth so the registry can publish an
inline catalog to the agent.

```typescript
import {componentRegistry} from '@a2ui/lit/ui';
import {MyComponent} from './my-component.js'; // Import your component

export function registerSampleComponents() {
  // Register with explicit tag name
  componentRegistry.register('MyComponent', MyComponent, 'my-component');
}

export {MyComponent}; // Export for type usage if needed
```

## Define the schema (server-side)

Create a JSON schema for your component properties. This will be used by the server to validate messages.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "type": {"const": "object"},
    "properties": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "myProp": {
          "type": "string",
          "description": "A sample property."
        }
      },
      "required": ["myProp"]
    }
  },
  "required": ["type", "properties"]
}
```

## Use in client application

In your client application, import and call the registration function once at startup, and set
`enableCustomElements` on the A2UI root so it will look components up in the registry.

```typescript
import {registerSampleComponents} from 'custom-lit-components/register-components.js';

// Call this once at startup
registerSampleComponents();
```

## Overriding standard components

You can replace standard A2UI components (like `TextField`, `Video`, `Button`) with your own custom implementations.

### Steps to override

1.  **Create your component** extending `Root` (just like a custom component).

2.  **Ensure it accepts the standard properties** for that component type (e.g., `label` and `text` for `TextField`).

3.  **Register it** using the **standard type name** (e.g., `"TextField"`).

    ```typescript
    // 1. Define your override
    class MyPremiumTextField extends Root {
      @property() accessor label = '';
      @property() accessor text = '';

      static styles = [
        ...Root.styles,
        css`
          /* your premium styles */
        `,
      ];

      render() {
        return html`
          <div class="premium-field">
            <label>${this.label}</label>
            <input .value="${this.text}" />
          </div>
        `;
      }
    }

    // 2. Register with the STANDARD type name
    import {componentRegistry} from '@a2ui/lit/ui';
    componentRegistry.register('TextField', MyPremiumTextField, 'my-premium-textfield');
    ```

**Result:**
When the server sends a `TextField` component, the client will now render `<my-premium-textfield>` instead of the default `<a2ui-textfield>`.

## Verify

You can verify the component by creating a simple HTML test file (see [test/](test/)) or by sending a
server message with the new component type.

**Server message example:**

```json
{
  "surfaceId": "main",
  "component": {
    "type": "MyComponent",
    "id": "comp-1",
    "properties": {
      "myProp": "Hello World"
    }
  }
}
```

## Troubleshooting

- **`NotSupportedError`**: If you see "constructor has already been used", ensure you **removed** the `@customElement` decorator from your component class.
- **Component not rendering**: Check if `registerSampleComponents()` is actually called, and that the A2UI root has `enableCustomElements = true`. Verify the tag name in the DOM matches what you registered (e.g., `<my-component>` vs `<a2ui-custom-mycomponent>`).
- **Styles missing**: Ensure `static styles` includes `...Root.styles`.
- **`McpApp` iframe stays blank**: it needs a cross-origin sandbox proxy. Point `VITE_MCP_SANDBOX_URL` at one, or see the [MCP Apps sample](../client/lit/mcp-apps-in-a2ui-sample) for a full host setup.
