# Subskill: Component Lifecycle, Reactive Purity & Performance

## Activation Criteria

Activate this subskill when:

- PR modifies reactive state: Angular signals (`signal()`, `computed()`, `effect()`, `input()`, `input.required()`, `Signal<T>`), React state (`useState`, `useRef`, `useEffect`), or Lit reactive properties.
- PR modifies component lifecycle hooks (`connectedCallback`, `ngOnInit`, `componentDidMount`).
- PR touches template loops (`*ngFor`, `@for`, Lit `repeat`, React `.map()`).

---

## Principles

### 1. Keep Reactive Primitives (`computed()` Signals & State Setters) Strictly Pure

- **Problem & Rationale**: Angular `computed()` signals and React state setter callbacks must remain pure projection functions. Triggering side effects (such as service registration, event bus subscription, DOM mutation, or model instantiation/disposal) inside a computed signal or state setter causes repeated executions, memory leaks, and erratic re-render cycles.
- **Reviewer Checklist**:
  - [ ] Verify that Angular `computed()` functions do NOT call methods that mutate external state. Move side effects to constructor `effect()` or lifecycle hooks.
  - [ ] Verify that React state setter functions do NOT instantiate or dispose resources. Use `useRef` and `useEffect` for lifecycle resource management.

```typescript
// FORBIDDEN: Side effect inside Angular computed signal
readonly dataModel = computed(() => {
  const model = this.sourceModel();
  this.bus.register(model); // Side effect!
  return model;
});

// CORRECT: Pure computation; side effect moved to constructor effect
readonly dataModel = computed(() => this.sourceModel());
constructor() {
  effect(() => {
    const model = this.dataModel();
    this.bus.register(model);
  });
}
```

---

### 2. Prefer Signal-Based Inputs and Explicit `Signal<T>` Base Contracts in Angular

- **Problem & Rationale**: Mixing legacy `@Input()` decorators with signal-based state forces imperative `ngOnChanges` synchronization and breaks fine-grained reactivity.
- **Reviewer Checklist**:
  - [ ] Prefer `input()` and `input.required()` over the legacy `@Input()` decorator in Angular components and directives.
  - [ ] When defining abstract reactive properties in base classes, type them explicitly as `Signal<T>` to enforce reactivity across subclasses.

---

### 3. Zero Inline Closure Allocations in Render Loops

- **Problem & Rationale**: Allocating helper closures (such as item key extractors, `trackBy` functions, or event handlers) inline within template `render()` loops allocates new function references on every render cycle. This defeats virtual DOM / directive diffing and triggers unnecessary child element recalculations.
- **Reviewer Checklist**:
  - [ ] Search for arrow functions or function declarations inside `render()` or loop blocks (e.g. `repeat(items, (item) => ...)`).
  - [ ] Hoist key extractors and non-capturing callbacks to private class methods or static module-level helpers.

```typescript
// BAD: getKey function recreated on every render call
override render() {
  const getKey = (child: ChildNode) => child.id;
  return html`${repeat(this.children, getKey, (child) => this.renderChild(child))}`;
}

// GOOD: Private class method referenced statically
private getKey(child: ChildNode): string {
  return child.id;
}
override render() {
  return html`${repeat(this.children, this.getKey, (child) => this.renderChild(child))}`;
}
```

---

### 4. Decompose Complex Conditional Logic and Divergent Branches into Dedicated Private Methods

- **Problem & Rationale**: Monolithic methods that interleave divergent branch execution (such as Angular component vs. Web Component initialization, multi-format data normalization, or complex event handling) within nested `if/else` ladders create cognitive overload and obscure lifecycle bugs.
- **Reviewer Checklist**:
  - [ ] Identify complex conditional logic in setup, lifecycle, resolution, or rendering methods.
  - [ ] Extract distinct branches into named private helper methods (e.g., `setupAngularComponent()`, `setupWebComponent()`).
