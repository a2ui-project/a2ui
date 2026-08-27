# System design: A2UI typesafe API generator and synthetic components

## Context and design goals

A2UI Synthetic Components allow developers to define reusable, composite UI components programmatically in backend programming languages (starting with Python, followed by TypeScript, Dart, and Kotlin). These synthetic components publish their interfaces into the component catalog alongside primitive components, enabling LLMs to generate structured, compact UI invocations while delegating detailed layout rendering and data calculations to backend code.

To support this capability and provide a clean authoring experience for both synthetic components and direct (non-agent) A2UI payloads, this document details the system design for the **A2UI Typesafe API Generator**.

The design meets five core objectives:

- **Python implementation first**: Deliver a complete, idiomatic Python generator and runtime foundation that supports synthetic components and direct payload authoring.
- **Cross-language transferability**: Structure the generator architecture so that future language backends (TypeScript, Dart, Kotlin, Swift) share the core schema analysis logic rather than duplicating it.
- **Multi-version protocol support**: Handle structural differences across A2UI protocol versions (v0.9.1, v1.0, and future v1.1) with strict compile-time type safety.
- **Zero-setup standard developer experience**: Pre-bundle generated APIs for official catalogs (Basic and Minimal) directly within SDK packages, reserving the CLI generator for custom enterprise catalogs.
- **Decoupled intermediate contract**: Use the authoritative A2UI JSON wire format as the boundary contract, allowing different builder styles (constructors, fluent builders, TSX) to coexist without tying the runtime engine to a single class hierarchy.

---

## Architecture overview

The typesafe API generator uses a three-tier architecture that separates schema ingestion from language-specific code emission:

```
+--------------------------------------------------------------------------------+
| Tier 1: Schema Ingestion & Normalization                                       |
| - Resolves JSON Schema $ref pointers (internal and external common_types.json) |
| - Normalizes v0.9.1 allOf chains and v1.0 direct schemas                       |
| - Extracts semantic types (Child, ChildList, DynamicString, Action, enums)     |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| Tier 2: Normalized Catalog Intermediate Representation (CatalogIR)             |
| - Language-agnostic data model: ComponentDefIR, PropertyIR, FunctionDefIR      |
| - Clean property types: primitive, dynamic, enum, child_slot, action           |
+--------------------------------------------------------------------------------+
                                       |
        +------------------------------+------------------------------+
        |                              |                              |
        v                              v                              v
+-----------------------+      +-----------------------+      +-----------------------+
| Tier 3a: Python       |      | Tier 3b: TypeScript   |      | Tier 3c: Dart /       |
| Emitter               |      | Emitter (Future)      |      | Kotlin (Future)       |
| - Typed dataclasses   |      | - Typed interfaces    |      | - Widget constructors |
| - Literal enums       |      | - TSX factories       |      | - DSL builders        |
| - to_json() protocol  |      | - to_json() protocol  |      | - to_json() protocol  |
+-----------------------+      +-----------------------+      +-----------------------+
```

### Component boundaries

1. **Schema Ingestion Engine**: Loads catalog JSON schemas from a local file or URL, parses the schema AST, resolves `$ref` references to common types, and normalizes version-specific constructs into uniform component definitions.
2. **CatalogIR (Intermediate Representation)**: A clean, language-agnostic data structure that holds normalized component definitions, property metadata, catalog functions, enum values, and documentation. Emitters consume only `CatalogIR`, insulating them from JSON Schema syntax details.
3. **Language Emitters**: Pluggable code generation backends. Each backend receives a `CatalogIR` instance and emits formatted source files adhering to the idioms of the target programming language.
4. **Runtime Core (`a2ui-core`)**: A lightweight, zero-dependency library providing base interfaces (`ComponentNode`, `DataBinding`, `Action`, `FunctionCall`), tree flattening algorithms, and surface-level ID allocation. Generated code imports only this runtime core.

---

## The normalized catalog intermediate representation (CatalogIR)

To share code and logic across multiple language targets, all schema dereferencing, version normalization, and semantic type detection occur in a single ingestion pass that outputs `CatalogIR`.

### CatalogIR data structures

The intermediate representation consists of straightforward data classes:

```python
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional, Sequence


class PropertyKind(str, Enum):
    PRIMITIVE = "primitive"  # str, int, float, bool
    DYNAMIC = "dynamic"  # DynamicString, DynamicNumber, DynamicBoolean, DynamicValue
    ENUM = "enum"  # string with enum values
    CHILD = "child"  # single child component reference
    CHILD_LIST = "child_list"  # sequence of child components or dynamic binding
    ACTION = "action"  # server event or client function
    DATA_BINDING = "data_binding"  # DataBinding object
    OBJECT = "object"  # arbitrary dictionary
    ARRAY = "array"  # primitive list


@dataclass
class PropertyIR:
    name: str
    kind: PropertyKind
    target_type: str  # e.g. "str", "int", "bool", "Any", or enum type name
    required: bool
    description: Optional[str]
    default_value: Optional[Any]
    enum_values: Sequence[str] = ()


@dataclass
class ComponentDefIR:
    name: str
    catalog_id: str
    description: Optional[str]
    properties: Sequence[PropertyIR]
    is_container: bool
    supports_checks: bool


@dataclass
class FunctionArgIR:
    name: str
    arg_type: str
    required: bool
    description: Optional[str]


@dataclass
class FunctionDefIR:
    name: str
    description: Optional[str]
    return_type: str  # "string", "number", "boolean", "array", "object"
    args: Sequence[FunctionArgIR]


@dataclass
class CatalogIR:
    catalog_id: str
    protocol_version: str
    title: str
    description: Optional[str]
    components: Sequence[ComponentDefIR]
    functions: Sequence[FunctionDefIR]
```

### Why CatalogIR is the linchpin for cross-language sharing

Language-specific emitters do not need to implement JSON Schema parsing, reference dereferencing, draft-2020-12 validation rules, or `allOf` flattening. An emitter for TypeScript, Dart, or Kotlin receives a clean list of `ComponentDefIR` objects and simply translates types and syntax into target language constructs.

---

## Schema analysis and normalization engine

The ingestion engine reads catalog JSON schemas and transforms them into `CatalogIR`.

### Resolving schema differences across versions

- **Handling v0.9 and v0.9.1 `allOf` structures**:
  - In v0.9.1, components use an `allOf` list:
    1. Reference to `common_types.json#/$defs/ComponentCommon`
    2. Reference to `#/$defs/CatalogComponentCommon`
    3. Inline object containing `properties` and `required`
  - The normalizer traverses the `allOf` array, resolves the references against the local and external schema registry, and merges all property definitions into a unified dictionary.
- **Handling v1.0 direct schemas**:
  - In v1.0, components are declared directly as object schemas without `allOf`. The normalizer reads properties directly, while appending common properties defined in the v1.0 `ComponentCommon` definition (including `catalogId`, `accessibility.live`, `accessibility.hidden`, and `metadata.extensions`).

### Semantic type detection rules

The normalizer inspects each property schema and maps it to a `PropertyKind`:

1. **Child references**:
   - If a property is named `child` and references `ComponentId` or `$defs/Child`, it is classified as `PropertyKind.CHILD`.
2. **Child lists**:
   - If a property is named `children` and has a `oneOf` accepting a `ComponentId` array or a template object (`componentId` + `path`), it is classified as `PropertyKind.CHILD_LIST`.
3. **Dynamic values**:
   - Properties referencing `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, or `DynamicValue` are classified as `PropertyKind.DYNAMIC`. The target type records the underlying primitive (`str`, `float`, `bool`, etc.).
4. **Actions**:
   - Properties referencing `$defs/Action` or defining `oneOf` with `event` and `function` branches are classified as `PropertyKind.ACTION`.
5. **Enums**:
   - Properties with `type: "string"` and an `enum` list are classified as `PropertyKind.ENUM`. The normalizer synthesizes an enum name based on the component and property name (e.g. `TextVariant`, `FlexJustify`).
6. **Required flags**:
   - Properties listed in the component's `required` array have `required=True`. All others have `required=False`.

---

## Python implementation design

### Runtime core (`a2ui_core`)

The runtime foundation provides the base classes and serialization protocols without requiring the code generator or LLM dependencies:

```python
# a2ui/core/ui.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence, Union


@dataclass(frozen=True)
class DataBinding:
    """Client-side reactive data model binding path."""

    path: str

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path}


def bind(path: str) -> DataBinding:
    """Convenience helper to create a client data model binding."""
    return DataBinding(path=path)


@dataclass(frozen=True)
class FunctionCall:
    """Invocation of a catalog function on the client."""

    call: str
    args: Mapping[str, Any] = field(default_factory=dict)
    call_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"call": self.call, "args": dict(self.args)}
        if self.call_id:
            d["callId"] = self.call_id
        return d


@dataclass
class Action:
    """User interaction handler."""

    event_name: Optional[str] = None
    event_context: Optional[Mapping[str, Any]] = None
    function_call: Optional[str] = None
    function_args: Optional[Mapping[str, Any]] = None

    @classmethod
    def event(
        cls, name: str, context: Optional[Mapping[str, Any]] = None
    ) -> "Action":
        return cls(event_name=name, event_context=context)

    @classmethod
    def client_function(
        cls, call: str, args: Optional[Mapping[str, Any]] = None
    ) -> "Action":
        return cls(function_call=call, function_args=args)

    def to_dict(self) -> dict[str, Any]:
        if self.event_name:
            d: dict[str, Any] = {"name": self.event_name}
            if self.event_context:
                d["context"] = {
                    k: v.to_dict() if hasattr(v, "to_dict") else v
                    for k, v in self.event_context.items()
                }
            return {"event": d}
        if self.function_call:
            d = {"call": self.function_call}
            if self.function_args:
                d["args"] = dict(self.function_args)
            return {"function": d}
        return {}


class ComponentNode(ABC):
    """Abstract interface implemented by all typesafe UI component instances."""

    id: Optional[str] = None
    component_name: str

    @abstractmethod
    def to_dict(self) -> dict[str, Any]:
        """Serializes the component to an A2UI JSON dictionary."""
        pass
```

### Tree flattening and ID allocation

When serializing a nested component tree into the flat list of A2UI wire dictionaries:

1. The flattener traverses the tree recursively starting at the root node.
2. If a node has an explicit `id`, that ID is retained. If `id` is `None`, an `IdAllocator` assigns a deterministic sequential ID (e.g. `root`, `comp_1`, `comp_2`).
3. For container components, nested `ComponentNode` objects in `child` or `children` are replaced by their allocated string IDs in the parent dictionary.
4. The flattener returns a flat `list[dict[str, Any]]` where every component contains an `id` and references its children by string ID.

```python
# a2ui/core/flattener.py
class IdAllocator:

    def __init__(self, prefix: str = ""):
        self._prefix = prefix
        self._counter = 0

    def allocate(self, hint: str = "comp") -> str:
        self._counter += 1
        return (
            f"{self._prefix}{hint}_{self._counter}"
            if self._prefix
            else f"{hint}_{self._counter}"
        )


def flatten_component_tree(
    root: ComponentNode, id_prefix: str = ""
) -> list[dict[str, Any]]:
    allocator = IdAllocator(prefix=id_prefix)
    flattened: list[dict[str, Any]] = []

    def visit(node: ComponentNode) -> str:
        node_id = node.id or allocator.allocate(hint=node.component_name.lower())
        node_dict = node.to_dict()
        node_dict["id"] = node_id

        # Replace nested child node with ID string
        if "child" in node_dict and isinstance(
            node_dict["child"], ComponentNode
        ):
            node_dict["child"] = visit(node_dict["child"])

        # Replace nested children nodes with ID strings
        if "children" in node_dict and isinstance(node_dict["children"], list):
            new_children = []
            for item in node_dict["children"]:
                if isinstance(item, ComponentNode):
                    new_children.append(visit(item))
                else:
                    new_children.append(item)
            node_dict["children"] = new_children

        flattened.append(node_dict)
        return node_id

    visit(root)
    # Reverse so children appear before parents, or maintain topological order
    return flattened
```

### Generated Python code structure

The Python emitter turns a `CatalogIR` into four files:

1. **`types.py`**:
   - String enum unions:
     ```python
     TextVariant = Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"]
     FlexAlign = Literal["start", "center", "end", "stretch"]
     FlexJustify = Literal[
         "start", "center", "end", "spaceBetween", "spaceAround"
     ]
     ```

````
2. **`components.py`**:
   * Dataclass definitions with explicit keyword arguments and catalog docstrings:
     ```python
     @dataclass(kw_only=True)
     class Text(ComponentNode):
         """The text content to display.

         Supports Markdown formatting.
         """

         component_name: str = field(default="Text", init=False)
         text: str | DataBinding | FunctionCall
         variant: TextVariant = "body"
         id: Optional[str] = None

         def to_dict(self) -> dict[str, Any]:
             d = {
                 "component": self.component_name,
                 "text": (
                     self.text.to_dict()
                     if hasattr(self.text, "to_dict")
                     else self.text
                 ),
                 "variant": self.variant,
             }
             if self.id:
                 d["id"] = self.id
             return d
````

3. **`functions.py`**:
   - Strongly typed wrapper functions:
     ```python
     def formatString(
         value: str | DataBinding, call_id: Optional[str] = None
     ) -> FunctionCall:
         """Formats a string with data model placeholders."""
         args = {
             "value": value.to_dict() if hasattr(value, "to_dict") else value
         }
         return FunctionCall(call="formatString", args=args, call_id=call_id)
     ```

````
4. **`__init__.py`**:
   * Re-exports components, functions, `DataBinding`, `bind`, `Action`, and `flatten_component_tree`.
   * Ships with an empty `py.typed` marker to activate strict type checking in `mypy` and `pyright`.

---

## Synthetic component processor integration

The Python SDK integrates the typesafe API with synthetic component registration and expansion:

### The `@synthetic_component` decorator

Developers register synthetic components using a Python decorator:

```python
from a2ui.basic import Card, Column, Text
from a2ui.core import synthetic_component


@synthetic_component(
    name="StatusCard",
    description="Displays an operation status with an icon and message.",
)
def status_card(
    title: str, status: str = "success", detail: Optional[str] = None
) -> Card:
    return Card(
        child=Column(
            children=[
                Text(text=f"Status: {status.upper()}", variant="caption"),
                Text(text=title, variant="h3"),
            ]
        )
    )
````

### Catalog synthesis algorithm

When the application boots:

1. The `@synthetic_component` decorator inspects the function using `inspect.signature` and type hints.
2. It generates a synthetic component schema:
   - Maps `str` $\rightarrow$ `{"type": "string"}`.
   - Maps `int` $\rightarrow$ `{"type": "integer"}`.
   - Maps `bool` $\rightarrow$ `{"type": "boolean"}`.
   - Reads defaults to populate `required` vs. optional parameter lists.
   - Extracts parameter descriptions from docstrings.
3. The synthetic component is injected into the in-memory catalog, allowing LLM prompt generators (such as Express, Elemental, or Direct JSON) to instruct the model on its use.

### Runtime expansion pipeline

```
LLM Output: StatusCard(title="Order Placed", status="success")
                           |
                           v
          Synthetic Component Processor
                           |
           1. Lookup registered function
           2. Execute status_card("Order Placed", "success")
           3. Receives root Card instance
           4. Run flatten_component_tree(root, id_prefix="sc_1_")
                           |
                           v
Flat Component Dictionaries:
[
  {"id": "sc_1_text_1", "component": "Text", "text": "Status: SUCCESS", "variant": "caption"},
  {"id": "sc_1_text_2", "component": "Text", "text": "Order Placed", "variant": "h3"},
  {"id": "sc_1_col_1", "component": "Column", "children": ["sc_1_text_1", "sc_1_text_2"]},
  {"id": "sc_1_card_1", "component": "Card", "child": "sc_1_col_1"}
]
                           |
                           v
Emitted to Client Renderer via standard A2UI messages
```

---

## Cross-language generator architecture

To support TypeScript, Dart, and Kotlin in the future while maximizing shared code:

### Generator sharing options

- **Option 1: Python-based multi-language CLI tool (Recommended)**:
  - The CLI generator is written in Python (using the monorepo's existing Python infrastructure).
  - Uses Jinja2 templates for each language emitter:
    - `templates/python/components.py.jinja`
    - `templates/typescript/components.ts.jinja`
    - `templates/dart/components.dart.jinja`
    - `templates/kotlin/components.kt.jinja`
  - _Advantage_: 100% of schema ingestion, dereferencing, `allOf` normalization, and semantic type detection code is shared. Adding a new language target requires only creating a new Jinja2 template folder.
- **Option 2: Standalone JSON IR compiler**:
  - A CLI tool compiles any catalog JSON schema into a simplified `catalog.ir.json`.
  - Each language repo provides a small script that reads `catalog.ir.json` and outputs code.
  - _Advantage_: Language teams write templates in their preferred language.
  - _Trade-off_: Requires maintaining template scripts across multiple repositories.

### Language idiom mappings

| Concept             | Python                                               | TypeScript                                                     | Dart                               | Kotlin                                 |
| :------------------ | :--------------------------------------------------- | :------------------------------------------------------------- | :--------------------------------- | :------------------------------------- |
| **Component Class** | `@dataclass(kw_only=True) class Card(ComponentNode)` | `class Card implements ComponentNode` or `interface CardProps` | `class Card extends ComponentNode` | `data class Card(...) : ComponentNode` |
| **String Enum**     | `Literal["h1", "body"]`                              | `"h1" \| "body"`                                               | `enum TextVariant { h1, body }`    | `enum class TextVariant { H1, BODY }`  |
| **Child Slot**      | `child: ComponentNode \| str`                        | `child: ComponentNode \| string`                               | `ComponentNode child`              | `val child: ComponentNode`             |
| **Dynamic String**  | `str \| DataBinding \| FunctionCall`                 | `string \| DataBinding \| FunctionCall`                        | `DynamicString text`               | `DynamicString text`                   |
| **Serialization**   | `.to_dict()`                                         | `.toJSON()`                                                    | `.toJson()`                        | `.toMap()`                             |

---

## Protocol versioning strategy

The generator handles multiple protocol versions through explicit packaging namespaces:

### Namespacing structure

- **Versioned catalog packages**:
  - Python: `a2ui.catalogs.v0_9_1.basic`, `a2ui.catalogs.v1_0.basic`
  - TypeScript: `@a2ui/catalogs-v0-9-1/basic`, `@a2ui/catalogs-v1-0/basic`
- **Default alias**:
  - The top-level import `a2ui.basic` re-exports the currently active authoritative specification (v0.9.1 currently, switching to v1.0 upon official release).
  - This guarantees that developers wanting standard components use simple imports (`from a2ui.basic import Card`), while developers needing strict version pinning can import the explicit version.
- **Forward compatibility**:
  - When v1.1 or future versions are released, running the generator against the v1.1 schema produces `a2ui.catalogs.v1_1.basic`. Existing code continues running against v0.9.1 or v1.0 without breaking changes.

---

## Packaging, distribution, and developer workflow

### Package boundaries

1. **`a2ui-core` (Lightweight Runtime)**:
   - Contains `ComponentNode`, `DataBinding`, `bind`, `Action`, `FunctionCall`, and `flatten_component_tree`.
   - Ships pre-generated bindings for standard catalogs: `a2ui.basic`.
   - Zero external dependencies.
2. **`a2ui-codegen` (Developer CLI Tool)**:
   - CLI tool containing the schema ingestion engine, `CatalogIR`, and language emitters.
   - Distributed via PyPI (`uvx a2ui-codegen`, `pipx run a2ui-codegen`) and npm (`npx @a2ui/codegen`).
   - Used only by developers building custom catalogs.

### CLI invocation interface

```bash
# Generate Python bindings for an enterprise catalog
a2ui-codegen \
  --catalog ./catalogs/custom.json \
  --lang python \
  --out ./src/generated/ui \
  --package-name my_app.generated.ui

# Generate TypeScript bindings
a2ui-codegen \
  --catalog ./catalogs/custom.json \
  --lang typescript \
  --out ./src/generated/ui
```
