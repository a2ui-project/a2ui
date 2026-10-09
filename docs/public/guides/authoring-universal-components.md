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
import {z} from 'zod';
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

Create a class that extends `A2uiLitElement` and provide your schema via `protected override readonly api`.

- Access resolved properties through `this.controller.props`.
- Trigger agent actions by calling `props.action?.()`.
- Render child components using `this.renderNode(childId)`.

Then export a `WebComponentImplementation`: the API, the custom element tag name, and the element class. This is the object you register in a catalog.

```typescript
// stat-card.ts
import {html, css, nothing} from 'lit';
import {customElement} from 'lit/decorators.js';
import {
  A2uiLitElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {StatCardApi} from './stat-card.api.js';

@customElement('a2ui-stat-card')
export class StatCardElement extends A2uiLitElement<typeof StatCardApi> {
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

  protected override readonly api = StatCardApi;

  override render() {
    const {title, value, changePercentage, trend, action, children} =
      this.controller.props;

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

// The catalog entry: API + tag name + element class
export const statCardComponent: WebComponentImplementation<
  typeof StatCardApi.schema
> = {
  ...StatCardApi,
  tagName: 'a2ui-stat-card',
  element: StatCardElement,
};
```

The renderer registers the element in `customElements` (via `registerUniversalElement`) before rendering a surface, so the `@customElement` decorator is optional. You may keep the `@customElement` decorator if you also use the element outside A2UI.

---

## 3. Register and use in your application

To use `statCardComponent`, add it to a catalog and pass that catalog to your renderer:

=== "Angular"

    Add the component to an `AngularCatalog` and register the catalog with `provideA2Ui`. Set `useUniversalComponents: true` so the renderer mounts Web Component entries (without it they render a placeholder):

    ```typescript
    // app.config.ts
    import {ApplicationConfig} from '@angular/core';
    import {
      AngularCatalog,
      BASIC_COMPONENTS,
      BASIC_FUNCTIONS,
      provideA2Ui,
    } from '@a2ui/angular/v0_9';
    import {statCardComponent} from './stat-card.js';

    export const myCatalog = new AngularCatalog(
      'my-catalog',
      '0.9',
      [...BASIC_COMPONENTS, statCardComponent],
      BASIC_FUNCTIONS,
    );

    export const appConfig: ApplicationConfig = {
      providers: [
        provideA2Ui({
          catalogs: [myCatalog],
          useUniversalComponents: true,
          actionHandler: (action) => console.log('Action:', action),
        }),
      ],
    };
    ```

    Render a surface with `SurfaceComponent`. The custom element never appears in your own templates, so no `CUSTOM_ELEMENTS_SCHEMA` is needed:

    ```typescript
    // app.component.ts
    import {Component} from '@angular/core';
    import {SurfaceComponent} from '@a2ui/angular/v0_9';

    @Component({
      selector: 'app-root',
      standalone: true,
      imports: [SurfaceComponent],
      template: `<a2ui-v09-surface surfaceId="main" />`,
    })
    export class AppComponent {}
    ```

=== "React"

    Add the component to a `Catalog`, create a `MessageProcessor` with it, and render each surface with `A2uiSurface`:

    ```tsx
    import {useEffect, useMemo, useState} from 'react';
    import {Catalog, MessageProcessor, type SurfaceModel} from '@a2ui/web_core/v0_9';
    import {basicCatalog, BASIC_FUNCTIONS} from '@a2ui/web_core/v0_9/basic_catalog';
    import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react/v0_9';
    import {statCardComponent} from './stat-card.js';

    // Register alongside basic components or your own custom library
    export const myCatalog = new Catalog(
      'my-catalog',
      '0.9',
      [...basicCatalog.components.values(), statCardComponent],
      BASIC_FUNCTIONS,
    );

    export function App() {
      const processor = useMemo(
        () =>
          new MessageProcessor<ReactCatalogComponent>([myCatalog], (action) => {
            console.log('Action:', action);
          }),
        [],
      );
      const [surfaces, setSurfaces] = useState<SurfaceModel<ReactCatalogComponent>[]>([]);

      useEffect(() => {
        const created = processor.onSurfaceCreated((surface) =>
          setSurfaces((prev) => [...prev, surface]),
        );
        const deleted = processor.onSurfaceDeleted((id) =>
          setSurfaces((prev) => prev.filter((s) => s.id !== id)),
        );
        return () => {
          created.unsubscribe();
          deleted.unsubscribe();
        };
      }, [processor]);

      return (
        <>
          {surfaces.map((surface) => (
            <A2uiSurface key={surface.id} surface={surface} />
          ))}
        </>
      );
    }
    ```

    You can mix React components and universal components in the same catalog and nest them in any order. React context, error boundaries, and event bubbling continue to work across universal components.

=== "Lit"

    Add the component to a `Catalog`, create a `MessageProcessor` with it, and pass each surface to the `<a2ui-surface>` element:

    ```typescript
    import {html, LitElement} from 'lit';
    import {customElement, state} from 'lit/decorators.js';
    import {Catalog, MessageProcessor, type SurfaceModel} from '@a2ui/web_core/v0_9';
    import {basicCatalog, BASIC_FUNCTIONS} from '@a2ui/web_core/v0_9/basic_catalog';
    import '@a2ui/lit/v0_9';
    import {statCardComponent} from './stat-card.js';

    export const myCatalog = new Catalog(
      'my-catalog',
      '0.9',
      [...basicCatalog.components.values(), statCardComponent],
      BASIC_FUNCTIONS,
    );

    @customElement('my-app')
    export class MyApp extends LitElement {
      private readonly processor = new MessageProcessor([myCatalog], (action) => {
        console.log('Action:', action);
      });

      @state() private surfaces: SurfaceModel[] = [];

      override connectedCallback() {
        super.connectedCallback();
        this.processor.onSurfaceCreated((surface) => {
          this.surfaces = [...this.surfaces, surface];
        });
      }

      override render() {
        return html`
          ${this.surfaces.map(
            (surface) => html`<a2ui-surface .surface=${surface}></a2ui-surface>`,
          )}
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
import {type ResolvedChildList} from '@a2ui/web_core/v0_9/universal';

override render() {
  const children: ResolvedChildList = this.controller.props.children ?? [];

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

`this.renderNode()` resolves the child component from the surface model and renders it with the appropriate catalog implementation, whether it is a basic catalog component, another universal component, or a component written for the host framework (in React, a React component renders into its own host element).

### Two-way data binding for form inputs

For properties defined with dynamic schemas (such as `DynamicStringSchema`, `DynamicNumberSchema`, or `DynamicBooleanSchema`), A2UI automatically generates a typed setter method on `props`. For example, a property named `value` produces `setValue()`, while a property named `checked` produces `setChecked()`.

Calling the setter writes the new value directly back to the bound data model path:

```typescript
override render() {
  const props = this.controller.props;

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

Like any `LitElement`, an `A2uiLitElement` renders into a Shadow Root by default, so its `static styles` are encapsulated. CSS custom properties still inherit through the shadow boundary, which lets the host application theme the component without reaching inside it:

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

If you want the host application's global stylesheet, design system, or utility classes (such as Tailwind or Bootstrap) to apply inside your component, opt into the Light DOM by overriding `createRenderRoot()`. The basic catalog components do this:

```typescript
override createRenderRoot() {
  return this;
}
```

`A2uiLitElement` still applies your `static styles` in the Light DOM: it rewrites `:host` to the element's tag name, scopes the remaining selectors under it, and adopts the resulting stylesheet into the document (or the enclosing shadow root) once per tag.
