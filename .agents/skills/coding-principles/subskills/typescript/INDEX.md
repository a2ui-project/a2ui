# TypeScript & Web Progressive Discovery Router

Use this router whenever a pull request or local change modifies TypeScript, JavaScript, CSS, or HTML files across `typescript/`, `renderers/`, `samples/client/{lit,angular,react}/`, or `tools/`.

---

## Evaluate TypeScript & Web Subskill Triggers

Inspect the TypeScript and web files in `git diff main --stat` and read only the subskill documents below whose activation criteria match your changes:

### 1. TypeScript Rigor, Strict Typing & Minification Interoperability

- **Document**: [`typescript-closure-compiler.md`](typescript-closure-compiler.md)
- **Activate if**:
  - Any TypeScript file (`*.ts`, `*.tsx`) is added or modified.
  - Dynamic template bindings (`*ngComponentOutlet`, `[inputs]`) or protocol-derived dictionaries (`this.props()['...']`, `Record<string, ...>`) are touched.
  - Component or service class properties (`input()`, `signal()`, `computed()`, `inject()`) are declared.
  - Deprecations, conditional types, strict null checks, or type assertions (`as ...`) are present.
  - JSDoc annotations affecting declaration emit (`@internal`, `@deprecated`) are added to exported symbols.
  - Runtime code performs object parsing or schema discrimination (`Array.isArray()`).

### 2. Component Lifecycle, Reactive Purity & Performance

- **Document**: [`reactive-lifecycle-performance.md`](reactive-lifecycle-performance.md)
- **Activate if**:
  - Reactive state is used: Angular signals (`signal()`, `computed()`, `effect()`, `input()`, `input.required()`, `Signal<T>`), React hooks (`useState`, `useRef`, `useEffect`), or Lit reactive properties.
  - Component lifecycle methods (`connectedCallback`, `ngOnInit`, `componentDidMount`) are modified.
  - Template loops or repetition directives (`repeat`, `@for`, `*ngFor`, `.map()`) are used.

### 3. CSS Theming, Custom Properties & Styling Architecture

- **Document**: [`css-theming-styling.md`](css-theming-styling.md)
- **Activate if**:
  - CSS styles, style blocks, or `--a2ui-*` CSS custom properties are added or edited.
  - Component JSDoc blocks documenting `@cssprop` are touched.
  - Layout dimensions, display modes, or gap properties are modified.

### 4. Accessibility (a11y) & Semantic HTML

- **Document**: [`accessibility-semantics.md`](accessibility-semantics.md)
- **Activate if**:
  - HTML templates or JSX elements are added or modified.
  - Interactive controls (buttons, inputs, dialogs, dropdowns, choice pickers) are touched.
  - Accessibility attributes (`aria-*`, `role`, `tabindex`, `alt`) are added or edited.

### 5. Testing Rigor & DOM Test Environment Isolation

- **Document**: [`testing-isolation.md`](testing-isolation.md)
- **Activate if**:
  - Any unit test (`*.test.ts`, `*.spec.ts`), integration test, mock setup, or test fixture is added or modified.
  - Catalog component implementations are modified (verify adjacent unit tests exist and cover all component primitives).

### 6. TypeScript Public API AST Inspection (`ts-morph`)

- **Document**: [`references/inspecting-typescript-public-api.md`](references/inspecting-typescript-public-api.md)
- **Activate if**:
  - Any `index.ts`, `public-api.ts`, `package.json` (`exports`), or `ng-package.json` is modified in `@a2ui/web_core`, `@a2ui/angular`, `@a2ui/lit`, `@a2ui/react`, or `@a2ui/a2ui_agent`.
  - Exported symbols or re-export barrels are added, renamed, or removed and require AST-level verification between base and head.
