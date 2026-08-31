# Pydantic models for A2UI fluent builders and AST deserialization

This document specifies the design for generating and using Pydantic v2 models as the foundation for A2UI's Python builder library and tree deserializer.

---

## 1. Background and goals

A2UI builders let developers construct user interfaces in Python using clean, object-oriented syntax. Historically, these builders focused primarily on outward serialization: converting nested Python objects into flat lists of A2UI wire protocol components.

However, real-world systems require bidirectional capability:
* Deserializing existing wire payloads and template files into an active, navigable Python object tree.
* Modifying that tree in place.
* Re-serializing the tree back to protocol messages without losing unknown properties or metadata.

Furthermore, catalog versions are not updated synchronously across agents, clients, and middleware. The generated classes and deserializer must support forward and backward compatibility by default.

---

## 2. Requirements

### A. Catalog versioning and evolution (James Wren proposal alignment)

1. **Open enums:** Enums must accept unrecognized string variants (`Literal[...] | str`) so older agent runtimes do not fail validation when upstream catalogs add new options.
2. **Unknown component fallback:** Deserializing an unrecognized component name must produce an `UnknownComponent` node rather than raising a fatal error.
3. **Lossless unknown field round-tripping:** Any property not declared in the local catalog schema must be captured during deserialization and re-emitted during serialization.
4. **Deprecation lifecycle:** Fields marked with `deprecated: true` and `x-deprecated-reason` in JSON Schema must generate `@deprecated` docstrings. LLM prompt generators can scrub deprecated fields from system instructions to save context tokens.

### B. Fluent authoring and AST integrity

1. **Pure hierarchical model definition:** Child slots must be typed strictly as `ComponentBuilderNode` (or `Slot`), not `Union[ComponentBuilderNode, str]`. Authors and type checkers must not have to guard against child properties being raw string IDs.
2. **Strict authoring validation:** Direct instantiation in Python (such as `Button(...)`) must reject typos (such as `lable="Submit"`) at edit time via IDE type checkers and at runtime via Pydantic validation.
3. **Schema-aware slot resolution:** The deserializer must distinguish child component slots from plain string properties using the schema's type annotations. A plain string whose value happens to match a component ID (such as `Text(text="col1")`) must never be mistakenly expanded as a child slot.
4. **Single-pass deserialization:** Deserialization, component linking, and model validation must occur in a single continuous traversal without building temporary nested dictionaries or mutating models after construction.

---

## 3. Supported use cases

### Use case 1: Greenfield layout creation
A developer writes a new UI in Python. IDEs provide autocompletion for component properties and enum options. Typos produce immediate errors.

### Use case 2: Read, mutate, and write (template editing)
A backend service reads an A2UI message payload from an LLM or template store, navigates the object tree, updates specific properties, and produces updated wire messages.

### Use case 3: Middleware and proxy pass-through
A proxy service receives an A2UI payload containing new properties from a newer catalog version, attaches telemetry, and forwards the message to a client without dropping the unrecognized properties.

### Use case 4: Tree traversal and querying
A compliance tool inspects an existing UI tree to verify that all interactive components declare accessibility labels.

### Use case 5: Macro sub-tree injection
A macro accepts a child component sub-tree from an LLM and inserts it into a container template before serialization.

### Use case 6: Cross-version fallback
An agent receives a component type introduced in a newer catalog. It parses the unknown element into an `UnknownComponent` node and continues execution without crashing.

---

## 4. Architecture and implementation

### A. The slot resolution validator (`a2ui.builder.base`)

To enable single-pass deserialization, child component references use a Pydantic `WrapValidator`. When deserializing flat wire JSON, the validator receives the string ID, retrieves the raw component dictionary from the validation context (`info.context["components"]`), and validates it recursively into the target component class.

```python
from typing import Annotated, Any, Sequence, TypeAlias
from pydantic import BaseModel, ConfigDict, ValidationInfo, WrapValidator


class ComponentBuilderNode(BaseModel):
    """Base class for all generated A2UI component models."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=True,
        populate_by_name=True,
        validate_assignment=True,
    )

    component: str
    id: str | None = None


def _resolve_slot(
    val: Any, handler: Any, info: ValidationInfo
) -> ComponentBuilderNode:
    """Resolves wire string IDs into ComponentBuilderNode instances during validation."""
    if isinstance(val, str) and info.context and "components" in info.context:
        by_id = info.context["components"]
        visited = info.context.setdefault("_visited", set())

        if val in visited:
            raise ValueError(
                f"Circular reference detected in component hierarchy at ID '{val}'"
            )

        if val in by_id:
            visited.add(val)
            raw_child_dict = by_id[val]
            return handler(raw_child_dict)

    return handler(val)


Slot: TypeAlias = Annotated[ComponentBuilderNode, WrapValidator(_resolve_slot)]
SlotList: TypeAlias = Sequence[Slot]
```

---

### B. Generated component classes (`a2ui.builder.catalogs.basic`)

Code generation emitted by `@a2ui/cli` produces clean Pydantic classes with open enums and typed slots:

```python
from typing import Annotated, Literal, Optional, Union
from pydantic import ConfigDict, Field
from a2ui.builder.base import (
    AccessibilityAttributes,
    Action,
    ComponentBuilderNode,
    DataBinding,
    FunctionCall,
    Slot,
    SlotList,
)

# Open Enum: provides autocomplete while accepting custom string variants
ButtonVariant = Literal["primary", "secondary", "text"] | str


class Text(ComponentBuilderNode):
    """Text display component."""

    component: Literal["Text"] = "Text"
    text: str | DataBinding | FunctionCall
    variant: Optional[str] = "body"
    accessibility: Optional[AccessibilityAttributes] = None
    weight: Optional[float] = None


class Button(ComponentBuilderNode):
    """Button component."""

    component: Literal["Button"] = "Button"
    child: Slot
    action: Action | DataBinding | FunctionCall
    variant: Optional[ButtonVariant] = "primary"
    accessibility: Optional[AccessibilityAttributes] = None
    weight: Optional[float] = None


class Column(ComponentBuilderNode):
    """Column container."""

    component: Literal["Column"] = "Column"
    children: SlotList = ()
    accessibility: Optional[AccessibilityAttributes] = None
    weight: Optional[float] = None


class Card(ComponentBuilderNode):
    """Card container."""

    component: Literal["Card"] = "Card"
    child: Slot
    accessibility: Optional[AccessibilityAttributes] = None
    weight: Optional[float] = None


class UnknownComponent(ComponentBuilderNode):
    """Fallback node for unrecognized components."""

    model_config = ConfigDict(extra="allow")
    component: str


# Discriminated union for polymorphic validation
Component = Annotated[
    Union[Text, Button, Column, Card, UnknownComponent],
    Field(discriminator="component"),
]
```

---

### C. Single-call deserialization utility (`deserialize_surface`)

The `deserialize_surface` function takes raw wire messages or component lists, finds the root component, and invokes Pydantic validation with the component lookup table in `context`:

```python
from typing import Any, Mapping, Sequence
from pydantic import TypeAdapter
from a2ui.builder.base import Surface
from a2ui.builder.catalogs.basic import Component


def deserialize_surface(
    payload: Mapping[str, Any] | Sequence[Mapping[str, Any]] | str,
    adapter: TypeAdapter[Any] = TypeAdapter(Component),
) -> Surface:
    """Rebuilds a typed Surface object tree from an A2UI payload in a single pass."""
    if isinstance(payload, str):
        import json

        payload = json.loads(payload)

    if isinstance(payload, list):
        components = payload
        surface_id = "main"
        root_id = None
    elif isinstance(payload, dict):
        surface_id = payload.get("surfaceId", "main")
        root_id = payload.get("rootId")
        components = payload.get(
            "components",
            payload.get("updateComponents", {}).get("components", []),
        )
    else:
        raise ValueError(f"Unsupported payload type: {type(payload)}")

    if not components:
        raise ValueError("Payload contains no components to deserialize.")

    # Index raw components by ID
    by_id = {c["id"]: dict(c) for c in components if "id" in c}

    # Find root if not explicitly provided
    if not root_id:
        referenced = set()
        for c in components:
            for v in c.values():
                if isinstance(v, str) and v in by_id:
                    referenced.add(v)
                elif isinstance(v, list):
                    for item in v:
                        if isinstance(item, str) and item in by_id:
                            referenced.add(item)
        candidates = [cid for cid in by_id if cid not in referenced]
        root_id = candidates[0] if candidates else components[0]["id"]

    # Single recursive Pydantic validation pass
    context = {"components": by_id}
    root_node = adapter.validate_python(by_id[root_id], context=context)

    return Surface(root=root_node, surface_id=surface_id)
```

---

## 5. Developer experience examples

### Example 1: Authoring a new layout

```python
from a2ui.builder import Action, Surface
from a2ui.builder.catalogs.basic import Button, Card, Column, Text

# Pure nested constructor notation
layout = Card(
    child=Column(
        children=[
            Text(text="Server Status", variant="h1"),
            Button(
                child=Text(text="Restart"),
                action=Action(event="restart_server"),
                variant="primary",
            ),
        ]
    )
)

# Serializes to flat A2UI protocol messages:
# [
#   {"id": "comp_2", "component": "Text", "text": "Server Status", "variant": "h1"},
#   {"id": "comp_4", "component": "Text", "text": "Restart"},
#   {"id": "comp_3", "component": "Button", "child": "comp_4", "action": {"event": "restart_server"}, "variant": "primary"},
#   {"id": "comp_1", "component": "Column", "children": ["comp_2", "comp_3"]},
#   {"id": "comp_0", "component": "Card", "child": "comp_1"}
# ]
messages = Surface(root=layout, surface_id="dashboard").to_messages()
```

### Example 2: Deserializing, mutating, and re-serializing

```python
from a2ui.builder import deserialize_surface
from a2ui.builder.catalogs.basic import Card, Column, Text

raw_payload = {
    "surfaceId": "dashboard",
    "components": [
        {"id": "card_0", "component": "Card", "child": "col_0"},
        {"id": "col_0", "component": "Column", "children": ["txt_0"]},
        {"id": "txt_0", "component": "Text", "text": "Old Status"},
    ],
}

# 1. Rebuild hierarchy in a single function call
surface = deserialize_surface(raw_payload)

# 2. Inspect and mutate
root = surface.root
assert isinstance(root, Card)
assert isinstance(root.child, Column)

first_child = root.child.children[0]
if isinstance(first_child, Text):
    first_child.text = "New Status: Operational"

# 3. Output updated protocol messages (preserves existing IDs)
updated_messages = surface.to_messages()
```

---

## 6. Design decisions and rationale

1. **Why Pydantic v2:** Pydantic is already the schema foundation of `a2ui_core` and the broader agent ecosystem (`google-genai`, LangChain). Using Pydantic avoids maintaining separate parsing engines while offering C/Rust performance.
2. **Why `WrapValidator` over pre-expansion:** Pre-expanding dictionaries into temporary JSON trees creates unnecessary Python dictionary overhead and relies on string-matching heuristics. `WrapValidator` operates directly during Pydantic's native type validation pass, ensuring only fields explicitly declared as slots are resolved.
3. **Why `extra="forbid"` for authoring and `extra="allow"` for unknown components:** Strict validation on standard models prevents typo bugs when writing code, while permissive parsing on `UnknownComponent` ensures unknown wire elements are preserved during round-trips.
