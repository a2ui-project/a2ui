# Universal Component API (`@a2ui/web_core/v0_9/universal`)

The universal component submodule provides primitives for creating A2UI components as standard W3C Custom Elements using Lit. These components can be registered directly into Lit, React, and Angular A2UI catalogs without framework-specific adapters.

## Exports

- **`A2uiLitElement`**: Abstract base class extending `LitElement`. Provides automatic property binding via `A2uiController`, Light DOM style scoping (`adoptLightDomStyles()`), and child node rendering (`renderNode()`).
- **`A2uiController`**: Lit `ReactiveController` that connects an element to the A2UI `GenericBinder` and requests element updates when bound properties change.
- **`createComponentImplementation(api, element)`**: Registers the element in `customElements` (if needed) and returns a `WebComponentImplementation` ready for catalog registration.
- **`renderA2uiNode(context, catalog)`**: Renders a dynamic A2UI node into a Lit `TemplateResult` using the catalog.
- **`isWebComponentImplementation(obj)`**: Type guard to identify `WebComponentImplementation` objects.
- **`WebComponentImplementation`**: Type definition representing a component API paired with a custom element tag name.

## Quick Example

```typescript
import {html, css, nothing} from 'lit';
import {customElement} from 'lit/decorators.js';
import {z} from 'zod';
import {type ComponentApi, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {A2uiLitElement, createComponentImplementation} from '@a2ui/web_core/v0_9/universal';

export const MyBadgeApi = {
  name: 'MyBadge',
  schema: z.object({
    text: DynamicStringSchema,
  }),
} satisfies ComponentApi;

@customElement('my-badge')
export class MyBadgeElement extends A2uiLitElement<typeof MyBadgeApi> {
  static override styles = css`
    :host {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      background: #e0e7ff;
      color: #3730a3;
      font-size: 0.75rem;
    }
  `;

  protected readonly api = MyBadgeApi;

  override render() {
    const text = this.controller.props.text;
    if (!text) return nothing;
    return html`<span>${text}</span>`;
  }
}

export const myBadgeComponent = createComponentImplementation(MyBadgeApi, MyBadgeElement);
```

## Catalog Registration

The exported `myBadgeComponent` can be registered directly:

- **In Lit**: `new Catalog('my-catalog', [...basicCatalog.components.values(), myBadgeComponent])`
- **In React**: `new Catalog('my-catalog', [...basicCatalog.components.values(), myBadgeComponent])`
- **In Angular**: `new AngularCatalog('my-catalog', [...BASIC_COMPONENTS, myBadgeComponent], BASIC_FUNCTIONS)`

For the full developer guide and advanced patterns (nested children, user actions, two-way data binding), see [Authoring Universal Components](../../../../../docs/public/guides/authoring-universal-components.md).
