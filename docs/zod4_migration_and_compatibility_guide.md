# A2UI Zod 4 Migration & Dual-Compatibility Guide

This document summarizes the changes implemented across the A2UI repository to support both **Zod 3.25+** and (experimentally) **Zod 4.0+**, resolving [GitHub Issue #2002](https://github.com/a2ui-project/a2ui/issues/2002).

---

## 1. Overview

Previously, A2UI renderer packages declared `"zod": "^3.25.76"` as a direct dependency. When applications installed a different Zod version, package managers installed duplicate instances of Zod in `node_modules`, causing TypeScript compilation errors:

```text
Type 'z.ZodObject<...>' is not assignable to type 'z.ZodObject<...>'.
Two different types with this name exist, but they are unrelated.
```

To prevent duplicate installations and allow Zod 4:

1. Converted `zod` from a direct dependency to a **peer dependency** (`"^3.25.0 || ^4.0.0"`) across client renderers.
2. Updated schema definitions and inspection helpers to use APIs compatible with both Zod 3 and Zod 4.
3. Added an automated test script (`yarn test:zod-version`) and CI workflow job to verify compatibility across Zod versions.

> [!NOTE]
> Local development dependencies still default to Zod 3.25+. Zod 4 is supported and tested in CI, but is not the default development version, so consider it **experimental** for now.

---

## 2. Package & Dependency Architecture

### 2.1. Breaking Change for Consuming Applications

**Previous Behavior:** `@a2ui/web_core`, `@a2ui/lit`, and `@a2ui/angular` listed `"zod"` under `dependencies`, so package managers automatically installed Zod.

**New Behavior:** Applications must install `zod` explicitly in their root `package.json`:

```json
"dependencies": {
  "zod": "^3.25.6"
}
```

**Impact:** Importing A2UI renderers without declaring `zod` in the application's `package.json` may produce missing peer dependency warnings in strict package managers (npm 7+, pnpm, Yarn Berry), or prevent applications from compiling.

---

## 3. Zod 3 vs Zod 4 API Changes & Remediation

### 3.1. Mandatory Key Schema in `z.record()`

In Zod 4, the single-argument `z.record(valueType)` overload was removed. A key schema must be provided as the first argument: `z.record(keyType, valueType)`. We updated record definitions to declare `z.string()` as the key type:

```diff
-    args: z.record(z.any()).describe('Arguments passed to the function.'),
+    args: z.record(z.string(), z.any()).describe('Arguments passed to the function.'),
```

**Files Updated:**

- [common-types.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/common-types.ts#L31)
- [client-to-server.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/schema/client-to-server.ts#L32)
- [mcp-app.ts](https://github.com/a2ui-project/a2ui/blob/main/samples/community/client/angular/projects/mcp_calculator/src/a2ui-catalog/mcp-app.ts#L361)

### 3.2. Removal of Private `_def` Schema Inspection

In Zod 4, the internal schema structure was changed and `_def.typeName` was removed. We replaced internal `_def` scraping in [generic-binder.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/rendering/generic-binder.ts) with `getZodTypeName()` and `unwrapSchema()`, which use standard `instanceof` checks and public schema methods (`unwrap()`, `removeDefault()`).

### 3.3. Generic Variance in `zod-to-json-schema`

Because `zod-to-json-schema` is typed against Zod 3's `ZodType<any, ZodTypeDef, any>`, passing a Zod 4 schema causes TypeScript generic variance errors. We added explicit `as any` type casting when calling `zodToJsonSchema(api.schema as any, ...)` in [message-processor.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/processing/message-processor.ts#L105).

### 3.4. Stricter Record Value Inference (`unknown` vs `any`)

Zod 4 infers values from `z.record(z.string(), z.any())` as `unknown` rather than `any`. When extracting arguments from records in [data-context.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/rendering/data-context.ts#L107), we added type casts (`this.resolveDynamicValue(argVal as any)`) to satisfy method signatures.

> [!NOTE]
> These type casts can be removed once Zod 3 support is dropped.

### 3.5. `ZodError` Issue Structure in Unit Tests

Zod 4 changed internal issue properties on `ZodIssueCode.invalid_type`. When constructing synthetic mock errors in [data-context.test.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/rendering/data-context.test.ts#L301), we added explicit `as any` casting so tests compile under both versions.

### 3.6. `ZodTypeAny` Parse Return Type Covariance

In Zod 3, calling `.parse()` on a variable typed as `z.ZodTypeAny` returned `any`. In Zod 4, `z.ZodTypeAny` is typed as `ZodType<unknown, ...>`, so `.parse()` returns `unknown`. When passing parsed arguments to `fn.execute(args: Record<string, any>, ...)` in [types.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/catalog/types.ts#L179), we added a type cast (`const safeArgs = fn.schema.parse(rawArgs) as Record<string, any>`).

### 3.7. Unwrapping `ZodPipe` / `ZodEffects` for `zod-to-json-schema`

In Zod 3, `.superRefine(...)` created a `ZodEffects` wrapper. In Zod 4, it creates a `ZodPipe` wrapper (storing the inner schema on `_def.in`). Because `zod-to-json-schema` (v3.25.2) does not unwrap Zod 4 pipes, passing refined schemas caused it to emit an empty schema `{}`.

To strip effect and pipe wrappers across both versions, we implemented the `unwrapForJsonSchema()` helper in [zod-utils.ts](https://github.com/a2ui-project/a2ui/pull/2135/files).

### 3.8. Dual-Compatible JSON Schema Generation (`z.toJSONSchema` vs `zod-to-json-schema`)

In Zod 3, schema verification tests and `MessageProcessor` used the `zod-to-json-schema` package (v3.25.2). This library inspects Zod 3's `_def.typeName` property and emits `{}` for Zod 4 schemas.

Zod 4 includes native JSON Schema generation via `z.toJSONSchema()`. To support both versions, we created `zodToJsonSchema()` in [zod-utils.ts](https://github.com/a2ui-project/a2ui/pull/2135/files), which delegates to Zod 4's native exporter (`zod4ToJsonSchema`) or the Zod 3 library (`zod3ToJsonSchema`).

The Zod 4 implementation uses `z.registry()` (`reg.add(defSchema, { id })`) to register sub-definitions and applies `inlineGeneratedRefs` to collapse synthetic anonymous references (`__shared`, `schema0`) into inline object schemas.

### 3.9. Decoupling `.d.ts` Interface Boundaries via `ObjectSchema` Splitting

In Zod 3, `.superRefine(...)` returns a `ZodEffects` schema. When exported interfaces extended types inferred from refined schemas, TypeScript emitted Zod 3 internal generic parameters into `.d.ts` files. When consuming packages compiled against Zod 4, `z.infer` failed to reconcile these parameters, degrading inferred types to `unknown` or `{}`.

#### The `ObjectSchema` Splitting Pattern

To prevent `ZodEffects` generics from leaking into declaration files, we separated base object schemas from refined validation schemas:

1. **Unrefined `*ObjectSchema`**: Defined using `z.object({...})` without refinements. Used with `z.infer<typeof XObjectSchema>` for TypeScript interface declarations:
    ```typescript
    export interface StringValue extends z.infer<typeof StringValueObjectSchema> {
      [key: string]: any;
    }
    ```
2. **Refined `*Schema`**: Created by applying `.superRefine(...)` or `.extend(...)` to `*ObjectSchema`. Used at runtime for payload validation.

> [!IMPORTANT]
> Composite schemas (such as `CheckboxSchema` or `MultipleChoiceSchema`) also require an unrefined `*ObjectSchema` so that `z.infer` does not propagate `ZodEffects` generic parameters from child schemas.

**Files Updated:**

- [common-types.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_8/schema/common-types.ts#L127-L345)
- [primitives.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_8/types/primitives.ts#L18-L34)
- [components.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_8/types/components.ts#L40-L244)

### 3.10. Generic Constraint Compatibility in Angular (`ZodTypeAny` Inference in Zod 4)

In [types.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/angular/src/v0_9/core/types.ts), `ComponentApi` defines `Schema extends z.ZodTypeAny`. In Zod 3, `z.infer<z.ZodTypeAny>` evaluates to `any`. In Zod 4, it evaluates to `unknown`, which failed Angular's `{ [key: string]: unknown }` constraint on `ExtendedProps`:

```text
error TS2344: Type 'output<Api["schema"]>' does not satisfy the constraint '{ [key: string]: unknown; }'.
```

We updated `ExtendedProps` in [types.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/angular/src/v0_9/core/types.ts#L84) to remove the `{ [key: string]: unknown }` constraint:

```diff
-export type ExtendedProps<ComponentProps extends {[key: string]: unknown}> =
+export type ExtendedProps<ComponentProps> =
    'checks' extends keyof ComponentProps ? ComponentProps & CheckProps : ComponentProps;
```

### 3.11. Google Closure Compiler ADVANCED Mode Externs (`_zod` and Minification)

In Google Closure Compiler ADVANCED mode under Zod 4, Angular Explorer bundles crashed with:

```text
TypeError: Cannot read properties of undefined (reading 'fe')
```

Zod 4 initializes internal state on `schema._zod`. Closure Compiler minified `._zod` to `.g` and `.traits` to `.fe` when accessed via dot notation. To prevent property renaming, we declared Zod 4 properties in [zod4.externs.js](https://github.com/a2ui-project/a2ui/pull/2135/files), registered in [apply-closure-compiler.mjs](https://github.com/a2ui-project/a2ui/blob/main/renderers/angular/a2ui_explorer/scripts/closure-compiler/apply-closure-compiler.mjs#L134) when Zod 4 is detected.

### 3.12. Hardened Shape Access via `getObjectShape` Helper

In Zod 4, `.shape` is defined lazily using getters. Under Google Closure Compiler ADVANCED mode, accessing `Schema.shape` directly can evaluate to `undefined`.

We introduced the `getObjectShape(schema)` helper in [zod-utils.ts](https://github.com/a2ui-project/a2ui/pull/2135/files) and updated references in [basic_components.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/basic_catalog/components/basic_components.ts) and [generic-binder.ts](https://github.com/a2ui-project/a2ui/blob/main/renderers/web_core/src/v0_9/rendering/generic-binder.ts) to use `getObjectShape(Schema)` instead of `Schema.shape`.

### 3.13. Action Payload Property Protection (`timestamp`)

Client actions validated against `A2uiClientActionSchema` include a `timestamp` field. In ADVANCED minification builds, `timestamp` was renamed because it was missing from externs. We added `timestamp` to `ActionExterns` in [a2ui_web_core_v0_9.externs.js](https://github.com/a2ui-project/a2ui/blob/main/renderers/angular/a2ui_explorer/scripts/closure-compiler/externs/a2ui_web_core_v0_9.externs.js).

---

## 4. Testing

To verify compatibility without duplicating module instances in `node_modules`, we created a version-agnostic test runner at [scripts/test-zod-version.mjs](https://github.com/a2ui-project/a2ui/pull/2135/files).

### Running Locally

Test all renderers against a specific Zod version with:

```bash
yarn test:zod-version --version="^4.0.0"
# or
yarn test:zod-version --version="^3.25.0"
```

**How it works:**

1. Overrides `"resolutions": { "zod": "<target_version>" }` in root [package.json](https://github.com/a2ui-project/a2ui/blob/main/package.json).
2. Runs `yarn install` to link the target version and builds `@a2ui/web_core`.
3. Runs tests across `@a2ui/web_core`, `@a2ui/lit`, `@a2ui/react`, and `@a2ui/angular`.
4. Restores the original Zod resolution, runs `yarn install`, and rebuilds `@a2ui/web_core` in a `try/finally` block.

### CI Integration (GitHub Actions)

Because Zod 3.25 is tested during standard CI execution (`ci-renderers`), we added a dedicated Zod 4 compatibility check job (`ci-renderers-zod4`) in [.github/workflows/web_ci.yml](https://github.com/a2ui-project/a2ui/blob/main/.github/workflows/web_ci.yml).
