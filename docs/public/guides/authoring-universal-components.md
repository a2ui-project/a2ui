# Authoring universal components

Universal components allow you to write a custom UI component once as a Web Component and use it directly across Lit, React, Angular, and more, because they work for any renderer that implements support for A2UI universal web components.

## Quick start

Creating and using a universal component involves three steps:

1. **Define the component schema**: Declare the properties your component accepts.
2. **Build the component**: Implement the visual structure and behavior using `A2uiLitElement`.
3. **Register it in your app**: Add the component to your catalog in Lit, React, Angular, or another supported renderer.

---

## 1. Define the component schema

Create an API definition with the component name and a Zod schema describing its properties. Use schemas from `@a2ui/web_core/v0_9` for values that the agent can bind to data model paths or actions.

```typescript
// stat-card.api.ts
import { z } from 'zod';
import {
  type ComponentApi,
  DynamicStringSchema,
  ChildListSchema,
  ActionSchema,
} from '@a2ui/web_core/v0_9';

export const StatCardApi = {
  name: 'StatCard',
  schema: z.object({
    title: DynamicStringSchema,
    value: DynamicStringSchema,
    changePercentage: z.number().optional(),
    trend: z.enum(['up', 'down', 'neutral']).optional(),
    action: ActionSchema.optional(),
    children: ChildListSchema.optional(),
  }),
} satisfies ComponentApi;
```

---

## 2. Build the component

Create a class that extends `A2uiLitElement` and provide your schema via `protected readonly api`.

- Access resolved properties through `this.controller.props`.
- Trigger agent actions by calling `props.action?.()`.
- Render child components using `this.renderNode(childId)`.

```typescript
// stat-card.ts
import { html, css, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import {
  A2uiLitElement,
  createComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import { StatCardApi } from './stat-card.api.js';

@customElement('a2ui-stat-card')
export class StatCardElement extends A2uiLitElement<typeof StatCardApi> {
  // Styles render in the Light DOM, so host CSS variables and classes pass through.
  static override styles = css`
    :host {
      display: block;
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: 8px;
      padding: 16px;
      background: var(--card-background, #ffffff);
    }
    .title {
      font-size: 0.875rem;
      color: var(--muted-color, #64748b);
    }
    .value {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 4px 0;
    }
    .trend-up { color: #16a34a; }
    .trend-down { color: #dc2626; }
    .action { margin-top: 12px; }
    .children { margin-top: 12px; }
  `;

  protected readonly api = StatCardApi;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const { title, value, changePercentage, trend, action, children } = props;

    return html`
      <div class="stat-card">
        <div class="title">${title}</div>
        <div class="value">${value}</div>

        ${changePercentage !== undefined
          ? html`
              <span class="trend-${trend ?? 'neutral'}">
                ${trend === 'up' ? '▲' : trend === 'down' ? '▼' : '•'}
                ${changePercentage}%
              </span>
            `
          : nothing}

        ${action
          ? html`
              <div class="action">
                <button type="button" @click=${() => action()}>
                  View details
                </button>
              </div>
            `
          : nothing}

        ${children && children.length > 0
          ? html`
              <div class="children">
                ${children.map((childId) => this.renderNode(childId))}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

// Export the component ready for catalog registration
export const statCardComponent = createComponentImplementation(
  StatCardApi,
  StatCardElement,
);
```

---

## 3. Register and use in your application

Import `statCardComponent` and register it in your application catalog:

=== "Angular"

    Register the component in your `AngularCatalog`. Add `CUSTOM_ELEMENTS_SCHEMA` to your component's `schemas` list so Angular templates recognize the custom element tag:

    ```typescript
    import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
    import { AngularCatalog, BASIC_COMPONENTS, BASIC_FUNCTIONS } from '@a2ui/angular/v0_9';
    import { statCardComponent } from './stat-card.js';

    export const myCatalog = new AngularCatalog(
      'my-catalog',
      [...BASIC_COMPONENTS, statCardComponent],
      BASIC_FUNCTIONS,
    );

    @Component({
      selector: 'app-root',
      standalone: true,
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      template: `
        <a2ui-surface [surfaceId]="'main'" [catalog]="catalog"></a2ui-surface>
      `,
    })
    export class AppComponent {
      readonly catalog = myCatalog;
    }
    ```

=== "React"

    Add the component to your React catalog. The React renderer mounts the custom element and handles reactive property updates automatically:

    ```tsx
    import React from 'react';
    import { Catalog, MessageProcessor } from '@a2ui/web_core/v0_9';
    import { basicCatalog, A2uiSurface } from '@a2ui/react/v0_9';
    import { statCardComponent } from './stat-card.js';

    // Register alongside basic components or your own custom library
    export const myCatalog = new Catalog('my-catalog', [
      ...basicCatalog.components.values(),
      statCardComponent,
    ]);

    export function App({ processor }: { processor: MessageProcessor }) {
      return (
        <A2uiSurface
          surfaceId="main"
          processor={processor}
          catalog={myCatalog}
        />
      );
    }
    ```

=== "Lit"

    Add the component to your Lit `Catalog` and pass it to the `<a2ui-surface>` element:

    ```typescript
    import { html, LitElement } from 'lit';
    import { customElement } from 'lit/decorators.js';
    import { Catalog } from '@a2ui/web_core/v0_9';
    import { basicCatalog } from '@a2ui/lit/v0_9';
    import { statCardComponent } from './stat-card.js';

    export const myCatalog = new Catalog('my-catalog', [
      ...basicCatalog.components.values(),
      statCardComponent,
    ]);

    @customElement('my-app')
    export class MyApp extends LitElement {
      override render() {
        return html`
          <a2ui-surface surfaceId="main" .catalog=${myCatalog}></a2ui-surface>
        `;
      }
    }
    ```

---

## Common patterns

### Handling actions

When your schema includes `ActionSchema`, the agent can send either a server event or a client-side function call. You do not need to check which type of action was sent. In your template, call `action()` directly:

```typescript
${props.action
  ? html`<button @click=${() => props.action?.()}>Open</button>`
  : nothing}
```

The agent payload sets up the action:

```json
{
  "id": "card-1",
  "component": "StatCard",
  "title": "Revenue",
  "value": "$24,500",
  "action": {
    "event": {
      "name": "VIEW_REVENUE_REPORT",
      "context": {
        "reportId": "q3-2026"
      }
    }
  }
}
```

When the user clicks the button, A2UI automatically resolves any context values and sends the event to the agent.

### Rendering child components

If your component is a container (like a grid, list, or card), add a child property to your schema using `ChildListSchema` or `ComponentIdSchema`.

In your template, call `this.renderNode(childId)` for each child ID:

```typescript
override render() {
  const children = this.controller.props.children ?? [];

  return html`
    <div class="card-grid">
      ${children.map((childId) => html`
        <div class="grid-item">
          ${this.renderNode(childId)}
        </div>
      `)}
    </div>
  `;
}
```

`this.renderNode()` resolves the child component from the surface model and renders it with the appropriate catalog implementation, whether it is a basic catalog component or another universal component.

### Two-way data binding for form inputs

For properties defined with dynamic schemas (such as `DynamicStringSchema`, `DynamicNumberSchema`, or `DynamicBooleanSchema`), A2UI automatically generates a typed setter method on `props`. For example, a property named `value` produces `setValue()`, while a property named `checked` produces `setChecked()`.

Calling the setter writes the new value directly back to the bound data model path:

```typescript
override render() {
  const props = this.controller.props;
  if (!props) return nothing;

  return html`
    <input
      type="text"
      .value=${props.value ?? ''}
      @input=${(e: Event) =>
        props.setValue((e.target as HTMLInputElement).value)}
    />
  `;
}
```

If the agent bound `value` to a data model path (for example, `{"path": "/user/name"}`), calling `props.setValue()` updates that path and automatically triggers re-renders for any other components bound to the same data.

### Styling and theming

`A2uiLitElement` renders into the Light DOM by default. This allows your app's global design system, CSS variables, and utility classes (such as Tailwind or Bootstrap) to style custom components without shadow DOM boundaries:

=== "Angular"

    In your component stylesheet or global `styles.css`:

    ```css
    /* Style custom element instances */
    a2ui-stat-card {
      --border-color: #3b82f6;
      --card-background: #eff6ff;
    }
    ```

=== "React"

    In your `App.css` or stylesheet:

    ```css
    /* Style custom element instances */
    a2ui-stat-card {
      --border-color: #3b82f6;
      --card-background: #eff6ff;
    }
    ```

=== "Lit"

    In your host component or page stylesheet:

    ```css
    /* Style custom element instances */
    a2ui-stat-card {
      --border-color: #3b82f6;
      --card-background: #eff6ff;
    }
    ```

If your component needs full encapsulation, you can opt into Shadow DOM by overriding `createRenderRoot()`:

```typescript
override createRenderRoot() {
  return super.createRenderRoot();
}
```
