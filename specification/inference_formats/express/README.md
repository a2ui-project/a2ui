# A2UI Express Inference Format

**A2UI Express** is an official, token-efficient declarative syntax and compiler pipeline for Large Language Models (LLMs) generating Agent-to-User Interfaces (A2UI).

It acts as an intermediate, highly compressed notation designed for both on-device models (e.g. Gemma 4 E2B/E4B) and cloud LLMs (e.g. Gemini 2.5/3.1). A host-side parser and compiler validates and translates this syntax into standard A2UI wire protocol JSON messages (`createSurface`, `updateComponents`, `updateDataModel`).

---

## Rationale & Motivation

Standard A2UI wire messages are formatted as verbose JSON envelopes. While JSON is optimal for cross-platform client rendering and schema validation, LLMs produce significant overhead when generating raw JSON:

- **Excessive Token Consumption**: Repetitive structural keys, quotes, braces, brackets, and envelope wrappers inflate output token counts.
- **Higher Latency**: LLM generation latency scales directly with the number of output tokens emitted.
- **Context Window Pressure**: Small on-device models have constrained memory and context limits, making verbose JSON prompts and completions expensive.
- **Syntax Errors**: Deeply nested JSON braces and brackets are prone to truncation and syntax errors during streaming.

**A2UI Express solves these challenges** by introducing a streamlined, functional programming-like notation tailored for LLMs.

---

## Performance Impact

Across standard component benchmarks and catalog examples:

| Metric                  | Direct JSON          | A2UI Express             | Improvement                      |
| :---------------------- | :------------------- | :----------------------- | :------------------------------- |
| **Output Token Count**  | 850 – 1,400 tokens   | 280 – 480 tokens         | **55% – 70% reduction**          |
| **Generation Latency**  | 1.8s – 3.2s          | 0.6s – 1.2s              | **~2.5x faster**                 |
| **Prompt Overhead**     | Full JSON Schema     | Positional Signatures    | **~60% smaller prompt contract** |
| **Streaming Viability** | Chunked JSON parsing | Line-oriented statements | Immediate incremental evaluation |

---

## Architecture & Pipeline

The Express pipeline consists of five stages:

```
┌─────────────────────────────────┐
│ 1. Component Catalog Schema    │
└────────────────┬────────────────┘
                 │ (CatalogSchemaHelper)
                 ▼
┌─────────────────────────────────┐
│ 2. Positional Signatures Prompt │
└────────────────┬────────────────┘
                 │ (PromptGenerator)
                 ▼
┌─────────────────────────────────┐
│ 3. LLM Generation (<a2ui>...</>)│
└────────────────┬────────────────┘
                 │ (ANTLR Lexer / Parser)
                 ▼
┌─────────────────────────────────┐
│ 4. AST Visitor & Normalization  │
└────────────────┬────────────────┘
                 │ (ExpressCompiler)
                 ▼
┌─────────────────────────────────┐
│ 5. Standard A2UI Wire JSON      │
│    createSurface / update...    │
└─────────────────────────────────┘
```

1. **Prompt Contract Generation**: `ExpressPromptGenerator` compiles component schemas from an `A2uiCatalog` into concise positional signatures (e.g. `Text(text, variant?, color?)`).
2. **Model Output**: The model generates concise Express DSL statements enclosed in `<a2ui>` and `</a2ui>` sentinel tags.
3. **Parsing**: The ANTLR-generated lexer and parser (`Express.g4`) tokenizes and constructs the parse tree.
4. **Compilation**: `ExpressCompiler` walks the AST, resolves data paths, normalizes properties and types against the catalog schema, and builds standard A2UI component trees.
5. **Wire Payloads**: The output is emitted as standard A2UI v1.0 or v0.9.1 messages ready for any standard A2UI client renderer.

---

## Key Syntax Features

- **Sentinel Tags**: Layouts are enclosed in `<a2ui>` and `</a2ui>` to separate UI definitions from conversational text.
- **Variable Declarations**: Every component is assigned to a variable or nested inline. A reserved variable `root` serves as the surface entrypoint:
  ```text
  <a2ui>
  title = Text("Flight Status", variant="h1")
  root = Card(children=[title])
  </a2ui>
  ```
- **Positional & Keyword Arguments**: Positional arguments follow catalog signatures; keyword arguments allow explicit property specification or skipping optional arguments.
- **Data Binding**: Bound paths are prefixed with `$`:
  - `$/path/to/key` for absolute paths against the root data model.
  - `$relative` for paths resolved within iteration contexts.
- **Data Model Initialization**: Direct assignments to absolute paths populate the surface data model:
  ```text
  $/user/name = "Alice"
  $/user/role = "Admin"
  ```
- **Templates**: Dynamic list templates use the `_template(path, templateComponent)` helper.
- **Raw Strings**: Prefixed with `r"..."` or `r"""..."""` for regex patterns and unescaped strings.

For complete grammar and technical details, see the [A2UI Express Technical Specification](a2ui_express.md) and [ANTLR Grammar (Express.g4)](Express.g4).

---

## Python SDK Usage

Install or depend on `a2ui-agent-sdk`:

```python
from a2ui.inference_formats.express import ExpressFormat, ExpressCompiler, ExpressParser
from a2ui.basic_catalog import BasicCatalog

# 1. Initialize format with a catalog
catalog = BasicCatalog.get_catalog(version="v1.0")
format_strategy = ExpressFormat(catalog=catalog, surface_id="main", version="v1.0")

# 2. Generate model system instructions
system_prompt = format_strategy.prompt_generator.generate(
    role_description="You are a flight status assistant.",
    include_schema=True,
    include_examples=True,
)

# 3. Compile Express DSL into standard A2UI JSON
compiler = ExpressCompiler(catalog=catalog, surface_id="main", version="v1.0")
messages = compiler.compile("""<a2ui>
title = Text("Welcome to A2UI", "h1")
root = Card(child=title)
</a2ui>""")

# 4. Decompile standard A2UI JSON back to Express DSL
parser = ExpressParser(catalog=catalog, surface_id="main", version="v1.0")
dsl_output = parser.decompile(messages)
```

---

## CLI Developer Tools

Standalone developer scripts are available under `scripts/`:

### Compile DSL to JSON

```bash
uv run scripts/run_compiler.py path/to/sample.a2ui --surface-id "main"
```

### Decompile JSON to DSL

```bash
uv run scripts/run_decompiler.py path/to/example.json
```

### Generate Prompt Signatures

```bash
uv run scripts/run_prompt_generator.py --catalog ../../v1_0/catalogs/basic/catalog.json
```

### Run Model Inference & Validation

```bash
export GEMINI_API_KEY="your-api-key"
uv run scripts/run_inference.py ../../v1_0/catalogs/basic/examples/01_flight-status.json --model gemini-3.1-flash-lite
```

### Recreate Documentation Examples

```bash
uv run scripts/recreate_dsl_examples.py
```

---

## Documents & Specifications

- [Express Technical Specification](a2ui_express.md)
- [ANTLR Grammar (Express.g4)](Express.g4)
- [DSL Examples & Prompt Contract](express_dsl_examples.md)
- [Surface Design Patterns](create_surface_design.md)
- [Feature Blueprint](../../../blueprints/features/express_inference_format.blueprint.md)
