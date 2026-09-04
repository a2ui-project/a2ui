# Pydantic models for A2UI fluent builders and AST deserialization

This document specifies the design for using Pydantic v2 models as the foundation for A2UI's Python fluent builder library, tree serialization, and AST deserialization.

---

## 1. Background and goals

A2UI builders allow developers to construct user interfaces in Python using clean, object-oriented syntax. Historically, these builders focused primarily on outward serialization: converting nested Python objects into flat lists of A2UI wire protocol components.

However, real-world systems require bidirectional capability:

- Deserializing existing wire payloads and template files into an active, navigable Python object tree.
- Modifying that tree in place.
- Re-serializing the tree back to protocol messages without losing unknown properties or metadata.

### Decoupling component trees from client surfaces

In the A2UI wire protocol and client renderers, a **Surface** is a stateful, persistent rendering canvas identified by a unique `surfaceId`. It manages an active data model, event dispatching, and component registration.

In contrast, an agent-side builder constructs a **component tree** (or UI fragment). That tree might represent:

1. **A macro expansion:** A component subtree that splices directly into an existing container.
2. **An incremental patch in an MCP server:** An update targeting specific components on an existing surface (`updateComponents`) without recreating the canvas.
3. **A brand-new UI view:** A full layout requiring both `createSurface` and `updateComponents`.

Treating the builder's tree container as a `Surface` conflates the in-memory component hierarchy with the client's rendering target. It also creates a practical defect: calling `.to_messages()` on a `Surface` object unconditionally emits `createSurface`, which resets client state during incremental updates.

This design introduces **`ComponentTree`** to represent the component hierarchy, while providing explicit envelope helpers (`create_surface`, `update_components`) to package the tree into protocol messages.

### Implementation phasing

To deliver value quickly without migration risk, this design is divided into two distinct phases:

1. **Phase 1: Pydantic foundation, fluent authoring, and serialization (Immediate):** Migrate `ComponentBuilderNode` and supporting types to Pydantic v2 `BaseModel`, adopt open enums, typed child slots, strict authoring validation via `@a2ui/cli` code generation, and explicit serialization helpers (`to_components`, `ComponentTree`, `create_surface`, `update_components`).
2. **Phase 2: Bidirectional AST deserialization (Follow-up):** Introduce `deserialize()`, `WrapValidator` slot resolution, `UnknownComponent` fallback, and strongly-typed unlinked subtrees as a non-breaking, purely additive extension.

---

## 2. Requirements

### A. Catalog versioning and evolution (James Wren proposal alignment)

1. **Open enums:** Enums must accept unrecognized string variants (`Literal[...] | str`) so older agent runtimes do not fail validation when upstream catalogs add new options.
2. **Unknown component fallback:** Deserializing an unrecognized component name must produce an `UnknownComponent` node rather than raising a fatal error.
3. **Lossless unknown field round-tripping:** Any property not declared in the local catalog schema must be captured during deserialization and re-emitted during serialization.
4. **Deprecation lifecycle:** Fields marked with `deprecated: true` and `x-deprecated-reason` in JSON Schema must generate `@deprecated` docstrings. LLM prompt generators can scrub deprecated fields from system instructions to save context tokens.

### B. Fluent authoring, serialization, and AST integrity

1. **Pure hierarchical model definition:** Child slots must be typed strictly as `ComponentBuilderNode` (or `Slot`), not `Union[ComponentBuilderNode, str]`. Authors and type checkers must not guard against child properties being raw string IDs.
2. **Strict authoring validation:** Direct instantiation in Python (such as `Button(...)`) must reject typos (such as `lable="Submit"`) at edit time via IDE type checkers and at runtime via Pydantic validation.
3. **Decoupled wire packaging:** Builders must allow serializing component trees into raw component lists (`node.to_components()`), incremental surface updates (`update_components()`), or new surface definitions (`create_surface()`).
4. **Schema-aware slot resolution:** The deserializer must distinguish child component slots from plain string properties using the schema's type annotations. A plain string whose value matches a component ID (such as `Text(text="col1")`) must never be mistakenly expanded as a child slot.
5. **Single-pass deserialization:** Deserialization, component linking, and model validation must occur in a single continuous traversal without building temporary nested dictionaries or mutating models after construction.
6. **Strongly-typed unlinked subtrees:** When an unknown component acts as an intermediate container, any disconnected child components must be deserialized into strongly-typed models in `tree.unlinked_roots` rather than degrading into untyped dictionaries.

---

## 3. Supported use cases

### Use case 1: Macro definition and expansion

A developer authors a reusable macro function using builder classes and returns a `Card` node. The macro engine calls `card.to_components()` directly to produce flat component dictionaries for insertion into the host message, requiring no surface envelopes.

### Use case 2: MCP server creating a new tool surface

An MCP tool receives a query, builds an interactive view, and calls `create_surface("flight-tracker", root=ui)` to return `createSurface` and `updateComponents` messages to the client.

### Use case 3: MCP server applying an incremental patch

An MCP tool responds to a user action (such as clicking a refresh button) by building an updated card and calling `update_components("flight-tracker", root=card)`. The client updates the targeted component in place without resetting surface state.

### Use case 4: Greenfield layout creation

A developer writes a new UI in Python. IDEs provide autocompletion for component properties and enum options. Typos produce immediate errors.

### Use case 5: Read, mutate, and write (template editing)

A backend service reads an A2UI message payload, deserializes it into a `ComponentTree`, navigates the object tree, updates specific properties, and emits updated wire messages.

### Use case 6: Unrecognized container with typed child subtrees

An agent receives an unknown container component (`VideoPlayer`) holding known children (`Column`, `Text`). The agent parses `VideoPlayer` as `UnknownComponent`, parses `Column` and `Text` into typed models in `tree.unlinked_roots`, and re-emits all components losslessly.

---

## 4. Architecture and implementation

### A. Base models and slot resolution (`a2ui.builder.base`)

In **Phase 1**, `ComponentBuilderNode` is established as a Pydantic `BaseModel` with strict attribute validation, and child slots are typed directly:

```python
from typing import Any, Sequence, TypeAlias
from pydantic import BaseModel, ConfigDict


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


# Phase 1: Direct type aliases for fluent authoring
Slot: TypeAlias = ComponentBuilderNode
SlotList: TypeAlias = Sequence[Slot]
```

In **Phase 2**, to enable single-pass deserialization, child component slots are upgraded to use a Pydantic `WrapValidator`. When deserializing flat wire JSON, the validator receives the string ID, retrieves the raw component dictionary from the validation context (`info.context["components"]`), records the ID in `info.context["_visited"]`, and validates it recursively into the target component class:

```python
from typing import Annotated, Any, Sequence, TypeAlias
from pydantic import ValidationInfo, WrapValidator


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


# Phase 2: WrapValidator slot definition (transparent to direct model instantiation)
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

### C. Component tree and envelope serialization (`a2ui.builder.base`)

Rather than binding the in-memory tree to a client-side surface abstraction, the builder provides `ComponentTree` to manage the component hierarchy, alongside explicit protocol envelope helpers:

```python
from typing import Any, Sequence
from a2ui.builder.base import ComponentBuilderNode, traverse_and_serialize


class ComponentTree:
    """An in-memory hierarchy of components, containing a primary root and any unlinked subtrees."""

    def __init__(
        self,
        root: ComponentBuilderNode,
        unlinked_roots: Sequence[ComponentBuilderNode] | None = None,
        surface_id: str | None = None,
    ):
        self.root = root
        self.unlinked_roots = list(unlinked_roots or [])
        self.surface_id = surface_id

    def to_components(self) -> list[dict[str, Any]]:
        """Serializes the primary tree and all unlinked subtrees into flat component dicts."""
        comps = traverse_and_serialize(self.root)
        for sub_tree in self.unlinked_roots:
            comps.extend(traverse_and_serialize(sub_tree))
        return comps

    def to_update(self, surface_id: str | None = None) -> dict[str, Any]:
        """Packages the tree into an updateComponents envelope for incremental updates."""
        target_id = surface_id or self.surface_id or "main"
        return {
            "updateComponents": {
                "surfaceId": target_id,
                "components": self.to_components(),
            }
        }

    def to_surface(
        self, surface_id: str | None = None, catalog_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Packages the tree into createSurface and updateComponents envelopes for a new surface."""
        target_id = surface_id or self.surface_id or "main"
        create_env: dict[str, Any] = {"createSurface": {"surfaceId": target_id}}
        if catalog_id:
            create_env["createSurface"]["catalogId"] = catalog_id
        return [create_env, self.to_update(target_id)]

    def prune_unlinked(self) -> None:
        """Clears all unlinked subtrees from the container."""
        self.unlinked_roots.clear()


def create_surface(
    surface_id: str,
    root: ComponentBuilderNode,
    *,
    catalog_id: str | None = None,
) -> list[dict[str, Any]]:
    """Creates messages to establish a new surface (createSurface + updateComponents)."""
    return ComponentTree(root=root).to_surface(
        surface_id=surface_id, catalog_id=catalog_id
    )


def update_components(
    surface_id: str,
    root: ComponentBuilderNode,
) -> list[dict[str, Any]]:
    """Creates an incremental surface update message (updateComponents only)."""
    return [ComponentTree(root=root).to_update(surface_id=surface_id)]
```

---

### D. Single-call deserialization utility (`deserialize`)

In **Phase 2**, the `deserialize` function takes raw wire messages, update envelopes, or component lists, rebuilds the primary AST root, and collects any unlinked subtrees into a `ComponentTree`:

```python
from typing import Any, Mapping, Sequence
from pydantic import TypeAdapter
from a2ui.builder.base import ComponentBuilderNode, ComponentTree
from a2ui.builder.catalogs.basic import Component


def deserialize(
    payload: Mapping[str, Any] | Sequence[Mapping[str, Any]] | str,
    adapter: TypeAdapter[Any] = TypeAdapter(Component),
) -> ComponentTree:
    """Rebuilds a typed ComponentTree from an A2UI payload in a single pass."""
    if isinstance(payload, str):
        import json

        payload = json.loads(payload)

    surface_id = None
    root_id = None

    if isinstance(payload, list):
        components = payload
        # Check if first element is a createSurface or updateComponents envelope
        for item in payload:
            if isinstance(item, dict):
                if "createSurface" in item:
                    surface_id = item["createSurface"].get("surfaceId")
                elif "updateComponents" in item:
                    surface_id = item["updateComponents"].get("surfaceId")
                    components = item["updateComponents"].get("components", [])
                    break
    elif isinstance(payload, dict):
        surface_id = payload.get("surfaceId")
        root_id = payload.get("rootId")
        if "updateComponents" in payload:
            surface_id = payload["updateComponents"].get("surfaceId", surface_id)
            components = payload["updateComponents"].get("components", [])
        else:
            components = payload.get("components", [])
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

    return ComponentTree(
        root=root_node,
        unlinked_roots=unlinked_roots,
        surface_id=surface_id,
    )
```

---

## 5. Developer experience examples

### Example 1: Macro authoring and expansion (no surface envelope)

A macro defines a reusable component subtree. It returns a component node directly, and the macro runtime flattens it without creating a surface envelope:

```python
from a2ui.builder import Action
from a2ui.builder.catalogs.basic import Button, Card, Column, Text
from a2ui.macros import macro


@macro
def ServerStatusCard(name: str, status: str) -> Card:
    """Returns a component tree. No surface concept needed."""
    return Card(
        child=Column(
            children=[
                Text(text=name, variant="h3"),
                Text(text=f"Status: {status}"),
                Button(
                    child=Text(text="Restart"),
                    action=Action(event="restart_server", context={"server": name}),
                ),
            ]
        )
    )


# Macro runtime execution:
card = ServerStatusCard("Primary DB", "healthy")
# Slices directly into host message as flat component dicts:
expanded_components = card.to_components(prefix="macro_inst_1")
```

### Example 2: MCP server creating a new tool surface

An MCP tool creates an interactive view on a new surface:

```python
from a2ui.builder import create_surface
from a2ui.builder.catalogs.basic import Card, Column, Row, Text


@mcp.tool()
def view_flight_status(flight_number: str) -> list[dict]:
    flight = db.lookup(flight_number)

    layout = Card(
        child=Column(
            children=[
                Text(text=f"Flight {flight.number}", variant="h2"),
                Row(
                    children=[
                        Text(text=f"Depart: {flight.origin}"),
                        Text(text=f"Arrive: {flight.destination}"),
                    ]
                ),
                Text(text=f"Status: {flight.status}"),
            ]
        )
    )

    # Returns [{"createSurface": ...}, {"updateComponents": ...}]
    return create_surface(surface_id="flight-view", root=layout)
```

### Example 3: MCP server performing an incremental patch

An MCP tool responds to a button click by updating a single card on the existing surface without resetting state:

```python
from a2ui.builder import update_components
from a2ui.builder.catalogs.basic import Card, Text


@mcp.tool()
def refresh_gate(flight_number: str) -> list[dict]:
    new_gate = db.fetch_latest_gate(flight_number)

    # Targets specific existing component ID on the surface
    updated_gate = Card(
        id="gate-info-card",
        child=Text(text=f"Updated Gate: {new_gate}", variant="h4"),
    )

    # Returns ONLY [{"updateComponents": ...}] targeting the existing surface
    return update_components(surface_id="flight-view", root=updated_gate)
```

### Example 4: Deserializing and mutating orphaned subtrees

A service receives an update containing an unknown container (`VideoPlayer`) that holds known children (`Column`, `Text`):

```python
from a2ui.builder import deserialize
from a2ui.builder.catalogs.basic import Card, Column, Text, UnknownComponent

raw_payload = {
    "updateComponents": {
        "surfaceId": "media_player_surface",
        "components": [
            {"id": "card_0", "component": "Card", "child": "player_0"},
            {
                "id": "player_0",
                "component": "VideoPlayer",
                "src": "video.mp4",
                "overlay": "col_0",
            },
            {"id": "col_0", "component": "Column", "children": ["txt_0"]},
            {"id": "txt_0", "component": "Text", "text": "Play Video"},
        ],
    }
}

# 1. Rebuild hierarchy into a ComponentTree
tree = deserialize(raw_payload)

# 2. Surface ID is preserved from the incoming envelope
assert tree.surface_id == "media_player_surface"

# 3. Primary root is typed
assert isinstance(tree.root, Card)
assert isinstance(tree.root.child, UnknownComponent)

# 4. Disconnected subtrees are preserved as typed models
assert len(tree.unlinked_roots) == 1
overlay_col = tree.unlinked_roots[0]
assert isinstance(overlay_col, Column)

# Mutate unlinked subtree with IDE autocompletion
overlay_text = overlay_col.children[0]
if isinstance(overlay_text, Text):
    overlay_text.text = "Resume Video"

# 5. Re-emit as an incremental update envelope (does not reset surface)
updated_envelope = tree.to_update()
```

---

## 6. Complexity costs, trade-offs, and edge cases

Supporting bidirectional deserialization expands the builder library from a write-only generator to an AST round-trip engine. This section outlines the architectural complexity costs, trade-offs, and edge cases.

### A. Architectural complexity cost

1. **Model annotation overhead:** Write-only builders use plain dataclasses. Supporting deserialization requires Pydantic `WrapValidator` hooks on slots, polymorphic discriminated unions across catalog components, and `__pydantic_extra__` capture.
2. **Contextual state management:** Deserialization requires passing validation contexts (`context={"components": by_id, "_visited": set()}`) to resolve string IDs, prevent recursion loops, and track unlinked subtrees.
3. **Dual ID lifecycle:** Programmatic authors omit component IDs to let serializers generate sequential identifiers (`comp_0`, `comp_1`). Deserialized layouts retain explicit wire IDs. The serializer must manage both modes without ID collisions.
4. **Third-party dependency:** Deserialization relies on Pydantic v2.

---

### B. Pros and cons of supporting deserialization

| Advantages (Pros)                                                                                                      | Trade-offs & Costs (Cons)                                                                                                     |
| :--------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **Enables read-modify-write workflows:** Agents can ingest existing templates, update properties, and emit updates.    | **Higher cognitive surface area:** Developers must understand the relationship between `tree.root` and `tree.unlinked_roots`. |
| **Enables middleware and proxies:** Intermediary services can inspect, filter, or decorate payloads without data loss. | **Memory overhead during deserialization:** Constructing Pydantic models uses more memory than raw JSON pass-through.         |
| **Consistent developer ergonomics:** Reconstructed ASTs behave identically to hand-crafted Python object trees.        | **ID mutation subtleties:** Modifying child relationships manually requires care when re-assigning IDs.                       |
| **Automated validation of incoming payloads:** Malformed structures are rejected immediately during deserialization.   | **Catalog synchronization:** Deserializing into typed classes requires maintaining generated catalog packages in sync.        |

---

### C. Edge cases and limitations where deserialization encounters challenges

#### 1. Shared child references (DAG topologies vs. pure trees)

The flat A2UI wire format allows multiple parent components to reference the same child ID (forming a Directed Acyclic Graph). In a hierarchical Python object tree, components have a single parent. When deserializing, shared components are shared by reference; tree traversals must avoid serializing the shared node twice.

#### 2. The "ghost component" problem on unknown container deletion

If a wire payload contains an unknown container holding known children:

```
Card -> VideoPlayer (unknown) -> Column -> Text
```

During deserialization, `Column -> Text` is preserved in `tree.unlinked_roots`.

If a developer subsequently replaces the card's child in Python:

```python
tree.root.child = Text(text="Replaced Video")
```

The deserializer cannot determine whether the subtrees in `tree.unlinked_roots` belonged to the deleted `VideoPlayer` or were independent widgets. If the developer does not call `tree.prune_unlinked()`, calling `tree.to_components()` will continue to output `Column` and `Text` as unused "ghost components".

#### 3. Dynamic template loops (`DynamicChildList`)

Repeating lists use `DynamicChildList` to bind an array data path to a template component ID:

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

During deserialization, `user_card_template` is a prototype definition, not a concrete child list. The deserializer must recognize `template` as a template slot rather than expecting a flat list of concrete components.

#### 4. Malformed cyclic wire graphs

Corrupted or hostile wire payloads can define circular references:

```json
[
  {"id": "comp_A", "component": "Card", "child": "comp_B"},
  {"id": "comp_B", "component": "Card", "child": "comp_A"}
]
```

Without cycle tracking (`context["_visited"]`), recursive validation causes a `RecursionError`. The deserializer catches repeated IDs in the active branch and raises a validation error.

#### 5. String literal vs. path binding ambiguity

If an un-annotated or loosely typed field receives a string value like `"/user/name"`, the deserializer must determine whether it is a plain text literal or an un-enveloped data binding path. Strict schema typing prevents incorrect coercions.

#### 6. Cross-version property renaming

If an upstream catalog renames a property (such as `label` to `title`), deserializing older payloads into newer Pydantic models stores `label` in `__pydantic_extra__` and leaves `title` as `None`. Custom schema migration hooks are required to map old names to new attributes.

---

## 7. Design decisions and rationale

1. **Why `ComponentTree` and envelope helpers instead of `Surface`:** A Surface is a persistent client-side rendering target. Agent builders construct component trees, which may be macro expansions, incremental patches, or new layouts. Decoupling them prevents conflating the component tree with the client canvas and avoids wiping client state on incremental updates.
2. **Why Pydantic v2:** Pydantic is already the schema foundation of `a2ui_core` and the broader agent ecosystem (`google-genai`, LangChain). Using Pydantic avoids maintaining separate parsing engines while offering C/Rust performance.
3. **Why `WrapValidator` over pre-expansion:** Pre-expanding dictionaries into temporary JSON trees creates unnecessary Python dictionary overhead and relies on string-matching heuristics. `WrapValidator` operates directly during Pydantic's native type validation pass, ensuring only fields explicitly declared as slots are resolved.
4. **Why `extra="forbid"` for authoring and `extra="allow"` for unknown components:** Strict validation on standard models prevents typo bugs when writing code, while permissive parsing on `UnknownComponent` ensures unknown wire elements are preserved during round-trips.
5. **Why typed unlinked subtrees:** When an unknown container obscures slot relationships, parsing disconnected components into typed Pydantic models preserves developer ergonomics, inspection tooling, and unified serialization without degrading to raw untyped dictionaries.

---

## 8. Phased implementation roadmap

### Phase 1: Pydantic foundation, fluent authoring, and serialization (Immediate)

Phase 1 establishes authoring ergonomics, strict validation, and explicit serialization packaging.

#### Scope of Phase 1

1. **Pydantic base models (`a2ui.builder.base`):**
   - Convert `ComponentBuilderNode` from `@dataclass` to `pydantic.BaseModel`.
   - Configure `model_config = ConfigDict(extra="forbid", populate_by_name=True, validate_assignment=True)`.
   - Add `.to_components()` directly to `ComponentBuilderNode`.
   - Convert supporting types (`Action`, `DataBinding`, `AccessibilityAttributes`, `FunctionCall`, `CheckRule`, `DynamicChildList`) to Pydantic models.
   - Define initial slot type aliases: `Slot: TypeAlias = ComponentBuilderNode` and `SlotList: TypeAlias = Sequence[Slot]`.
2. **Component tree and envelope helpers (`a2ui.builder.base`):**
   - Implement `ComponentTree` with `.to_components()`, `.to_update()`, `.to_surface()`, and `.prune_unlinked()`.
   - Implement top-level functional helpers `create_surface(surface_id, root)` and `update_components(surface_id, root)`.
3. **Code generator migration (`@a2ui/cli`):**
   - Update the Python emitter to generate Pydantic v2 `BaseModel` classes instead of `@dataclass(kw_only=True)`.
   - Emit open enums (`Literal[...] | str`) for all component enum properties to handle future catalog additions.
   - Type child slots as `child: Slot` and multi-child slots as `children: SlotList = ()`.
   - Re-generate the basic catalog builders (`a2ui.builder.catalogs.basic`).
4. **Macro and MCP server alignment:**
   - Macros return `ComponentBuilderNode` (e.g. `Card`), serialized via `.to_components()`.
   - MCP tools call `create_surface()` for new views or `update_components()` for incremental patches.

#### Phase 1 developer benefits

- **Typo detection at edit and run time:** Writing `Button(lable="Save")` raises an immediate Pydantic `ValidationError`.
- **Open enum evolution:** Client code accepts new enum strings introduced by updated catalogs without failing validation.
- **Surface state protection:** Incremental updates use `update_components()`, preventing accidental surface resets.
- **Ecosystem alignment:** Builders integrate directly with Python AI frameworks that use Pydantic models.

---

### Phase 2: Bidirectional AST deserialization (Follow-up)

Phase 2 adds incoming payload parsing, turning flat wire payloads into navigable, mutable `ComponentTree` instances.

#### Scope of Phase 2

1. **Contextual slot resolution:**
   - Upgrade `Slot` in `a2ui.builder.base` to use `Annotated[ComponentBuilderNode, WrapValidator(_resolve_slot)]`.
   - Resolve wire string IDs to concrete child instances in a single pass using validation context (`info.context["components"]`).
2. **Catalog evolution models:**
   - Introduce `UnknownComponent(ComponentBuilderNode)` with `model_config = ConfigDict(extra="allow")`.
   - Generate the discriminated union `Component = Annotated[Union[..., UnknownComponent], Field(discriminator="component")]`.
3. **Deserialization entrypoint:**
   - Implement `deserialize(payload) -> ComponentTree`.
   - Reconstruct primary hierarchies into `tree.root` and preserve unlinked subtrees in `tree.unlinked_roots`.
   - Preserve `tree.surface_id` when deserializing from an `updateComponents` or `createSurface` envelope.

---

### Non-breaking API guarantees

Transitioning from Phase 1 to Phase 2 introduces zero breaking changes to existing authoring code:

| Element                       | Phase 1 (Authoring & Serialization)       | Phase 2 (Deserialization Added)                                        | Compatibility Impact                                                                                                                 |
| :---------------------------- | :---------------------------------------- | :--------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Constructor signatures**    | `Card(child=Column(...))`                 | `Card(child=Column(...))`                                              | **Non-breaking:** Constructor signatures and kwargs remain identical.                                                                |
| **`Slot` type alias**         | `Slot = ComponentBuilderNode`             | `Slot = Annotated[ComponentBuilderNode, WrapValidator(_resolve_slot)]` | **Non-breaking:** Passing a model instance directly passes through the `WrapValidator`. Existing Python instantiation is unaffected. |
| **`ComponentTree` container** | `ComponentTree(root)`                     | `ComponentTree(root, unlinked_roots=(), surface_id=None)`              | **Non-breaking:** Constructor arguments default to empty/None.                                                                       |
| **`deserialize()`**           | Not present                               | Added as a new top-level function                                      | **Non-breaking:** Additive API; existing code does not call it.                                                                      |
| **`UnknownComponent`**        | Not present                               | Added to catalog module                                                | **Non-breaking:** Additive fallback class for unrecognized wire payloads.                                                            |
| **Envelope helpers**          | `create_surface()`, `update_components()` | `create_surface()`, `update_components()`                              | **Non-breaking:** Function signatures and behaviors remain identical.                                                                |
| **Direct serialization**      | `node.to_components()`                    | `node.to_components()`                                                 | **Non-breaking:** Existing flattening logic produces identical wire messages.                                                        |
