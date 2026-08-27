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

1. **Catalog Ingestion Engine**: Loads catalog JSON schemas from a local file or URL, parses the schema AST, resolves `$ref` references, and instantiates the in-memory `Catalog` object. JSON Schema is treated as an ingestion format / implementation detail.
2. **The In-Memory Catalog as Normalized IR**: The existing `Catalog` class in `a2ui_core` (containing `ComponentApi` and `FunctionApi`) serves as the normalized intermediate representation. We enhance `ComponentApi` with methods to inspect typed properties and child slots, eliminating the need for an external, duplicated IR layer.
3. **Language Emitters**: Pluggable code generation backends. Each backend receives a `Catalog` instance and emits formatted source files adhering to the idioms of the target programming language.
4. **Runtime Core (`a2ui-core`)**: A lightweight, zero-dependency library providing base interfaces (`ComponentBuilderNode`, `DataBinding`, `Action`, `FunctionCall`), tree flattening algorithms, and surface-level ID allocation. Generated code imports only this runtime core.

---

## Unifying CatalogIR with the in-memory Catalog

Rather than inventing a separate, disconnected intermediate representation, the existing `Catalog` model in `a2ui_core` (`Catalog[ComponentApi, FunctionApi]`) serves directly as the normalized intermediate representation.

### Turning JSON Schema into an implementation detail

By making `Catalog` the canonical in-memory model:

- **Schema as an ingestion adapter**: The `Catalog.from_json(schema)` classmethod parses and dereferences raw JSON Schema (handling draft-2020-12 `$ref` pointers and `allOf` merging) once during ingestion. The rest of the system operates strictly on typed Python objects.
- **Schema-free programmatic catalogs**: Developers can define catalogs programmatically in Python or load them from external sources without writing or maintaining raw JSON Schema files.
- **Clean emitter boundary**: Code generation emitters receive a `Catalog` and iterate over `ComponentApi` and `FunctionApi` objects to synthesize source files.

### Non-invasive adapter pattern: AnalysedComponentApi in the experimental package

To maintain strict stability in `a2ui_core`, we avoid making intrusive or breaking changes to `ComponentApi` and `Catalog` during early development. Instead, the analysis and code generation logic resides entirely within the experimental package (`a2ui.inference_formats.experimental.template` or `a2ui.codegen`).

We implement an **Adapter Wrapper Pattern**:

```python
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional, Sequence, Union
from a2ui.core.catalog import Catalog, ComponentApi, FunctionApi
from a2ui.schema.schema_helper import CatalogSchemaHelper


# --- Strongly-Typed Type Descriptor System ---


class PrimitiveKind(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    ANY = "any"


@dataclass(frozen=True)
class PrimitiveType:
    kind: PrimitiveKind


@dataclass(frozen=True)
class EnumType:
    name: str
    values: tuple[str, ...]


@dataclass(frozen=True)
class ComponentRefType:
    """Single child component slot (e.g. Card.child)."""

    pass


@dataclass(frozen=True)
class ComponentListType:
    """Sequence of child components or dynamic template (e.g. Column.children)."""

    pass


@dataclass(frozen=True)
class DynamicType:
    """A2UI dynamic value: literal T | DataBinding | FunctionCall[T]."""

    inner: "TypeDescriptor"


@dataclass(frozen=True)
class ActionType:
    """Server event or client function trigger."""

    pass


@dataclass(frozen=True)
class DataBindingType:
    """Explicit client data model path binding."""

    pass


@dataclass(frozen=True)
class ListType:
    """Sequence of primitive elements."""

    element_type: "TypeDescriptor"


@dataclass(frozen=True)
class MapType:
    """Key-value dictionary."""

    value_type: "TypeDescriptor"


@dataclass(frozen=True)
class UnionType:
    """Union of multiple alternative types."""

    options: tuple["TypeDescriptor", ...]


# Algebraic sum type for all property types (eliminates stringly-typed target_type)
TypeDescriptor = Union[
    PrimitiveType,
    EnumType,
    ComponentRefType,
    ComponentListType,
    DynamicType,
    ActionType,
    DataBindingType,
    ListType,
    MapType,
    UnionType,
]


@dataclass(frozen=True)
class PropertyApi:
    name: str
    type_desc: TypeDescriptor
    required: bool
    description: Optional[str]
    default_value: Optional[Any] = None


class AnalysedComponentApi:
    """Non-invasive wrapper around ComponentApi providing schema analysis for codegen.

    Lives in the experimental package, leaving a2ui_core.ComponentApi untouched.
    """

    def __init__(
        self, component: ComponentApi, schema_helper: CatalogSchemaHelper
    ):
        self.component = component
        self.name = component.name
        self.schema = component.schema
        self._helper = schema_helper

    def get_properties(self) -> Sequence[PropertyApi]:
        """Returns normalized, strongly typed property metadata."""
        prop_names = self._helper.get_component_properties(self.name)
        reqs = set(self._helper.get_component_required(self.name))
        results = []
        for prop_name in prop_names:
            prop_schema = self._helper.get_property_schema(self.name, prop_name)
            type_desc = self._resolve_type_desc(prop_name, prop_schema)
            results.append(
                PropertyApi(
                    name=prop_name,
                    type_desc=type_desc,
                    required=prop_name in reqs,
                    description=(
                        prop_schema.get("description") if prop_schema else None
                    ),
                )
            )
        return results

    def get_child_slots(self) -> Sequence[PropertyApi]:
        """Returns properties representing child components or child lists."""
        return [
            p
            for p in self.get_properties()
            if isinstance(p.type_desc, (ComponentRefType, ComponentListType))
        ]

    @property
    def is_container(self) -> bool:
        """Returns True if the component accepts child or children slots."""
        return len(self.get_child_slots()) > 0

    @property
    def docstring(self) -> Optional[str]:
        """Returns the component description from schema."""
        return self.schema.get("description")

    def _resolve_type_desc(
        self, prop_name: str, prop_schema: Optional[dict[str, Any]]
    ) -> TypeDescriptor:
        """Resolves JSON schema structure into strongly typed TypeDescriptor."""
        ...


class AnalysedCatalog:
    """Wraps an existing in-memory Catalog to expose rich analysis without modifying core."""

    def __init__(self, catalog: Catalog[Any, Any]):
        self.catalog = catalog
        self.schema_helper = CatalogSchemaHelper(catalog)
        self.components = {
            name: AnalysedComponentApi(comp, self.schema_helper)
            for name, comp in catalog.components.items()
        }
```

### Pattern matching on TypeDescriptor in language emitters

Replacing stringly-typed `target_type: str` with algebraic `TypeDescriptor` objects enables language emitters to use exhaustive pattern matching, guaranteeing compiler-verified type generation across all target languages:

```python
def to_python_type(t: TypeDescriptor) -> str:
    match t:
        case PrimitiveType(PrimitiveKind.STRING):
            return "str"
        case PrimitiveType(PrimitiveKind.INTEGER):
            return "int"
        case PrimitiveType(PrimitiveKind.FLOAT):
            return "float"
        case PrimitiveType(PrimitiveKind.BOOLEAN):
            return "bool"
        case PrimitiveType(PrimitiveKind.ANY):
            return "Any"
        case EnumType(name=name):
            return name
        case ComponentRefType():
            return "ComponentBuilderNode"
        case ComponentListType():
            return "Sequence[ComponentBuilderNode] | DynamicChildList"
        case DynamicType(inner=inner):
            return f"{to_python_type(inner)} | DataBinding | FunctionCall"
        case ActionType():
            return "Action"
        case DataBindingType():
            return "DataBinding"
        case ListType(element_type=elem):
            return f"Sequence[{to_python_type(elem)}]"
        case MapType(value_type=val):
            return f"Mapping[str, {to_python_type(val)}]"
        case UnionType(options=opts):
            return " | ".join(to_python_type(o) for o in opts)
```

TypeScript, Dart, and Kotlin emitters implement the exact same pattern-matching logic against `TypeDescriptor`, completely eliminating string-formatting bugs or unhandled edge cases across languages.

### Centralizing schema crawling via existing CatalogSchemaHelper

The A2UI Python SDK already contains `CatalogSchemaHelper` in `a2ui.schema.schema_helper` (used across Express, Atom, and Elemental inference formats). `CatalogSchemaHelper` already implements:

- Crawling and flattening `allOf` inheritance chains.
- Ordering component and function properties deterministically.
- Extracting required property lists.
- Detecting `Checkable` components.
- Detecting and extracting string enum choices.

By implementing `AnalysedComponentApi` on top of `CatalogSchemaHelper`, we avoid duplicating schema crawling logic. The code generator simply consumes `AnalysedCatalog`, keeping `a2ui_core` stable and untouched while sharing crawler infrastructure across the SDK.

### Graduation path to core

Once the typesafe API generator matures and stabilizes in the experimental folder, the analytical properties on `AnalysedComponentApi` can be evaluated for direct inclusion into `a2ui_core.catalog.ComponentApi`, or remain as an independent analysis module.

### Why this in-memory model is the linchpin for cross-language sharing

Language-specific emitters do not need to implement JSON Schema parsing, reference dereferencing, draft-2020-12 validation rules, or `allOf` flattening. An emitter for Python, TypeScript, Dart, or Kotlin receives a clean `Catalog` instance holding normalized `ComponentApi` and `FunctionApi` objects, and simply translates their properties and syntax into target language constructs. Raw JSON Schema files are treated strictly as an ingestion format, keeping the rest of the system clean and typed.

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

The normalizer inspects each property schema and maps it to a strongly typed `TypeDescriptor`:

1. **Child references**:
   - If a property is named `child` and references `ComponentId` or `$defs/Child`, it is mapped to `ComponentRefType()`.
2. **Child lists**:
   - If a property is named `children` and has a `oneOf` accepting a `ComponentId` array or a dynamic template object (`componentId` + `path`), it is mapped to `ComponentListType()`.
3. **Dynamic values**:
   - Properties referencing `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, or `DynamicValue` are mapped to `DynamicType(inner=...)`, where `inner` records the underlying primitive or sequence (`PrimitiveType(PrimitiveKind.STRING)`, `ListType(PrimitiveType(PrimitiveKind.STRING))`, etc.).
4. **Actions**:
   - Properties referencing `$defs/Action` or defining `oneOf` with `event` and `function` branches are mapped to `ActionType()`.
5. **Data model bindings**:
   - Properties referencing `$defs/DataBinding` are mapped to `DataBindingType()`.
6. **Enums**:
   - Properties with `type: "string"` and an `enum` list are mapped to `EnumType(name, values)`. The normalizer synthesizes a descriptive enum name based on the component and property name (e.g. `TextVariant`, `FlexJustify`).
7. **Validation checks**:
   - Properties named `checks` with array of `$defs/CheckRule` are typed as `Sequence[CheckRule]`.
8. **Required flags**:
   - Properties listed in the component's `required` array have `required=True`. All others have `required=False`.

---

## Python implementation design

### Experimental builder foundation (`a2ui_agent`)

To keep non-experimental packages (`a2ui_core`) completely untouched and stable during this experimental cycle, the builder base classes and serialization flattener live directly inside the experimental synthetic catalog inference format:
`a2ui.inference_formats.experimental.synthetic_catalog.builder.base` (in `agent_sdks/python/a2ui_agent`).

```python
# a2ui/inference_formats/experimental/synthetic_catalog/builder/base.py
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


class ComponentBuilderNode(ABC):
    """Abstract interface implemented by all typesafe UI component instances."""

    id: Optional[str] = None
    component_name: str

    @abstractmethod
    def to_dict(self) -> dict[str, Any]:
        """Serializes the component to an A2UI JSON dictionary."""
        pass


class ExternalComponentBuilderNode(ComponentBuilderNode):
    """Represents an external component referenced strictly by ID.

    Used during streaming expansion and slot binding to maintain strict type
    safety without allowing raw, unvalidated strings to be passed into child
    slots.
    """

    def __init__(self, id: str):
        self.id = id
        self.component_name = "ExternalComponent"

    def to_dict(self) -> dict[str, Any]:
        return {}


# Ergonomic alias
ComponentRef = ExternalComponentBuilderNode


@dataclass(frozen=True)
class CheckRule:
    """Client-side validation rule for Checkable input components."""

    condition: Union[bool, DataBinding, FunctionCall]
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "condition": (
                self.condition.to_dict()
                if hasattr(self.condition, "to_dict")
                else self.condition
            ),
            "message": self.message,
        }


@dataclass(frozen=True)
class DynamicChildList:
    """Dynamic repeating template slot driven by a client data model array."""

    component: Union[ComponentBuilderNode, str]
    path: str

    def to_dict(self) -> dict[str, Any]:
        comp_id = (
            self.component.id
            if isinstance(self.component, ComponentBuilderNode)
            else self.component
        )
        return {"componentId": comp_id, "path": self.path}


@dataclass
class Surface:
    """High-level container for direct payload authoring (MCP tools, tests, backend servers)."""

    surface_id: str
    root: Union[ComponentBuilderNode, Sequence[ComponentBuilderNode]]
    catalog_id: str = (
        "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"
    )
    data_model: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        """Flattens the surface into a standard dictionary holding components and data model."""
        components = flatten_component_tree(self.root, root_id="root")
        return {
            "surfaceId": self.surface_id,
            "catalogId": self.catalog_id,
            "components": components,
            "dataModel": self.data_model or {},
        }

    def to_messages(
        self, version: str = "v0.9.1", strict: bool = False
    ) -> list[dict[str, Any]]:
        """Emits protocol lifecycle messages targeting the specified A2UI version."""
        components = flatten_component_tree(self.root, root_id="root")
        if version == "v1.0":
            return [
                {
                    "createSurface": {
                        "surfaceId": self.surface_id,
                        "catalogId": self.catalog_id,
                        "components": components,
                        "dataModel": self.data_model or {},
                    }
                }
            ]
        else:  # Default v0.9.1
            messages = [
                {
                    "beginRendering": {
                        "surfaceId": self.surface_id,
                        "root": components[0]["id"] if components else "root",
                        "catalogId": self.catalog_id,
                    }
                },
                {
                    "surfaceUpdate": {
                        "surfaceId": self.surface_id,
                        "components": components,
                    }
                },
            ]
            if self.data_model:
                for path, val in self.data_model.items():
                    norm_path = path if path.startswith("/") else f"/{path}"
                    messages.append(
                        {
                            "dataModelUpdate": {
                                "surfaceId": self.surface_id,
                                "path": norm_path,
                                "value": val,
                            }
                        }
                    )
            return messages
```

### ID management, collision prevention, and tree flattening

A critical challenge during synthetic component expansion is managing component IDs across a shared surface. If a synthetic component is instantiated multiple times on the same surface (or if multiple synthetic components define internal IDs like `"header"` or `"submit_btn"`), unnamespaced IDs will collide, violating A2UI's uniqueness constraint.

To ensure deterministic, collision-free layout expansion, the flattening engine implements four ID management principles:

#### 1. Root ID anchor stitching

When an LLM or parent container invokes a synthetic component, it specifies an invocation ID (for example, `id="user_card_1"`):

- The parent container's layout already references this ID (e.g. `Column(children=["user_card_1", "other_comp"])`).
- When the synthetic component function executes, its returned root component (e.g. `Card`) **must assume the invocation ID as its own ID** (`id="user_card_1"`).
- Even if the developer assigned an internal ID in code (e.g. `Card(id="profile_card")`), the engine overrides the root ID with the invocation ID, ensuring the parent surface stitches seamlessly.

#### 2. Sub-component namespacing

All sub-components inside the synthetic component are scoped to the invocation ID:

- **Namespacing pattern**: `f"{invocation_id}__{local_id}"`.
- **Explicit internal IDs**: If the developer assigned an explicit ID (e.g. `Button(id="save_btn")`), it is namespaced to `user_card_1__save_btn`.
- **Auto-generated IDs**: If the developer omitted the ID, the allocator assigns a deterministic name: `user_card_1__col_1`, `user_card_1__text_2`.
- **Multi-instance isolation**: If two instances of `UserProfile` appear on the same surface (`user_card_1` and `user_card_2`), their internal buttons become `user_card_1__save_btn` and `user_card_2__save_btn`, preventing collision.

#### 3. Internal reference rewriting

If internal components reference one another by ID (for example, in `child` or `children` slots, action targets, or accessibility references), the flattener maintains an ID translation map (`local_id -> namespaced_id`) and rewrites internal references so they point to the namespaced IDs.

#### 4. Slot boundary preservation

When a synthetic component accepts a child component via a slot parameter (e.g. `def modal(body: ComponentBuilderNode)`):

- The `body` component was created in the **caller's scope**, not inside the synthetic component. It may be a full component tree or an `ExternalComponentBuilderNode(id="...")`.
- The flattener detects slot boundaries and **does not namespace caller-provided nodes**. Caller-provided IDs remain intact, allowing the caller's outer logic and event handlers to address slot components directly.

```python
# Part of a2ui/inference_formats/experimental/synthetic_catalog/builder/base.py
from typing import Any, Optional, Set


class IdAllocator:

    def __init__(self, prefix: str = ""):
        self._prefix = prefix
        self._counter = 0

    def allocate(self, hint: str = "comp") -> str:
        self._counter += 1
        return (
            f"{self._prefix}__{hint}_{self._counter}"
            if self._prefix
            else f"{hint}_{self._counter}"
        )


def flatten_component_tree(
    root: Union[ComponentBuilderNode, Sequence[ComponentBuilderNode]],
    root_id: Optional[str] = None,
    id_prefix: Optional[str] = None,
    slot_nodes: Optional[Set[ComponentBuilderNode]] = None,
) -> list[dict[str, Any]]:
    """Flattens a component tree or sibling component list into A2UI wire format with scoped IDs.

    Args:
        root: The root component node or sequence of sibling nodes to flatten.
        root_id: Explicit ID for the root node (e.g. synthetic invocation ID).
        id_prefix: Namespace prefix for internal sub-components.
        slot_nodes: Set of caller-provided slot nodes exempt from namespacing.

    Returns:
        Flat list of component dictionaries ready for client rendering.
    """
    prefix = id_prefix or (root_id if root_id else "")
    allocator = IdAllocator(prefix=prefix)
    slot_set = slot_nodes or set()

    # Support sibling component lists (e.g. macro layout returning list of rows)
    if isinstance(root, Sequence) and not isinstance(root, (str, bytes)):
        flattened_all: list[dict[str, Any]] = []
        for idx, item in enumerate(root):
            item_prefix = f"{prefix}__item_{idx}" if prefix else None
            flattened_all.extend(
                flatten_component_tree(
                    item,
                    root_id=item.id,
                    id_prefix=item_prefix,
                    slot_nodes=slot_set,
                )
            )
        return flattened_all

    flattened: list[dict[str, Any]] = []
    is_root = True

    def visit(node: ComponentBuilderNode) -> str:
        nonlocal is_root

        # 1. External component reference: emit ID directly without emitting dictionary
        if isinstance(node, ExternalComponentBuilderNode):
            return node.id

        # 2. Determine node ID
        if is_root and root_id:
            node_id = root_id
            is_root = False
        elif node in slot_set:
            # Caller slot node: preserve original ID or allocate in caller scope
            node_id = node.id or allocator.allocate(
                hint=node.component_name.lower()
            )
        elif node.id:
            # Explicit internal ID: namespace to avoid surface collision
            node_id = f"{prefix}__{node.id}" if prefix else node.id
        else:
            # Unlabelled internal node: assign deterministic namespaced ID
            node_id = allocator.allocate(hint=node.component_name.lower())

        node_dict = node.to_dict()
        node_dict["id"] = node_id

        # Recursively flatten child slot
        if "child" in node_dict and isinstance(
            node_dict["child"], ComponentBuilderNode
        ):
            node_dict["child"] = visit(node_dict["child"])

        # Recursively flatten children list slot
        if "children" in node_dict and isinstance(node_dict["children"], list):
            new_children = []
            for item in node_dict["children"]:
                if isinstance(item, ComponentBuilderNode):
                    new_children.append(visit(item))
                else:
                    new_children.append(item)
            node_dict["children"] = new_children

        flattened.append(node_dict)
        return node_id

    visit(root)
    return flattened
```

### Generated Python code structure

The base abstractions (`ComponentBuilderNode`, `DataBinding`, `Action`, `FunctionCall`, `bind`, `IdAllocator`, `flatten_component_tree`) are **handwritten in A2UI Core** (`a2ui.core.builder.base`). They are **never generated**.

Because the base runtime types are shared from core, every generated catalog can seamlessly interoperate with every other catalog. The Python emitter turns an ingested `Catalog` into four catalog-specific files that import from core:

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
     class Text(ComponentBuilderNode):
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
           3. Receives return value: ComponentBuilderNode (or Sequence[ComponentBuilderNode])
           4. Run flatten_component_tree(root, root_id=invocation_id)
                           |
                           v
Flat Component Dictionaries:
[
  {"id": "sc_1__text_1", "component": "Text", "text": "Status: SUCCESS", "variant": "caption"},
  {"id": "sc_1__text_2", "component": "Text", "text": "Order Placed", "variant": "h3"},
  {"id": "sc_1__col_1", "component": "Column", "children": ["sc_1__text_1", "sc_1__text_2"]},
  {"id": "sc_1", "component": "Card", "child": "sc_1__col_1"}
]
                           |
                           v
Emitted to Client Renderer via standard A2UI messages (surfaceUpdate)
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

| Concept             | Python                                                      | TypeScript                                                            | Dart                                      | Kotlin                                        |
| :------------------ | :---------------------------------------------------------- | :-------------------------------------------------------------------- | :---------------------------------------- | :-------------------------------------------- |
| **Component Class** | `@dataclass(kw_only=True) class Card(ComponentBuilderNode)` | `class Card implements ComponentBuilderNode` or `interface CardProps` | `class Card extends ComponentBuilderNode` | `data class Card(...) : ComponentBuilderNode` |
| **String Enum**     | `Literal["h1", "body"]`                                     | `"h1" \| "body"`                                                      | `enum TextVariant { h1, body }`           | `enum class TextVariant { H1, BODY }`         |
| **Child Slot**      | `child: ComponentBuilderNode`                               | `child: ComponentBuilderNode`                                         | `ComponentBuilderNode child`              | `val child: ComponentBuilderNode`             |
| **Dynamic String**  | `str \| DataBinding \| FunctionCall`                        | `string \| DataBinding \| FunctionCall`                               | `DynamicString text`                      | `DynamicString text`                          |
| **Serialization**   | `.to_dict()`                                                | `.toJSON()`                                                           | `.toJson()`                               | `.toMap()`                                    |

---

## Protocol versioning strategy: Version-agnostic authoring with version-targeted emitters

A critical architectural insight is that UI components represent declarative layout intent (`Card`, `Column`, `Row`, `Text`, `Button`, `TextField`). A card wrapping a column with a text header and action button represents the same visual structure regardless of whether it is delivered over protocol v0.9.1, v1.0, or a future v1.1.

Instead of forcing developers to choose and pin specific protocol versions when authoring UI (e.g. `from a2ui.catalogs.v0_9_1.basic import Card`), the system decouples content authoring from protocol wire serialization:

### 1. Protocol-version-agnostic content authoring

Developers write synthetic components and direct payloads using version-neutral builder classes:

```python
from a2ui.basic import Action, Button, Card, Column, Text


def welcome_card(user_name: str) -> Card:
    return Card(
        child=Column(
            children=[
                Text(text=f"Welcome back, {user_name}!", variant="h3"),
                Button(
                    text="Open Dashboard", action=Action.event("open_dashboard")
                ),
            ]
        )
    )
```

The returned component tree expresses pure layout and data bindings, independent of message envelope formats or wire protocol versions.

### 2. Version-targeted serialization at the transport boundary

The target protocol version is selected when the surface or synthetic component is serialized to wire messages:

```python
# Target v0.9.1 (current web renderers):
messages_v09 = surface.to_messages(version="v0.9.1")
# Serializes to:
# 1. beginRendering(surfaceId="main", root="card_1", catalogId="basic")
# 2. surfaceUpdate(surfaceId="main", components=[...])
# 3. dataModelUpdate(surfaceId="main", path="/...", value=...)

# Target v1.0:
messages_v10 = surface.to_messages(version="v1.0")
# Serializes to:
# 1. createSurface(surfaceId="main", catalogId="basic", components=[...], dataModel={...})
```

### 3. Handling protocol differences during serialization

The serialization layer bridges protocol differences automatically:

- **Message envelope formatting**:
  - For v0.9.1: Emits the multi-message lifecycle sequence (`beginRendering`, `surfaceUpdate`, `dataModelUpdate`).
  - For v1.0: Bundles components and initial data model atomically inside `createSurface`.
- **Child collections and lists**:
  - For v0.9.1: Emits dynamic child lists using `{ componentId, path }` on container `children`.
  - For v1.0: Emits dynamic collections using the v1.0 `List` container or `$defs/ChildList` structure.
- **Version-specific attributes (graceful degradation)**:
  - When a developer uses an attribute introduced in v1.0 (such as `accessibility.live`, `metadata.extensions`, or per-component `catalogId` overrides):
    - If serializing to **v1.0**: The attribute is included in the output JSON.
    - If serializing to **v0.9.1**: The attribute is omitted or stripped with an optional logger warning, ensuring older v0.9.1 client renderers do not fail schema validation.
  - An optional strict mode (`strict=True`) can be enabled in CI or conformance tests to raise a `CompatibilityError` if an author uses features unsupported by the target version.

---

## Packaging, distribution, and bloat prevention

A critical architectural consideration is whether `a2ui-codegen` should be bundled directly inside the Agent SDK (`a2ui-agent-sdk`), or whether that would introduce unnecessary bloat for production codebases that only need runtime execution.

### The bloat problem: Build-time tooling vs. runtime execution

- **The Code Generator is an author-time tool**: It runs on a developer's workstation or in a CI build pipeline to generate `.py`, `.ts`, or `.dart` source files from a catalog schema. It requires template engines (Jinja2), schema crawlers, and file generators.
- **The Agent SDK is a runtime server library**: It runs in production environments (web servers, serverless AWS Lambda / Cloud Run functions, microservices, and lightweight Model Context Protocol MCP servers) to orchestrate agent turns and emit A2UI messages.
- **The risk of direct bundling**: If `a2ui-codegen` and its dependencies (e.g. `jinja2`, CLI runners, formatting utilities) were bundled into the default `dependencies` of `a2ui-agent-sdk`:
  - Production Docker containers and serverless packages would carry generator dependencies that are never invoked during agent execution.
  - Users could face dependency version conflicts (e.g. Jinja2 version pins conflicting with their existing web framework).

### The separation strategy: Three tiers of distribution

To achieve maximum convenience without bloating production codebases, the system uses a three-tier separation strategy:

#### 1. Zero-dependency runtime pre-bundling (`a2ui-core`)

The vast majority (>90%) of developers authoring UI use the official A2UI Basic Catalog:

- `a2ui-core` ships with **pre-generated, pre-tested typesafe bindings** for the Basic Catalog (`from a2ui.basic import Card, Column, Row, Text`).
- Developers using standard components never need to install, configure, or run the code generator CLI.
- `a2ui-core` has zero heavy dependencies, ensuring a minimal runtime footprint for production deployments.

#### 2. Standalone ephemeral execution via `uvx` / `pipx` (Zero virtualenv pollution)

For developers creating domain-specific custom catalogs or enterprise component suites:

- `a2ui-codegen` is published to PyPI as a standalone package with console entry point `[project.scripts] a2ui-codegen = "a2ui.codegen.cli:main"`.
- Developers run it on-demand using modern ephemeral runners:

  ```bash
  # Ephemeral zero-install run via uv (recommended):
  uvx a2ui-codegen --catalog ./catalogs/custom.json --lang python --out ./src/generated/ui

  # Ephemeral run via pipx:
  pipx run a2ui-codegen --catalog ./catalogs/custom.json --lang python --out ./src/generated/ui
  ```

- **Why this prevents bloat**: `uvx` downloads and runs the tool in an isolated temporary sandbox. The generated Python files are written to the project's repository, but **zero generator dependencies or packages are added to the project's virtualenv, `pyproject.toml`, or lockfile**.

#### 3. Optional SDK extra for unified installation (`a2ui-agent-sdk[codegen]`)

For developers who prefer having the CLI permanently available in their local development virtualenv:

- The dependency is declared as an optional extra in `a2ui_agent/pyproject.toml`:
  ```toml
  [project.optional-dependencies]
  codegen = [
      "jinja2>=3.1.0",
  ]
  ```
- **Production deployment**: `pip install a2ui-agent-sdk` (remains lean with zero generator bloat).
- **Local development**: `pip install "a2ui-agent-sdk[codegen]"` (installs the extra and provides the `a2ui-codegen` command).
