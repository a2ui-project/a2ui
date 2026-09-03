# Universal Component API (`@a2ui/web_core/v0_9/universal`)

The universal component submodule provides primitives for creating A2UI components as standard W3C Custom Elements using Lit. These components can be registered directly into Lit, React, and Angular A2UI catalogs without framework-specific adapters.

## Exports

- **`A2uiLitElement`**: Abstract base class extending `LitElement`. Provides automatic property binding via `A2uiController`, child node rendering (`renderNode()`), and `static styles` support in the Light DOM (`adoptLightDomStyles()`) for subclasses that opt out of Shadow DOM.
- **`A2uiController`**: Lit `ReactiveController` that connects an element to the A2UI `GenericBinder` and requests element updates when bound properties change.
- **`WebComponentImplementation`**: Type of a catalog entry: a component API (`name`, `schema`) paired with the custom element `tagName` and `element` class.
- **`registerUniversalElement(component)`**: Defines `component.element` under `component.tagName` in `customElements` if it is not defined yet. Renderers call it for every catalog entry before rendering a surface.
- **`isWebComponentImplementation(obj)`**: Type guard to identify `WebComponentImplementation` objects.
- **`renderA2uiNode(context, catalog)`**: Renders a dynamic A2UI node into a Lit `TemplateResult` using the catalog.

## Quick Example

```typescript
import {html, css, nothing} from 'lit';
import {customElement} from 'lit/decorators.js';
import {z} from 'zod';
import {type ComponentApi, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {A2uiLitElement, type WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';

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

  protected override readonly api = MyBadgeApi;

  override render() {
    const text = this.controller.props.text;
    if (!text) return nothing;
    return html`<span>${text}</span>`;
  }
}

export const myBadgeComponent: WebComponentImplementation<typeof MyBadgeApi.schema> = {
  ...MyBadgeApi,
  tagName: 'my-badge',
  element: MyBadgeElement,
};
```

## Catalog Registration

The exported `myBadgeComponent` can be registered directly:

- **In Lit**: `new Catalog('my-catalog', '0.9', [...basicCatalog.components.values(), myBadgeComponent], BASIC_FUNCTIONS)`
- **In React**: `new Catalog('my-catalog', '0.9', [...basicCatalog.components.values(), myBadgeComponent], BASIC_FUNCTIONS)`
- **In Angular**: `new AngularCatalog('my-catalog', '0.9', [...BASIC_COMPONENTS, myBadgeComponent], BASIC_FUNCTIONS)` with `useUniversalComponents: true` in `A2UI_RENDERER_CONFIG`

For the full developer guide and advanced patterns (nested children, user actions, two-way data binding), see [Authoring Universal Components](../../../../../docs/public/guides/authoring-universal-components.md).
