# Subskill: Accessibility (a11y) & Semantic HTML

## Activation Criteria

Activate this subskill when:

- PR adds or updates HTML templates, interactive elements, forms, cards, icons, or buttons.
- PR modifies accessibility attributes (`aria-*`, `role`, `alt`, `tabindex`).

---

## Principles

### 1. Attach `role="region"` to Generic Containers with Accessibility Labels

- **Problem & Rationale**: Per WAI-ARIA guidelines, screen readers ignore `aria-label` and `aria-describedby` on generic `<div>` containers unless the element possesses an explicit landmark role. Containers such as `Card` must render `role="region"` whenever accessibility labels are attached.
- **Reviewer Checklist**:
  - [ ] Check components rendering `aria-label` or `aria-labelledby` on `<div>` elements.
  - [ ] Ensure `role="region"` is dynamically bound when an accessibility label is present.

---

### 2. Reference Target Element IDs with `aria-describedby` (Never Pass Raw Strings)

- **Problem & Rationale**: `aria-describedby` accepts a space-separated list of DOM element IDs, NOT raw descriptive text. Passing text strings causes screen readers to look for nonexistent element IDs, rendering descriptions silent.
- **Reviewer Checklist**:
  - [ ] Verify that `aria-describedby` binds to the `id` of an actual rendered element in the DOM.
  - [ ] For multi-item error validation, place the ID on the container wrapper rather than duplicating identical IDs across a loop.

---

### 3. Use Nullish Coalescing (`??`) to Preserve Explicit Empty Strings (`alt=""`)

- **Problem & Rationale**: Using logical OR (`||`) treats empty string `""` as falsy, replacing it with fallback text. For images and icons, `alt=""` is the standard attribute value indicating a decorative image that must be ignored by screen readers. Replacing it with fallback text creates unwanted auditory noise.
- **Reviewer Checklist**:
  - [ ] Use `??` instead of `||` when resolving text attributes, `alt` text, and ARIA labels.
  - [ ] Coalesce absent ARIA attributes to `null` (or `nothing` in Lit) so template binders omit the attribute rather than outputting empty attributes.

```typescript
// WRONG: Empty string "" is falsy; decorative images get undesired fallback text
const altText = image.accessibility?.label || image.description || 'Image';

// CORRECT: Nullish coalescing preserves intentional empty string ""
const altText = image.accessibility?.label ?? image.description ?? '';
```

---

### 4. Guard Focus Restoration on Initial Mount

- **Problem & Rationale**: Dialogs, dropdowns, or modals that manage focus must not trigger focus restoration logic when first mounted in a closed or hidden state. Stealing focus on page load disrupts keyboard navigation and screen reader users.
- **Reviewer Checklist**:
  - [ ] Ensure focus restoration checks an `isMounted` or `hasInteracted` guard before attempting to restore focus to previously active elements.
