# Programmatic macros and type-safe catalog builders

This proposal describes the design for programmatic macros and type-safe component builders in A2UI.

---

## Summary of codebase changes

The implementation spans five areas of the repository:

| Component                      | Repository path                                                                | Description                                                                                                                                                    |
| :----------------------------- | :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Catalog schema ingestion**   | `renderers/web_core/src/v0_9/catalog/`                                         | Introduces `loadCatalogFromJson()` and `Catalog.fromJson()` to parse raw catalog JSON schemas into typed `ComponentApi` objects with Zod validation.           |
| **Code generation CLI**        | `javascript/a2ui_cli/`                                                         | Implements the `@a2ui/cli` package with commands to analyze catalog schemas and emit single-file Python builder modules with prominent generated-code markers. |
| **Fluent builder foundation**  | `agent_sdks/python/a2ui_agent/src/a2ui/builder/`                               | Implements `ComponentBuilderNode`, data binding helpers, dynamic child lists, and tree flattening with automatic identifier assignment.                        |
| **Generated basic catalog**    | `agent_sdks/python/a2ui_agent/src/a2ui/builder/catalogs/basic/`                | Single-file Python builder classes generated from the standard A2UI basic catalog schema.                                                                      |
| **Macro inference engine**     | `agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/macros/` | Implements the `@macro` decorator, `MacroInferenceFormat`, and `MacroProcessor` to augment prompts, intercept macro calls, and expand trees.                   |
| **Community demo application** | `samples/community/macros/`                                                    | Provides an end-to-end sample application with Python backend server and client UI demonstrating macro invocation and rendering.                               |

---

## End-to-end developer experience

The complete developer workflow consists of four steps: obtaining a catalog, generating type-safe Python builders, defining a macro function, and registering that macro with the agent.

### Step 1: Obtain or author an A2UI catalog

A catalog defines the components and functions supported by client renderers. Catalogs are stored as JSON files conforming to `catalog_definition.json`:

```json
{
  "catalogId": "https://example.com/catalogs/infrastructure.json",
  "components": {
    "ServerStatusBadge": {
      "description": "Displays host status with a badge indicator.",
      "properties": {
        "hostname": {"type": "string"},
        "status": {
          "type": "string",
          "enum": ["online", "degraded", "offline"],
          "default": "online"
        }
      },
      "required": ["hostname"]
    }
  }
}
```

### Step 2: Run code generation via NPM

The developer runs `@a2ui/cli` to generate a single-file Python module containing typed builder classes:

```bash
npx @a2ui/cli codegen \
  --catalog ./catalogs/infrastructure.json \
  --out ./agent/builders/catalogs/infrastructure/infrastructure.py
```

The CLI outputs a complete Python module with dataclasses for each component, `Literal` type aliases for enums, and a clear auto-generated banner and `__a2ui_codegen__` marker at the top.

### Step 3: Author a macro using the builder classes

The developer defines a macro by decorating a standard Python function with `@macro`. Inside the function, the developer uses the generated builder classes to construct the component tree:

```python
from a2ui.builder import Action, ComponentRef
from a2ui.builder.catalogs.basic import (
    Button,
    Card,
    Column,
    Row,
    Text,
)
from a2ui.inference_formats.experimental.macros import macro
from agent.builders.catalogs.infrastructure import ServerStatusBadge

@macro
def HostManagementCard(hostname: str, region: str = "us-central1") -> Card:
    """Display host status with management actions.

    Args:
        hostname: Fully qualified domain name of the host.
        region: Cloud region where the instance is running.
    """
    # Server-side logic: fetch live status directly without exposing tokens to prompt
    current_status = "online"

    return Card(
        child=Column(
            children=[
                Text(text=f"Host: {hostname}", variant="h3"),
                Text(text=f"Region: {region}", variant="caption"),
                ServerStatusBadge(hostname=hostname, status=current_status),
                Row(
                    children=[
                        Button(
                            text="Restart",
                            action=Action(
                                event={
                                    "name": "restart_host",
                                    "payload": {"host": hostname},
                                }
                            ),
                        ),
                        Button(
                            text="View Logs",
                            action=Action(
                                event={
                                    "name": "open_logs",
                                    "payload": {"host": hostname},
                                }
                            ),
                        ),
                    ]
                ),
            ]
        )
    )
```

### Step 4: Register the macro with `MacroInferenceFormat`

The developer registers the macro with `MacroInferenceFormat`, wrapping their chosen base format (such as Express):

```python
from a2ui.inference_formats.experimental.macros import MacroInferenceFormat
from a2ui.inference_formats.express import ExpressInferenceFormat

# Wrap Express format with macro support
macro_format = MacroInferenceFormat(
    base_format=ExpressInferenceFormat(),
    macros=[HostManagementCard],
)

# Attach format to agent instructions or prompt generator
system_instructions = macro_format.get_system_prompt_rules()
```

When the language model generates UI, it emits a compact macro call:

```text
@HostManagementCard(hostname="prod-db-01", region="us-east1")
```

The runtime intercepts this tag, executes `HostManagementCard()`, assigns sequential component identifiers, flattens the node tree, and sends standard A2UI `createSurface` and `updateComponents` payloads to the client renderer.

---

## Component architecture and implementation details

### 1. Catalog schema ingestion (`renderers/web_core`)

#### Implementation details

Historically, catalog schemas in `web_core` were manually declared TypeScript objects. To support external JSON catalogs and schema objects, `renderers/web_core/src/v0_9/catalog/schema_loader.ts` introduces a schema ingestion engine.

The module provides `loadCatalogFromSchema(catalogSchema)`:

- Validates `catalogId` metadata (reading `catalogId`, `$id`, or `id`).
- Inspects `$defs.anyComponent.oneOf` to filter permitted components when specified.
- Maps JSON Schema types (`string`, `integer`, `number`, `boolean`, `array`, `object`) into Zod validator schemas.
- Resolves standard references (`$ref`) against canonical common types (`DynamicString`, `ComponentId`, `Action`, `AccessibilityAttributes`).
- Merges `allOf` schema compositions with top-level properties and performs two-pass resolution for `required` fields.
- Parses function definitions from both array and dictionary formats.
- Returns a complete, schema-only `Catalog<ComponentApi, FunctionApi>` instance.

In `renderers/web_core/src/v0_9/catalog/types.ts`, `Catalog.fromSchema` delegates directly to this loader:

```typescript
static fromSchema(catalogSchema: Record<string, any>): Catalog<ComponentApi, FunctionApi> {
  return loadCatalogFromSchema(catalogSchema);
}
```

#### Rationale

- **Single source of truth:** Loading catalogs directly from schema definitions allows tools and renderers to consume official catalog files without maintaining separate hardcoded schema definitions.
- **Serialization format independence:** Naming the factory `fromSchema` reflects that it ingests parsed JavaScript/TypeScript schema dictionaries, remaining format-agnostic.
- **Separation of concerns:** All JSON Schema parsing and AST transformation resides in `schema_loader.ts`. The `Catalog` class in `types.ts` remains a runtime container without leaking schema transformation details.
- **Encapsulation:** All internal AST helpers in `schema_loader.ts` remain module-private, exposing only `loadCatalogFromSchema`.

---

### 2. TypeScript code generation CLI (`javascript/a2ui_cli`)

#### Implementation details

The `@a2ui/cli` package is a Node.js command-line application located in `javascript/a2ui_cli/`.

The generator consists of two stages:

1. **Catalog analyzer (`src/analyzer/catalog-analyzer.ts`):** Ingests the catalog via `Catalog.fromSchema()` and inspects the Zod schemas of components and functions. It extracts property types, default values, docstrings, enum options, child slots, and required property constraints into a normalized `AnalysedCatalog` data structure.
2. **Python emitter (`src/emitters/python/python-emitter.ts`):** Converts the analyzed catalog into a standalone Python file. It emits:
   - A clear banner comment identifying the file as auto-generated and displaying the catalog ID.
   - An auto-generated docstring note and `__a2ui_codegen__ = "@a2ui/cli"` constant.
   - `Literal[...]` type aliases for string enums.
   - Component builder classes decorated with `@dataclass(kw_only=True)` importing from `a2ui.builder.base`.
   - Function call factory helpers.
   - An explicit `__all__` symbol export list.

The command is executed as:

```bash
npx @a2ui/cli codegen --catalog <catalog_file> --out <output_path>
```

#### Rationale

- **Why implemented in TypeScript:** The authoritative definitions for A2UI schemas and components reside in `@a2ui/web_core`. Implementing the generator in TypeScript allows it to import `@a2ui/web_core` directly, avoiding duplicate JSON Schema parsers in Python or other target languages.
- **Single-file output:** Emitting one self-contained module per catalog avoids nested package directories, simplifies imports in agent applications, and makes catalog regeneration atomic.
- **Keyword-only arguments:** Emitting `@dataclass(kw_only=True)` prevents parameter ordering issues when components combine required properties, optional properties with defaults, and inherited fields.
- **Clear generated code demarcation:** Adding the comment banner and `__a2ui_codegen__` marker prevents developer confusion over which modules are generated versus handwritten.

---

### 3. Python fluent builder API (`agent_sdks/python`)

#### Implementation details

The fluent builder library resides in `agent_sdks/python/a2ui_agent/src/a2ui/builder/`:

- **`base.py`:** Defines the foundational classes and canonical protocol types:
  - `ComponentBuilderNode`: Base class for all component builders. Implements serialization, tree traversal, and child node identification.
  - `ExternalComponentBuilderNode` / `ComponentRef`: Represents a component already existing on the surface, referenced by its string ID.
  - `DataBinding` / `bind()`: Encapsulates two-way client data model paths (`bind("/user/name")`).
  - `DynamicChildList`: Binds an array path to a template component node for repeating collections.
  - `Action`: Represents interactive events with name and payload dictionaries.
  - `CheckRule`: Validation condition and error message definition.
  - `AccessibilityAttributes`: Screen reader attributes (`label`, `description`, `live`, `hidden`).
  - `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, `DynamicValue`: Type aliases for reactive client values accepting literals, `DataBinding`, or `FunctionCall`.
  - `Child`, `ChildList`: Type aliases for single and multi-child slots.
  - `Surface`: Container providing `.to_messages()` to produce `createSurface` and `updateComponents` protocol envelopes.
- **`catalogs/basic/`:** Houses the generated basic catalog classes:
  - `basic.py`: The single-file generated dataclasses and enums.
  - `__init__.py`: Re-exports all components for direct import from `a2ui.builder.catalogs.basic`.

#### Automatic identifier assignment and tree flattening

The A2UI protocol requires flat lists of components with explicit IDs, where parent containers reference children by string identifier. Manually managing IDs in nested Python code is verbose and error-prone.

The builder system automates this in two phases:

1. **ID assignment phase (`assign_ids`):** Recursively traverses the node tree. If a component has an explicit `id` set by the author, that ID is preserved. If omitted, sequential IDs (`comp_0`, `comp_1`, etc.) are assigned automatically.
2. **Serialization and flattening phase (`traverse_and_serialize`):** Serializes each node's properties. Any child `ComponentBuilderNode` referenced by a parent container is replaced by its assigned string ID in the parent's serialized dictionary. All serialized component dictionaries are collected into a flat list.

```python
# Authoring nested structures:
card = Card(child=Text(text="Hello"))

# Automatically serializes to flat A2UI protocol components:
# [
#   {"id": "comp_1", "component": "Text", "text": "Hello"},
#   {"id": "comp_0", "component": "Card", "child": "comp_1"}
# ]
```

#### Rationale

- **Decoupled architecture:** Moving the builder to `a2ui.builder` establishes it as a first-class SDK capability that can be used independently of macros or LLM inference formats.
- **Type safety and autocompletion:** Developers receive instant IDE validation for component property names and enum values.
- **Abstraction of protocol serialization:** Developers author nested UI trees in natural object notation without manually tracking string IDs or building flat component lists.

---

### 4. Macro inference engine and execution lifecycle (`agent_sdks/python`)

#### Implementation details

The macro execution engine resides in `agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/experimental/macros/`:

- **`@macro` decorator (`macro.py`):** Decorates Python functions. It inspects signatures and docstrings to extract:
  - Macro identifier (function name).
  - Parameter types mapped directly to canonical protocol `$defs`:
    - `DynamicString` -> `common_types.json#/$defs/DynamicString`
    - `DynamicNumber` -> `common_types.json#/$defs/DynamicNumber`
    - `DynamicBoolean` -> `common_types.json#/$defs/DynamicBoolean`
    - `DynamicStringList` -> `common_types.json#/$defs/DynamicStringList`
    - `DynamicValue` -> `common_types.json#/$defs/DynamicValue`
    - `Action` -> `common_types.json#/$defs/Action`
    - `CheckRule` -> `common_types.json#/$defs/CheckRule`
    - `AccessibilityAttributes` -> `common_types.json#/$defs/AccessibilityAttributes`
    - `ComponentRef` / `ComponentBuilderNode` -> `common_types.json#/$defs/ComponentId` (child slot)
    - `ChildList` / `Sequence[ComponentBuilderNode]` -> `common_types.json#/$defs/ChildList` (multi-child slot)
    - `Literal[...]` / `Enum` -> Enum JSON schema definitions
  - Parameter descriptions from Google/Sphinx docstrings.
  - Return type annotations.
- **`MacroInferenceFormat` (`format.py`):** Wraps an underlying format (such as `ExpressInferenceFormat`):
  - Injects synthetic macro component schemas into the combined catalog.
  - Appends macro signatures and docstrings to the system prompt rules, exposing typed dynamic parameters to the LLM.
  - Scans model output for macro calls (e.g. `@MacroName(arg="val")`).
  - Passes calls to `MacroProcessor`.
- **`MacroProcessor` (`processor.py`):** Manages registered macro functions:
  - Coerces incoming JSON arguments (string child IDs to `ComponentRef`, path dictionaries to `DataBinding`, event names to `Action`, and accessibility dictionaries to `AccessibilityAttributes`).
  - Invokes the Python function.
  - Flattens the returned `ComponentBuilderNode` tree into standard A2UI `surfaceUpdate` / `updateComponents` messages with invocation-scoped ID namespacing.

#### Rationale

- **Token reduction:** Models output short macro tags instead of multi-line layout scaffolding, reducing generation latency and token usage.
- **Sensitive data isolation:** Backend functions can perform database queries and API calls on the server, injecting confidential data into the UI without placing those values into the model context.
- **Dynamic reactivity:** Supporting the full matrix of `common_types.json` allows LLMs to pass reactive data bindings (`{"path": "/..."}`) directly into macros, which pass them to client renderers for two-way state synchronization.
- **Composable design:** `MacroInferenceFormat` wraps existing inference formats rather than replacing them, allowing macros to work alongside standard Express or direct JSON output.

---

### 5. Community demo application (`samples/community/macros`)

#### Implementation details

The sample application in `samples/community/macros/` provides an end-to-end demonstration:

- **`server.py`:** FastMCP server exposing macro definitions.
- **`macro_definitions.py`:** Defines concrete macros (`EconomicIndicatorCard`, `WeatherCard`, `ServerMetricSummary`) using the generated `a2ui.builder.catalogs.basic` catalog builder classes.
- **Web client:** Runs a client application with Lit and React renderers, verifying that macro expansions render correctly in the browser.

#### Rationale

- Provides a verifiable testbed for macro development.
- Serves as an executable reference implementation for developers building agents with A2UI macros.
