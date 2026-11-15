# Universal Component API (`@a2ui/web_core/v0_9/universal`)

The universal component submodule provides primitives for creating A2UI components as standard W3C Custom Elements using Lit. These components can be registered directly into Lit, React, and Angular A2UI catalogs without framework-specific adapters.

## Exports

- **`A2uiLitElement`**: Abstract base class extending `LitElement` that renders into the Light DOM by default (`createRenderRoot()` returns `this`). Provides automatic property binding via `A2uiController`, child node rendering (`renderNode()`), and `static styles` support in the Light DOM (`adoptLightDomStyles()`). Subclasses that require Shadow DOM encapsulation can override `createRenderRoot()` to return `this.attachShadow({mode: 'open'})`.
- **`A2uiController`**: Lit `ReactiveController` that connects an element to the A2UI `GenericBinder` and requests element updates when bound properties change.
- **`WebComponentImplementation`**: Type of a catalog entry: a component API (`name`, `schema`) paired with the custom element `tagName` and `element` class.
- **`registerUniversalElement(component)`**: Defines `component.element` under `component.tagName` in `customElements` if it is not defined yet. Renderers call it for every catalog entry before rendering a surface.
- **`isWebComponentImplementation(obj)`**: Type guard to identify `WebComponentImplementation` objects.
- **`renderA2uiNode(context, catalog)`**: Renders a dynamic A2UI node into a Lit `TemplateResult` using the catalog.

## Quick Example

```typescript
import {html, css, nothing} from 'lit';
import {customElement} from 'lit/decorators.js';
import {createAjvValidator} from '@a2ui/validator-ajv';
import {fromJsonSchema} from '@a2ui/web_core';
import {type ComponentApi, type DynamicString} from '@a2ui/web_core/v0_9';
import {A2uiLitElement, type WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';

const validator = createAjvValidator();

export const MyBadgeApi = {
  name: 'MyBadge',
  // A JSON Schema that references the v0.9 common types. The schema's
  // documents are passed with it; `commonTypes` and `envelopeCatalog` are the
  // v0.9 `common_types.json` and a `catalog.json` that declares `anyFunction`.
  schema: fromJsonSchema<{text: DynamicString}>(
    {
      type: 'object',
      properties: {text: {$ref: 'common_types.json#/$defs/DynamicString'}},
      required: ['text'],
    },
    validator,
    {defs: {'common_types.json': commonTypes, 'catalog.json': envelopeCatalog}},
  ),
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

The exported `myBadgeComponent` can be registered directly, next to the basic catalog's components (`basic = createBasicCatalog(validator)` from `@a2ui/web_core/v0_9/basic_catalog`):

- **In Lit**: `basic.derive({catalogId: 'my-catalog', components: [...basic.components.keys(), myBadgeComponent]})`
- **In React**: `basic.derive({catalogId: 'my-catalog', components: [...basic.components.keys(), myBadgeComponent]})`
- **In Angular**: `new AngularCatalog('my-catalog', '0.9', [...BASIC_COMPONENTS, myBadgeComponent], BASIC_FUNCTIONS)` with `useUniversalComponents: true` in `A2UI_RENDERER_CONFIG`

For the full developer guide and advanced patterns (nested children, user actions, two-way data binding), see [Authoring Universal Components](../../../../../../docs/site/src/content/docs/guides/authoring-universal-components.mdx).
