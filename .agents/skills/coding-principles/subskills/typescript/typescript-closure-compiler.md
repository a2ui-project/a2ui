# Subskill: TypeScript Rigor, Strict Typing & Minification Interoperability

## Activation Criteria

Activate this subskill when:

- PR modifies TypeScript files (`*.ts`, `*.tsx`), type definitions, generic parameters, or conditional types.
- PR touches Angular dynamic template bindings (`*ngComponentOutlet`, `[inputs]`), protocol-derived dictionaries (`this.props()['...']`), or catalog key mappings.
- PR touches code subject to advanced minification or property renaming (such as Google Closure Compiler).
- PR adds or removes JSDoc annotations that affect declaration emit (`@internal`, `@deprecated`) on exported symbols.

---

## Principles

### 1. Preserve Quoted Object/Template Keys and Use Bracket Notation for Dynamic Properties (`TS4111`)

- **Problem & Rationale**: When code is compiled under advanced minifiers with property renaming enabled (such as Google Closure Compiler), unquoted object property names, dynamic template binding keys (`inputs: {'props': props()}`), and dotted accesses on dynamic protocol dictionaries (`this.props().variant`) get mangled into shortened identifiers (`inputs: {a: props()}`). This breaks dynamic component instantiation, reflection, and JSON-payload deserialization at runtime.
- **Rules**:
  - **Preserve Quoted Keys**: If an object property or template binding key is already quoted, keep it quoted. Never unquote keys during formatting sweeps or refactorings, and add an inline comment explaining why quoting is required.
  - **Bracket Notation on Index Signatures (`TS4111`)**: When accessing properties from a dynamic protocol-derived object or index signature (such as `this.props()` in catalog components), always use bracket notation (e.g., `this.props()['variant']`). This satisfies `noPropertyAccessFromIndexSignature` (`TS4111`) and prevents property renaming during minification.
- **Reviewer Checklist**:
  - [ ] Audit dynamic template bindings (`inputs: {'props': ...}`) and catalog dictionaries.
  - [ ] Flag any PR that strips quotes from object keys or dictionary bindings, and require an inline comment (e.g. `// Quoted to prevent property renaming during minification`).
  - [ ] Verify dynamic protocol dictionary accesses use bracket notation (`this.props()['variant']`).

```typescript
// BROKEN: Minifiers rename 'props' to 'a', breaking runtime input binding
[inputs] =
  // SAFE & DOCUMENTED: Quoted keys survive renaming; intent is documented for future readers
  // Quoted to prevent property renaming during minification:
  '{ props: props(), surfaceId: surfaceId() }'[inputs] =
    "{ 'props': props(), 'surfaceId': surfaceId() }";

// SAFE: Bracket notation on dynamic protocol properties satisfies TS4111 and minifiers
const variant = this.props()['variant'];
```

---

### 2. Place JSDoc `@deprecated` Annotations Directly on Export Specifiers (TS #53754)

- **Problem & Rationale**: Per [microsoft/TypeScript#53754](https://github.com/microsoft/TypeScript/issues/53754), placing a JSDoc `/** @deprecated */` block above an `export { ... } from` statement does NOT attach deprecation metadata to individual re-exported symbols in the TypeScript Language Server or IDE tooltips. Deprecations must be attached directly above each individual identifier inside the export clause.
- **Reviewer Checklist**:
  - [ ] When re-exporting deprecated symbols in barrel files, verify that `/** @deprecated ... */` is placed immediately above each identifier inside `{ ... }`.

```typescript
// WRONG: TypeScript language server will NOT surface deprecations to callers
/** @deprecated Import from `@a2ui/web_core/v0_9/basic_catalog` instead. */
export {injectBasicCatalogStyles, computeColorVariant} from './basic_catalog/styles/default.js';

// CORRECT: JSDoc attached directly to each individual exported identifier
export {
  /** @deprecated Import from `@a2ui/web_core/v0_9/basic_catalog` instead. */
  injectBasicCatalogStyles,
  /** @deprecated Import from `@a2ui/web_core/v0_9/basic_catalog` instead. */
  computeColorVariant,
} from './basic_catalog/styles/default.js';
```

---

### 3. Discriminate Arrays with `Array.isArray()` Before Checking `typeof === 'object'`

- **Problem & Rationale**: In JavaScript and TypeScript, `typeof [] === 'object'`. Checking `typeof val === 'object' && val !== null` without first verifying `Array.isArray(val)` mistakenly routes arrays into object-processing branches, breaking schema parsers, child binders, and validator logic.
- **Reviewer Checklist**:
  - [ ] Verify that all runtime type-checking and schema-parsing logic checks `Array.isArray()` before checking `typeof val === 'object'`.

```typescript
// BUG: Arrays are objects; array payloads fall into the wrong branch
if (typeof val === 'object' && val !== null) {
  return processObject(val); // Arrays execute this branch erroneously!
}

// CORRECT: Explicit array discrimination first
if (Array.isArray(val)) {
  return processArray(val);
}
if (typeof val === 'object' && val !== null) {
  return processObject(val);
}
```

---

### 4. Use Distributive Conditional Types to Preserve Strict `null` and `undefined`

- **Problem & Rationale**: Wrapping union types in naive non-distributive conditional types or blanket `NonNullable<T>` constructs can unintentionally collapse `null` or `undefined` into `never`, preventing child resolution and bound properties from handling nullable fields. Distributive conditional types evaluate each constituent of a union independently.
- **Reviewer Checklist**:
  - [ ] Audit utility types resolving models or properties.
  - [ ] Ensure conditional types distribute over unions to preserve `null` and `undefined`.

```typescript
// DONT: Non-distributive type collapses null to never
type ResolveProp<T> = [T] extends [ChildNode] ? T : never;
type Test = ResolveProp<ChildNode | null>; // Resolves to: never (null swallowed!)

// DO: Distributive conditional type evaluates each union member individually
type ResolvePropDistributive<T> = T extends ChildNode ? T : T extends null | undefined ? T : never;
type Result = ResolvePropDistributive<ChildNode | null>; // Resolves to: ChildNode | null
```

---

### 5. Eliminate `as any`, Enforce Strict Null Checks, and Remove Unused Imports (`TS6133`)

- **Problem & Rationale**: Using `as any` silences the compiler, masks API drift, and hides breaking changes during refactorings. Similarly, unhandled nullable values and leftover unused imports cause strict compiler builds (`noUnusedLocals` / `TS6133`) to fail.
- **Reviewer Checklist**:
  - [ ] Forbid `as any` across all production code; in test code, use explicit interface types or strongly typed mocks.
  - [ ] Guard nullable values explicitly (`if (this.surfaceId)`) before passing them to APIs expecting non-null strings or objects.
  - [ ] Remove all unused imports after refactoring to prevent `TS6133` build errors.

---

### 6. Never Mark `@internal` on Symbols Referenced by Other Packages (`.d.ts` Declaration Stripping)

- **Problem & Rationale**: Downstream declaration bundlers (such as `tsickle` or `stripInternal` TypeScript builds) strip symbols annotated with `/** @internal */` from emitted `.d.ts` declarations. If another package imports, extends, or transitively references that symbol in its inferred return types, the compiler can no longer name it and fails with `TS4023: Exported variable has or is using name '...' from external module but cannot be named`.
- **Rule of Thumb**: `@internal` is only safe for symbols that never appear, directly or transitively, in the public type surface. A base class that downstream packages extend (for example `BasicCatalogA2uiLitElement`) is part of the public type surface even when it is not meant to be instantiated directly.
- **Alternative**: Keep the symbol exported without `@internal` and document in prose that it is an implementation detail subject to change.
- **Reviewer Checklist**:
  - [ ] Flag any new `/** @internal */` on an exported class, interface, or type.
  - [ ] Verify no other package imports or extends the annotated symbol, including through inferred return types and generic constraints.
  - [ ] Prefer a JSDoc prose note over `@internal` for base classes and mixins intended for extension.

```typescript
// BROKEN: Declaration bundlers strip @internal from .d.ts files, so downstream packages
// that extend this class fail with TS4023.
/** @internal */
export abstract class BasicCatalogA2uiLitElement<T> extends LitElement { ... }

// SAFE: Symbol survives declaration extraction; the constraint is stated in prose.
/**
 * Shared base class for basic catalog elements.
 *
 * Implementation detail: prefer the concrete catalog elements. This class is
 * exported without `@internal` because other packages extend it, and the
 * annotation would strip it from emitted `.d.ts` declarations.
 */
export abstract class BasicCatalogA2uiLitElement<T> extends LitElement { ... }
```

---

### 7. Use `readonly` for Class Properties That Are Not Reassigned

- **Problem & Rationale**: Marking class properties that hold signals, inputs, injected services, or static configuration as `readonly` prevents accidental reassignment of the reference itself (for example overwriting a `Signal` instance instead of calling `.set()`).
- **Reviewer Checklist**:
  - [ ] Mark class properties initialized to `input()`, `signal()`, `computed()`, `inject()`, or constant fields with the `readonly` modifier.

```typescript
export class MyComponent {
  readonly myInput = input<string>();
  readonly myState = signal(0);
  readonly myDerived = computed(() => `${this.myInput()}-${this.myState()}`);
  private readonly myService = inject(MyService);
}
```
