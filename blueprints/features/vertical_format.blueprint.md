---
feature_name: vertical_format
module_blueprints:
  - a2ui_agent
dependencies: []
date_added: 2026-09-29
---

# **Vertical Format Feature Blueprint**

This document specifies the language-agnostic architecture, API contracts, grammar rules, and behavioral conformance requirements for the **Vertical Inference Format** (`VerticalFormat`) in the A2UI ecosystem across protocols `v0.9`, `v0.9.1`, and `1.0`.

---

## **1. Motivation & Problem Statement**

In many A2UI integrations (such as chat interfaces, inline assistant cards, notifications, and widget dashboards), the model only needs to emit a single domain component or a flat sequence of non-nested components.

Standard inference formats like **Express** and **Direct JSON** require significant ceremony:

- Express requires explicit variable assignments (`root = ...`), surface declarations (`surface("main")`), and container wrapping (`Column(...)`, `Row(...)`).
- Smaller language models (such as on-device edge models like Gemma 2B) frequently struggle with variable planning and container hierarchy, leading to omitted root assignments, container hallucination, and syntax errors.
- Deep nested containers increase prompt token overhead and internal model reasoning tokens.

The **Vertical format** solves these challenges by providing a concise, Python-constructor-like syntax (`ComponentName(key=val, ...)`) designed specifically for flat, non-nested UI generation.

---

## **2. Architecture & Design Principles**

### **A. Surface-per-Component Multi-Component Model**

When multiple components are emitted sequentially in a single Vertical block:

1. Each component constructor maps to its own independent Surface (`main`, `main_1`, `main_2`, ...) with `id: "root"`.
2. In A2UI `1.0` (and later), each component compiles to a single `createSurface` message carrying inline `components`. In `v0.9` / `v0.9.1`, it compiles to `createSurface` followed by `updateComponents`.
3. Layout container components (such as `Column` or `List`) are **not** injected or required.
4. The renderer host displays these surfaces sequentially as independent tiles or cards in the conversation stream.

### **B. Container Pruning in System Prompts**

To maximize model reliability and minimize token overhead:

1. `VerticalPromptGenerator` inspects the active component catalogs and filters out all components that require children (`Child`, `ChildList`, or `ComponentId` properties).
2. This eliminates container concepts from the system prompt, preventing models from hallucinating nested layouts or complex hierarchy.

### **C. Catalog-Driven Schema Coercion**

Smaller LLMs frequently output numeric or boolean values enclosed in quotes (e.g. `temperature="58"`, `inStock="true"`) or with string decorations (`"+10.9%"`).

1. The compiler dynamically introspects the catalog schema (resolving `$ref` definitions and `anyOf` unions).
2. If a property expects a number, integer, or boolean, string representations are safely coerced into native primitive values.
3. Data-binding expressions (`$/...`) and event/function actions are strictly preserved and never coerced into primitives.

### **D. A2UI v1.0 Protocol Capabilities**

Vertical supports every A2UI `1.0` feature applicable to standalone, non-nested UI generation:

1. **Wire Directives**: Compiles `$path` bindings to `{"@path": "/..."}` (`{"path": "/..."}` in `v0.9.x`) and nested function calls to `{"@call": "fn", "args": {...}}` (`"call"` in `v0.9.x`), keeping plain `path` and `call` keys inside map literals as user data.
2. **Actions**: Supports `Event("name", key=val, userMessage=...)` (with `userMessage` in `1.0+`) and `functionCall` actions (`action=openUrl("...")`).
3. **Multi-Catalog Support**: Accepts `Sequence[CatalogApi]`. With multiple catalogs in `1.0+`, omits `createSurface.catalogId`, stamps `catalogId` on compiled components and function calls, and requires `catalogId="..."` when shared names collide across catalogs.
4. **Component Extensions & Checks**: Supports `extensions={...}` (`metadata.extensions` with UAX #31 key validation in `1.0+`) and `?check(...)` validation rules on checkable standalone inputs.
5. **Standalone Renderer Function Calls**: Compiles top-level calls to declared catalog functions into `callRendererFunction` envelopes in `1.0+`.

### **E. Progressive Real-Time Streaming**

1. `VerticalResponseStream` (`Parser.open_stream`) tokenizes incoming chunks, matches `<a2ui>` / `<a2ui-vertical>` sentinel tags, and tracks `is_in_block` and `RendererState`.
2. As each component constructor call completes in the token stream, it is compiled, validated against `RendererState`, and emitted immediately as an `A2uiPart`.
3. Subsequent components stream to their own surfaces incrementally, providing instant time-to-first-render.

---

## **3. Syntax Specification**

### **A. Enclosing Sentinels**

Vertical payloads must be enclosed in opening and closing sentinel tags:

```
<a2ui>
ComponentName(param1="value1", param2=123)
</a2ui>
```

Alternatively, `<a2ui-vertical>` is accepted for explicit format targeting.

### **B. Constructor Invocations**

Every statement is a direct constructor or standalone function call:

```
ComponentName(arg1, arg2, key1=val1, key2=val2)
```

- **Positional Arguments**: Mapped to properties according to `positionalIndex` (when present) and schema definition order.
- **Named Arguments**: Assigned via `key=val` or `key: val` syntax.
- **Primitive Types**: Supports strings (`"..."`, `'...'`, `"""..."""`, `r"..."`), numbers (`42`, `3.14`), booleans (`true`, `false`), and `null`.
- **Data Binding**: Dynamic paths are prefaced with `$` (e.g. `$/user/name`).
- **Events & Actions**: Action triggers use `Event("eventName", key=val, userMessage=...)`, function calls (`openUrl("...")`), or shorthand action strings.

---

## **4. SDK Interface Contract**

Each client language SDK implementing Vertical format must expose:

1. `VerticalFormat(catalogs, examples, allowed_messages, surface_id, version)` and `VerticalFormatFactory`: Concrete strategy and factory implementing `InferenceFormat` / `InferenceFormatFactory`.
2. `VerticalParser(catalogs, surface_id, version)`: Stateless parser implementing `Parser` (`compile`, `decompile`, `wrap`, `unwrap`, `parse_response`, `open_stream`).
3. `VerticalCompiler(catalogs, surface_id, version)`: Permissive compiler handling statement splitting, healing, multi-catalog resolution, and schema coercion.
4. `VerticalDecompiler(catalogs, version)`: Converts wire JSON messages back to canonical Vertical syntax.
5. `VerticalPromptGenerator`: Implements `PromptGenerator` hooks (`catalogs`, `generate_base_rules`, `generate_catalog_instructions`, `generate_examples`) with container child-pruning.
6. `VerticalResponseStream`: Real-time chunk tokenizer and `ResponseStream` implementation.

---

## **5. Specifications & Conformance Suites**

- **Technical Protocol RFC**: [`specification/inference_formats/vertical/a2ui_vertical.md`](../../specification/inference_formats/vertical/a2ui_vertical.md)
- **Grammar & DSL Examples**: [`specification/inference_formats/vertical/vertical_examples.md`](../../specification/inference_formats/vertical/vertical_examples.md)
- **ANTLR4 Grammar**: [`specification/inference_formats/vertical/Vertical.g4`](../../specification/inference_formats/vertical/Vertical.g4)
- **Shared Conformance Test Suites**: [`conformance/agent/vertical/`](../../conformance/agent/vertical/)
