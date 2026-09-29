---
feature_name: vertical_format
module_blueprints:
  - a2ui_agent
dependencies: []
date_added: 2026-09-29
---

# **Vertical Format Feature Blueprint**

This document specifies the language-agnostic architecture, API contracts, grammar rules, and behavioral conformance requirements for the **Vertical Inference Format** (`VerticalFormat`) in the A2UI ecosystem.

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
1. Each component constructor maps to its own independent Surface (`main`, `main_1`, `main_2`, ...).
2. Layout container components (such as `Column` or `List`) are **not** injected or required.
3. The renderer host displays these surfaces sequentially as independent tiles or cards in the conversation stream.

### **B. Container Pruning in System Prompts**
To maximize model reliability and minimize token overhead:
1. `VerticalPromptGenerator` inspects the active component catalog and filters out all components that require children (`child`, `children`, or `ChildList` properties).
2. This eliminates container concepts from the system prompt, preventing models from hallucinating nested layouts or complex hierarchy.

### **C. Catalog-Driven Schema Coercion**
Smaller LLMs frequently output numeric or boolean values enclosed in quotes (e.g. `temperature="58"`, `inStock="true"`) or with string decorations (`"+10.9%"`).
1. The compiler dynamically introspects the catalog schema (resolving `$ref` definitions and `anyOf` unions).
2. If a property expects a number, integer, or boolean, string representations are safely coerced into native primitive values.
3. Data-binding expressions (`$/...`) and event actions are strictly preserved and never coerced into primitives.

### **D. Progressive Real-Time Streaming**
1. The streaming parser tokenizes incoming chunks and matches opening/closing `<a2ui>` (or `<a2ui-vertical>`) sentinel tags.
2. As each component constructor call is completed in the token stream, it is compiled and emitted immediately as a pair of `createSurface` and `updateComponents` `ResponsePart` events.
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
Every statement is a direct constructor call:
```
ComponentName(arg1, arg2, key1=val1, key2=val2)
```
- **Positional Arguments**: Mapped to properties according to the catalog's `positionalIndex` schema annotations.
- **Named Arguments**: Assigned via `key=val` or `key: val` syntax.
- **Primitive Types**: Supports strings (`"..."`, `'...'`), numbers (`42`, `3.14`), booleans (`true`, `false`), and `null`.
- **Data Binding**: Dynamic paths are prefaced with `$` (e.g. `$/user/name`).
- **Events**: Action triggers are expressed via `Event("eventName", context={...})` or shorthand action strings.

---

## **4. SDK Interface Contract**

Each client language SDK implementing Vertical format must expose:
1. `VerticalFormat(catalog, surface_id, version)`: Concrete strategy implementing `InferenceFormat`.
2. `VerticalParser(catalog, surface_id, version)`: Implements `Parser` contract (`compile`, `decompile`, `wrap`, `unwrap`, `parse_response`).
3. `VerticalCompiler(catalog, surface_id, version)`: Permissive AST compiler handling statement splitting, healing, and schema coercion.
4. `VerticalDecompiler(catalog, surface_id, version)`: Converts wire JSON messages back to clean Vertical syntax.
5. `VerticalPromptGenerator(catalog, version)`: Generates concise system prompt rules with container child-pruning.
6. `VerticalStreamParser(surface_id, version)`: Real-time chunk tokenizer and streaming parser.
