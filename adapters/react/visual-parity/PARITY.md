# Visual Parity: Lit and React Renderers

This document describes the approach used to achieve visual parity between the Lit (Shadow DOM) and React (Light DOM) renderers.

## Structural Mirroring

### The Challenge

Lit components use Shadow DOM, where each component has an encapsulated DOM tree with its own scoped styles. The typical structure is:

```
#shadow-root
  <section class="theme-classes">
    <slot></slot>    ← children projected here
  </section>
```

The shadow host element (the custom element itself) acts as the `:host` and can have its own styles.

React uses Light DOM where everything exists in the global DOM. To achieve parity, we mirror Lit's two-element structure.

### The Solution

Each React component renders a wrapper div (representing `:host`) plus a section (the internal element):

```tsx
// React component structure
<div className="a2ui-card">
  {' '}
  {/* ← :host equivalent */}
  <section className="theme-classes">
    {' '}
    {/* ← internal element */}
    {children} {/* ← ::slotted(*) equivalent */}
  </section>
</div>
```

This mirroring allows CSS selectors to target the same conceptual elements in both renderers.

## CSS Selector Transformation

### Shadow DOM to Light DOM

Lit's Shadow DOM selectors need transformation for React's global CSS:

| Lit (Shadow DOM)       | React (Light DOM)                                 |
| ---------------------- | ------------------------------------------------- |
| `:host`                | `.a2ui-surface .a2ui-{component}`                 |
| `section`              | `.a2ui-surface .a2ui-{component} section`         |
| `::slotted(*)`         | `.a2ui-surface .a2ui-{component} section > *`     |
| `element` (e.g., `h2`) | `:where(.a2ui-surface .a2ui-{component}) element` |

### Example: Card Component

Lit's card.ts static styles:

```css
:host {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

section {
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: auto;
}

section ::slotted(*) {
  height: 100%;
  width: 100%;
}
```

React's componentSpecificStyles equivalent:

```css
.a2ui-surface .a2ui-card {
  display: block;
  flex: var(--weight);
  min-height: 0;
  overflow: auto;
}

.a2ui-surface .a2ui-card section {
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: auto;
}

.a2ui-surface .a2ui-card section > * {
  height: 100%;
  width: 100%;
}
```

## CSS Specificity Matching

### The Problem

Shadow DOM provides natural style encapsulation with low specificity. A selector like `h2` inside Shadow DOM has specificity `(0,0,0,1)`.

In React's global CSS, we need contextual selectors to scope styles:

```css
.a2ui-surface .a2ui-text h2 { ... }
```

This has specificity `(0,0,2,1)` — much higher than Lit's `(0,0,0,1)`.

### Why It Matters

Utility classes like `.typography-w-500` have specificity `(0,0,1,0)`. In Lit:

- `h2 { font: inherit; }` = `(0,0,0,1)` — loses to utility class
- `.typography-w-500` = `(0,0,1,0)` — **wins**, font-weight: 500 applied

In React (without fix):

- `.a2ui-surface .a2ui-text h2 { font: inherit; }` = `(0,0,2,1)` — **wins**
- `.typography-w-500` = `(0,0,1,0)` — loses, font-weight reset to 400

### The Solution: `:where()`

The `:where()` pseudo-class has zero specificity contribution. Wrapping contextual selectors in `:where()` matches Lit's low specificity:

```css
/* Before: specificity (0,0,2,1) — too high */
.a2ui-surface .a2ui-text h1,
.a2ui-surface .a2ui-text h2 { ... }

/* After: specificity (0,0,0,1) — matches Lit */
:where(.a2ui-surface .a2ui-text) h1,
:where(.a2ui-surface .a2ui-text) h2 { ... }
```

Now utility classes can override element resets, just like in Lit.

### When to Use `:where()`

Use `:where()` when the Lit component has element selectors that should be overridable by utility classes:

- **Use `:where()`**: Element resets like `h1, h2 { font: inherit; }`
- **Don't use `:where()`**: Structural styles on `:host` or `section` that define component behavior

## File Organization

- **`../src/styles/index.ts`**: Contains `structuralStyles` (from Lit) and `componentSpecificStyles` (React-specific)
- **`../src/components/`**: Component files that render the mirrored structure with appropriate class names
- **`injectStyles()`**: Injects both structural and component-specific styles into the document
- **`./fixtures/`**: Test fixtures for visual parity testing
- **`./tests/`**: Playwright test specs

## Troubleshooting

### Vite Cache Issues (504 Outdated Optimize Dep)

If you see errors like:

```
Failed to load resource: the server responded with a status of 504 (Outdated Optimize Dep)
Uncaught TypeError: Failed to fetch dynamically imported module
```

This happens when Vite's dependency optimization cache becomes stale, typically after:

- Switching git branches
- Updating dependencies
- Rebuilding the React renderer

**Fix:** Clear the Vite cache and restart:

```bash
# From renderers/react/visual-parity/
rm -rf node_modules/.vite react/node_modules/.vite lit/node_modules/.vite ../node_modules/.vite
npm run dev:react  # or dev:lit
```

### React Renderer Changes Not Picked Up

If you edit files in `renderers/react/src/` but the visual parity app doesn't reflect the changes, this is because the visual parity app imports from the **built** `@a2ui/react` package, not directly from source.

**Why this happens:**

1. Source changes are in `renderers/react/src/`
2. Visual parity app imports from `@a2ui/react/styles` (workspace package)
3. Vite pre-bundles workspace dependencies into `node_modules/.vite`
4. The pre-bundled cache still has the old built version

**Fix:** Rebuild the package and clear Vite's cache:

```bash
# From renderers/react/visual-parity/

# 1. Rebuild the React renderer
cd ../
npm run build

# 2. Clear Vite cache and restart
cd visual-parity
rm -rf react/node_modules/.vite node_modules/.vite
npm run dev:react
```

**Note:** Vite's HMR works for changes _within_ the visual parity app, but changes to workspace dependencies require rebuilding + cache clearing.

## Testing Parity

This directory contains the visual parity test suite:

```bash
# Run all tests
npm test

# Run specific component tests
npm test -- --grep "button"

# Run dev servers for manual inspection
npm run dev
```

The tests:

1. Load the same fixture in both Lit (localhost:5002) and React (localhost:5001)
2. Take screenshots of both renderers
3. Compare pixel differences using pixelmatch
4. Fail if difference exceeds 1%

See [README.md](./README.md) for detailed usage instructions.

## Component CSS Checklist

Each Lit component with `static styles` needs a corresponding entry in `componentSpecificStyles`. Below is the complete list with implementation status:

### ✅ Implemented (0% pixel diff in visual parity tests)

| Component          | Lit File             | Styles                                   | Notes                                                                                                                               |
| ------------------ | -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Card**           | `card.ts`            | `:host`, `section`, `::slotted(*)`       | Uses `> section` child combinator                                                                                                   |
| **Text**           | `text.ts`            | `:host`, `h1-h5` (uses `:where()`)       | Paragraph margin reset added                                                                                                        |
| **Divider**        | `divider.ts`         | `:host`, `hr`                            | Added margin to match browser default                                                                                               |
| **TextField**      | `text-field.ts`      | `:host`, `input`, `label`, `textarea`    | Uses `:where()` for element selectors. Multiline support added                                                                      |
| **Button**         | `button.ts`          | `:host`                                  | Simple display/flex                                                                                                                 |
| **Icon**           | `icon.ts`            | `:host`                                  | Simple display/flex                                                                                                                 |
| **Column**         | `column.ts`          | `:host`, `section`, attribute selectors  | Uses `data-alignment` and `data-distribution`                                                                                       |
| **Row**            | `row.ts`             | `:host`, `section`, attribute selectors  | Uses `data-alignment` and `data-distribution`                                                                                       |
| **List**           | `list.ts`            | `:host`, `section`, `::slotted(*)`       | All fixtures pass 0% including cards inside lists                                                                                   |
| **Image**          | `image.ts`           | `:host`, `img`                           | Uses `:where()` for `img`. All usage hints pass 0%                                                                                  |
| **Slider**         | `slider.ts`          | `:host`, `input[type="range"]`           | Uses `:where()` for `input`. Basic slider passes 0%                                                                                 |
| **Tabs**           | `tabs.ts`            | `:host`, `section`, `button`             | All fixtures pass 0%                                                                                                                |
| **CheckBox**       | `checkbox.ts`        | `:host`, `input`                         | Uses `:where()` for `input`. Works via path binding                                                                                 |
| **DateTimeInput**  | `datetime-input.ts`  | `:host`, `input`                         | Uses `:where()` for `input`. React uses HTML5 inputs directly                                                                       |
| **Modal**          | `modal.ts`           | `:host`, `dialog`, `#controls`, `button` | Renders dialog in place (no portal) to stay inside `.a2ui-surface`. Matches Lit: closed shows section with entry, open shows dialog |
| **Video**          | `video.ts`           | `:host`, `video`                         | Uses `:where()` for `video`. Minor pixel variance (~0.5%) due to native video element rendering                                     |
| **AudioPlayer**    | `audio.ts`           | `:host`, `audio`                         | Uses `:where()` for `audio`. Note: Lit does NOT implement `description` property                                                    |
| **MultipleChoice** | `multiple-choice.ts` | `:host`, `select`                        | Uses `:where()` for `select`. Both renderers use `<select>` dropdown                                                                |

### ⚠️ Lit Renderer Issues

| Component          | Lit File             | Issue                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Slider**         | `slider.ts`          | Value does not update when slider moves                                                                                                                                                                                                                                                                             |
| **Divider**        | `divider.ts`         | Ignores `axis` property - always renders same orientation                                                                                                                                                                                                                                                           |
| **CheckBox**       | `checkbox.ts`        | Uses `.value` instead of `.checked` (line 100), so checked state only displays correctly when using path binding. Using `literalBoolean` with `false` causes component to not render. Visual parity tests pass using path binding.                                                                                  |
| **DateTimeInput**  | `datetime-input.ts`  | Uses `getMonth()` which is 0-indexed (0-11) without adding 1, causing issues in January and one month off otherwise. Also parses all values through `new Date()` constructor which does not accept time-only strings. React uses HTML5 inputs directly as they match A2UI format.                                   |
| **MultipleChoice** | `multiple-choice.ts` | `<option>` tag has a bug: renders value as attribute name (`<option ${value}>`) instead of `value` attribute (`<option value=${value}>`). Also unconditionally accesses `selections.path` without checking if it exists, so `literalArray` selections don't work. Has a leftover `console.log` in `#setBoundValue`. |

### Special Cases

| Component   | Notes                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| **Surface** | Root component with different structure; doesn't use `structuralStyles` |
| **Root**    | Internal component, styles handled differently                          |

## Implementation Hints

### Attribute Selectors (Column, Row, List)

Lit uses `:host([attribute="value"])` for attribute-based styling. In React, use data attributes:

```tsx
// React component
<div className="a2ui-column" data-alignment={alignment} data-distribution={distribution}>
```

```css
/* componentSpecificStyles */
.a2ui-surface .a2ui-column[data-alignment='center'] section {
  align-items: center;
}
```

### CSS Variables (Image)

Pass CSS variables via inline style:

```tsx
// React component
<div className="a2ui-image" style={{ '--object-fit': fit }}>
```

```css
/* componentSpecificStyles — use :where() so utility classes (e.g. layout-el-cv) can override */
:where(.a2ui-surface .a2ui-image) img {
  object-fit: var(--object-fit, fill);
}
```

### Nested Selectors (Modal)

For complex nested styles, maintain the hierarchy:

```css
/* Lit */
dialog section #controls button { ... }

/* React componentSpecificStyles */
.a2ui-surface .a2ui-modal dialog section #controls button { ... }
```

### Form Elements

Form inputs already have some shared styles. Component-specific overrides use `:where()` so theme utility classes can override them:

```css
/* DateTimeInput specific — :where() keeps specificity at (0,0,1) to match Lit's bare `input` selector */
:where(.a2ui-surface .a2ui-datetime-input) input {
  border-radius: 8px;
  padding: 8px;
  border: 1px solid #ccc;
}
```
