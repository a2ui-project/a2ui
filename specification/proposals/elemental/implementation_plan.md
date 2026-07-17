# Implementation plan: A2UI Elemental

This document outlines the plan to implement A2UI Elemental as an experimental feature in the Python Agent SDK and integrate it into the evaluation framework.

---

## Proposed directory structure

We will mirror the structure used by A2UI Express.

```
main/
├── agent_sdks/python/a2ui_agent/src/a2ui/experimental/elemental/
│   ├── __init__.py
│   ├── compiler.py          # Compiles HTML5 to standard A2UI v1.0 JSON
│   ├── decompiler.py        # Decompiles A2UI JSON back to HTML5
│   ├── expression_parser.py # Subclasses core ExpressionParser for JSX-style expressions
│   ├── prompt_generator.py  # Translates catalog schemas to TSX prompt contracts
│   └── parser.py            # Extracts <body> blocks from model completions
│
└── eval/a2ui_eval/strategies/
    └── elemental.py         # Inspect AI solver and evaluation strategy
```

---

## Phase 1: Compiler and decompiler core

We will implement the core translation engines in the Python Agent SDK.

### 1. Parser (`parser.py`)

- Extract the text block between `<body>` and `</body>` (inclusive).
- Strip markdown code block indicators (e.g., ` ```html ` and ` ``` `) if present.
- Raise a clear compilation error if no `<body>` block is found.

### 2. Expression parser (`expression_parser.py`)

- Subclass the core `a2ui.core.basic_catalog.expression_parser.ExpressionParser`.
- Extend it to support:
  - `{...}` expression delimiters instead of `${...}`.
  - **Array literals**: Parse `[...]` containing comma-separated expressions or literals.
  - **Object literals**: Parse `{key: value}` containing key-value pairs. Handle JSX-style double-curly braces `{{...}}` at the attribute level.

### 3. Compiler (`compiler.py`)

- **HTML Parsing**: Use a forgiving HTML parser (like Python's built-in `html.parser.HTMLParser` or `beautifulsoup4`) rather than a strict XML parser. This prevents crashes on unescaped characters (like `<` or `&` inside JSX expressions) and handles unclosed tags.
- **Streaming Scope**: Streaming compilation is out-of-scope for the initial experimental version. The compiler will operate on the complete LLM response. However, using `html.parser.HTMLParser` allows us to leverage its `.feed()` method for incremental parsing in the future.
- **Metadata extraction**: Parse the `id` on `<body>` as `surfaceId`, and the `href` of `<link rel="catalog">` as `catalogId`.
- **Component parsing**: Traverse the DOM tree. Map custom elements (`<a2ui-...>`) to catalog components.
- **ID preservation**: Use the element's `id` attribute if present; otherwise, auto-generate a unique ID.
- **Expression resolution**: Delegate attribute values and text nodes containing `{...}` to `ElementalExpressionParser`.
  - Implement **implicit value injection**: If a validation function's first parameter is `value` (e.g., `required(value)`) and it is omitted in the call, inject the parent component's `value` path.
- **Option auto-expansion**: If the schema expects a list of `{label, value}` objects but the input is an array of strings, automatically expand them.
- **Data model & slot scripts**: Parse `<script type="application/json">` tags:
  - **No `slot` attribute**: Parse as a single JSON object to initialize the `dataModel`.
  - **Has `slot` attribute**: Parse as JSON and assign to the named component property (e.g., `slot="columns"`).
  - Raise a compilation error if the script content is invalid JSON.
- **Adjacency list flattening**: Flatten the parsed DOM tree into the standard A2UI flat components list.

### 4. Decompiler (`decompiler.py`)

- Translate standard A2UI JSON payloads back into A2UI Elemental HTML.
- Decompile components recursively into nested tags, preserving their `id` attributes.
- Represent complex properties and data model initialization using `<script type="application/json">`.
- Format expressions using curly braces (e.g., `{formatCurrency(value: $amount, currency: 'USD')}`).

### 5. Prompt generator (`prompt_generator.py`)

- Read the catalog JSON schema.
- Translate each component definition into a TypeScript/TSX interface (e.g., `interface CardProps`).
- Output these TSX signatures as the prompt contract to be injected into the system prompt.

---

## Phase 2: Agent SDK integration

We will expose the new format under an experimental feature flag.

- Define the environment variable flag: `A2UI_ELEMENTAL_ENABLED = "true"`.
- Expose `ElementalCompiler` and `ElementalDecompiler` in the `a2ui.experimental.elemental` namespace.

---

## Phase 3: Evaluation framework integration

We will integrate the new format into the evaluation pipeline to measure its token efficiency and generation accuracy.

### 1. Create the strategy (`eval/a2ui_eval/strategies/elemental.py`)

- Implement the `a2ui_elemental_prompt()` solver to inject the TSX prompt contract into the system prompt.
- Implement the `compile_elemental_html()` solver to:
  1. Extract and compile the model's HTML completion using `parse_elemental_response`.
  2. Validate the resulting JSON payload against the catalog schema.
  3. Wrap the validated JSON back in `<a2ui-json>` for scoring.
- **Error Recovery**: The micro-refinement loop is an agent/solver-level feature. If compilation fails, the solver can optionally catch the error and trigger a micro-refinement prompt to correct the syntax. This keeps the core compiler deterministic.
- Define the `elemental_solver()` chain:
  ```python
  def elemental_solver() -> list[Solver]:
      return [
          a2ui_elemental_prompt(),
          measured_generate(),
          compile_elemental_html()
      ]
  ```

### 2. Register the strategy (`eval/main.py`)

- Add `"elemental"` as a valid strategy choice in the command-line argument parser.
- Import and register the `elemental` solver when selected.

---

## Phase 4: Verification and testing

- Write unit tests for the compiler and decompiler covering:
  - Nested function parsing and type casting.
  - Implicit value injection.
  - Option object auto-expansion.
  - `<script type="application/json">` parsing (data model vs. slots).
- Run the evaluation suite locally using `--strategies elemental` to verify the end-to-end generation and compilation pipeline.
