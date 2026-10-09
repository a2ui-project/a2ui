# Subskill: CSS Theming, Custom Properties & Styling Architecture

## Activation Criteria

Activate this subskill when:

- PR modifies CSS styles, stylesheet imports, or CSS custom properties (`--a2ui-*`).
- PR adds or modifies style bindings in templates or component elements.

---

## Principles

### 1. Implement Two-Tier CSS Custom Property Overrides with Global Fallbacks

- **Problem & Rationale**: Web components must allow callers to style individual component instances without mutating the global application theme. Hardcoding arbitrary fallbacks (`16px`, `#333`) breaks design system consistency. The canonical pattern provides a component-scoped variable that defaults to a global theme token.
- **Reviewer Checklist**:
  - [ ] Verify that component styles follow the two-tier pattern:
        `var(--a2ui-<component>-<prop>, var(--a2ui-<token>, <default>))`
  - [ ] Do not hardcode arbitrary dimension or color fallbacks when a global spacing or color token exists.

```css
/* BAD: No component override handle; arbitrary fallback */
color: var(--a2ui-text-caption-color, #666);

/* GOOD: Component-specific override -> global theme token -> fallback */
color: var(
  --a2ui-audioplayer-description-color,
  var(--a2ui-text-caption-color, light-dark(#666, #aaa))
);
```

---

### 2. Preserve and Maintain JSDoc Documentation for CSS Custom Properties

- **Problem & Rationale**: CSS custom properties documented in JSDoc blocks (`@cssprop`) are a formal part of the public theming contract. Stripping or omitting these comments during refactorings breaks design system documentation tools and obscures available styling handles.
- **Reviewer Checklist**:
  - [ ] Verify that all supported CSS custom properties on components are documented with `@cssprop` JSDoc comments.
  - [ ] Never strip existing CSS custom property JSDoc blocks during refactorings.

```typescript
/**
 * @cssprop [--a2ui-button-bg=var(--a2ui-color-primary)] - Button background color.
 * @cssprop [--a2ui-button-padding=var(--a2ui-spacing-m)] - Button internal padding.
 */
@customElement('a2ui-button')
export class A2uiButton extends LitElement { ... }
```

---

### 3. Keep Layout Styles in Static Class Stylesheets (Reject Imperative `this.style`)

- **Problem & Rationale**: Writing static styles (such as `this.style.display = 'flex'`, `this.style.gap = '8px'`) imperatively inside `connectedCallback`, `updated`, or `render` cycles creates style thrashing, overrides user CSS, and defeats stylesheet caching.
- **Reviewer Checklist**:
  - [ ] Ensure base layout, display modes, and default gaps reside in `static override styles = css`...``.
  - [ ] Use `this.style` exclusively for dynamic, runtime-computed values (e.g. dynamically calculated coordinates).

---

### 4. Avoid Un-Overridable `width: 100%` on Container and Input Elements

- **Problem & Rationale**: Forcing `width: 100%` on components prevents consumers from laying out components within flex rows, grids, or custom inline containers. Components should naturally adapt to their parent container or provide override handles.
- **Reviewer Checklist**:
  - [ ] Check additions of `width: 100%` on basic components.
  - [ ] Ensure dimensions can be overridden via flex properties or custom properties.
