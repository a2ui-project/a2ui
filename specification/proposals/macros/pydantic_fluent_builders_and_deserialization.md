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
5. **Strongly-typed unlinked subtrees:** When an unknown component acts as an intermediate container (for which slot schemas are unavailable), any disconnected child components must still be deserialized into strongly-typed models where known, rather than degrading into untyped dictionaries.

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

### Use case 6: Unrecognized container with typed child subtrees
An agent receives an unknown container component (`VideoPlayer`) holding known children (`Column`, `Text`). The agent parses `VideoPlayer` as `UnknownComponent`, parses `Column` and `Text` into typed models, preserves the full hierarchy, and re-emits all components losslessly.

---

## 4. Architecture and implementation

### A. The slot resolution validator (`a2ui.builder.base`)

To enable single-pass deserialization, child component references use a Pydantic `WrapValidator`. When deserializing flat wire JSON, the validator receives the string ID, retrieves the raw component dictionary from the validation context (`info.context["components"]`), records the ID in `info.context["_visited"]`, and validates it recursively into the target component class.

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

### C. Surface model and unified serialization

The `Surface` model manages both the primary AST root and any typed unlinked subtrees discovered during deserialization:

```python
from typing import Any, Sequence
from a2ui.builder.base import ComponentBuilderNode, traverse_and_serialize


class Surface:
    """Container representing an active A2UI surface with its component hierarchies."""

    def __init__(
        self,
        root: ComponentBuilderNode,
        surface_id: str = "main",
        unlinked_roots: Sequence[ComponentBuilderNode] | None = None,
    ):
        self.root = root
        self.surface_id = surface_id
        self.unlinked_roots = list(unlinked_roots or [])

    def to_messages(self) -> list[dict[str, Any]]:
        """Serializes the primary tree and all unlinked subtrees into protocol messages."""
        all_components = traverse_and_serialize(self.root)

        for sub_tree in self.unlinked_roots:
            all_components.extend(traverse_and_serialize(sub_tree))

        return [
            {"createSurface": {"surfaceId": self.surface_id}},
            {
                "updateComponents": {
                    "surfaceId": self.surface_id,
                    "components": all_components,
                }
            },
        ]
```

---

### D. Single-call deserialization utility (`deserialize_surface`)

The `deserialize_surface` function takes raw wire messages or component lists, builds the primary AST root, and builds strongly-typed subtrees for any unlinked components:

```python
from typing import Any, Mapping, Sequence
from pydantic import TypeAdapter
from a2ui.builder.base import ComponentBuilderNode, Surface
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
    context = {"components": by_id, "_visited": set()}

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

    # 1. Primary AST validation pass
    context["_visited"].add(root_id)
    root_node: ComponentBuilderNode = adapter.validate_python(
        by_id[root_id], context=context
    )

    # 2. Build strongly-typed trees for any unlinked components
    unlinked_roots: list[ComponentBuilderNode] = []
    unvisited_ids = set(by_id.keys()) - context["_visited"]

    while unvisited_ids:
        # Find subroot among unvisited IDs
        sub_referenced = set()
        for cid in unvisited_ids:
            c = by_id[cid]
            for v in c.values():
                if isinstance(v, str) and v in unvisited_ids:
                    sub_referenced.add(v)
                elif isinstance(v, list):
                    for item in v:
                        if isinstance(item, str) and item in unvisited_ids:
                            sub_referenced.add(item)
        sub_candidates = [cid for cid in unvisited_ids if cid not in sub_referenced]
        sub_root_id = sub_candidates[0] if sub_candidates else next(iter(unvisited_ids))

        context["_visited"].add(sub_root_id)
        sub_node: ComponentBuilderNode = adapter.validate_python(
            by_id[sub_root_id], context=context
        )
        unlinked_roots.append(sub_node)
        unvisited_ids -= context["_visited"]

    return Surface(
        root=root_node,
        surface_id=surface_id,
        unlinked_roots=unlinked_roots,
    )
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

### Example 2: Deserializing and mutating unlinked subtrees

```python
from a2ui.builder import deserialize_surface
from a2ui.builder.catalogs.basic import Card, Column, Text, UnknownComponent

raw_payload = {
    "surfaceId": "media_dashboard",
    "components": [
        # Card contains an unknown VideoPlayer container
        {"id": "card_0", "component": "Card", "child": "player_0"},
        {"id": "player_0", "component": "VideoPlayer", "src": "video.mp4", "overlay": "col_0"},
        # Overlay points to a standard Column container with Text
        {"id": "col_0", "component": "Column", "children": ["txt_0"]},
        {"id": "txt_0", "component": "Text", "text": "Play Video"},
    ],
}

# 1. Rebuild hierarchy in a single function call
surface = deserialize_surface(raw_payload)

# 2. Primary tree is typed
assert isinstance(surface.root, Card)
assert isinstance(surface.root.child, UnknownComponent)

# 3. Disconnected subtrees are also strongly typed
assert len(surface.unlinked_roots) == 1
overlay_col = surface.unlinked_roots[0]
assert isinstance(overlay_col, Column)

# Mutate unlinked subtrees with full IDE autocomplete
overlay_text = overlay_col.children[0]
if isinstance(overlay_text, Text):
    overlay_text.text = "Resume Video"

# 4. Output updated protocol messages: all components and IDs are preserved losslessly
updated_messages = surface.to_messages()
```

---

## 6. Complexity costs, trade-offs, and edge cases

Supporting bidirectional deserialization expands the scope of what was originally a write-only layout generator. This section outlines the architectural complexity costs, trade-offs, and specific edge cases where deserialization encounters limitations.

### A. Architectural complexity cost

1. **Model annotation overhead:** In a write-only builder, models are simple Python dataclasses with standard constructors. Supporting deserialization requires Pydantic `WrapValidator` hooks on every slot, polymorphic discriminated unions across all catalog components, and `__pydantic_extra__` handlers.
2. **Contextual state management:** Deserialization is no longer a stateless dictionary mapping. It requires passing validation contexts (`context={"components": by_id, "_visited": set()}`) to track visited IDs, prevent infinite recursion loops, and discover unlinked subtrees.
3. **Dual ID lifecycle:** Authors creating new layouts omit component IDs to let the serializer generate sequential identifiers (`comp_0`, `comp_1`). Deserialized layouts retain explicit wire IDs. The serializer must manage both modes without ID collisions.
4. **Third-party dependency:** Deserialization relies on Pydantic v2. While standard across Python AI libraries (`google-genai`, LangChain), it introduces a formal dependency compared to standard library dataclasses.

---

### B. Pros and cons of supporting deserialization

| Advantages (Pros) | Trade-offs & Costs (Cons) |
| :--- | :--- |
| **Enables read-modify-write workflows:** Agents can ingest existing templates, update specific properties, and emit updated surfaces without starting from scratch. | **Higher cognitive surface area:** Developers must understand the relationship between the primary AST root, component IDs, and `unlinked_roots`. |
| **Enables middleware & proxies:** Intermediary services can inspect, filter, or decorate A2UI payloads without losing unrecognized properties. | **Memory overhead during deserialization:** Maintaining the wire dictionary index and constructing Pydantic models uses more memory than raw JSON pass-through. |
| **Consistent developer ergonomics:** Reconstructed ASTs look and behave identically to hand-crafted Python object trees. | **ID mutation subtleties:** Modifying child relationships manually in Python requires care when re-assigning IDs. |
| **Automated validation of incoming payloads:** Malformed structures or missing required properties are rejected immediately during deserialization. | **Catalog synchronization requirements:** Deserializing into typed classes requires maintaining generated catalog packages in sync with deployed catalogs. |

---

### C. Edge cases and limitations where deserialization struggles

#### 1. Shared child references (DAG topologies vs. pure trees)
The flat A2UI wire format allows multiple parent components to reference the same child ID (forming a Directed Acyclic Graph). For example, a header and a footer might both reference an action button ID:
```json
[
  {"id": "card", "component": "Card", "child": "btn_1"},
  {"id": "drawer", "component": "Drawer", "child": "btn_1"},
  {"id": "btn_1", "component": "Button", "child": "txt_1", "action": {"event": "submit"}},
  {"id": "txt_1", "component": "Text", "text": "Submit"}
]
```
In a hierarchical Python object tree, components are expected to have a single parent. When deserializing:
* If `btn_1` is shared by reference (`card.child is drawer.child`), mutating properties on one affects both, but tree traversals must avoid serializing `btn_1` twice.
* If `btn_1` is cloned, mutating `card.child` leaves `drawer.child` unchanged, breaking the shared wire reference.

#### 2. The "ghost component" problem on unknown container deletion
If a wire payload contains an unknown container holding known children:
```
Card -> VideoPlayer (unknown) -> Column -> Text
```
During deserialization, `Column -> Text` is preserved in `surface.unlinked_roots`.

If a developer subsequently replaces the card's child in Python:
```python
card.child = Text(text="Replaced Video")
```
The deserializer cannot know whether the subtrees in `surface.unlinked_roots` were children of the deleted `VideoPlayer` or independent disconnected widgets. If the developer does not clear `surface.unlinked_roots`, calling `surface.to_messages()` will still output `Column` and `Text` as unused "ghost components" on the wire.

#### 3. Dynamic template loops (`DynamicChildList`)
In A2UI, repeating lists use `DynamicChildList` to bind an array data path to a template component ID:
```json
{
  "id": "list_1",
  "component": "List",
  "children": {
    "path": "/users",
    "template": "user_card_template"
  }
}
```
During deserialization, `user_card_template` is a prototype definition, not a concrete rendered child list. The deserializer must recognize `template` as a template slot rather than expecting a flat list of concrete components.

#### 4. Malformed cyclic wire graphs
Corrupted or hostile wire payloads can define circular parent-child references:
```json
[
  {"id": "comp_A", "component": "Card", "child": "comp_B"},
  {"id": "comp_B", "component": "Card", "child": "comp_A"}
]
```
Without cycle tracking (`context["_visited"]`), recursive validation causes an unrecoverable `RecursionError` (stack overflow). The deserializer must explicitly catch repeated IDs in the current branch and raise an `A2UIValidationError`.

#### 5. String literal vs. path binding ambiguity
If an un-annotated or loosely typed field receives a string value like `"/user/name"`, the deserializer must determine whether it is a plain text literal or an un-enveloped data binding path. Strict schema typing is required to prevent incorrect coercions.

#### 6. Cross-version property renaming
If an upstream catalog renames a property (such as `label` to `title`), deserializing older payloads into newer Pydantic models will store `label` in `__pydantic_extra__` and leave `title` as `None`. Code expecting `node.title` will not find the value unless custom schema migration hooks are provided.

---

## 7. Design decisions and rationale

1. **Why Pydantic v2:** Pydantic is already the schema foundation of `a2ui_core` and the broader agent ecosystem (`google-genai`, LangChain). Using Pydantic avoids maintaining separate parsing engines while offering C/Rust performance.
2. **Why `WrapValidator` over pre-expansion:** Pre-expanding dictionaries into temporary JSON trees creates unnecessary Python dictionary overhead and relies on string-matching heuristics. `WrapValidator` operates directly during Pydantic's native type validation pass, ensuring only fields explicitly declared as slots are resolved.
3. **Why `extra="forbid"` for authoring and `extra="allow"` for unknown components:** Strict validation on standard models prevents typo bugs when writing code, while permissive parsing on `UnknownComponent` ensures unknown wire elements are preserved during round-trips.
4. **Why typed unlinked subtrees:** When an unknown container obscures slot relationships, parsing disconnected components into typed Pydantic models preserves developer ergonomics, inspection tooling, and unified serialization without degrading to raw untyped dictionaries.
