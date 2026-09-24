# A2UI Python builder API

This package provides type-safe Python models for constructing A2UI component trees and generating protocol-compliant wire messages.

## Overview

A2UI represents interfaces as flat arrays of components, where parent components reference child components by string IDs. Writing this flat representation by hand or constructing dictionaries manually is error-prone.

The builder API allows developers and agents to author interfaces as nested Python objects. The library assigns component IDs, converts parent-child relationships into ID references, and serializes the tree into standard protocol envelopes.

## Core concepts

### Tree construction

Components are instantiated as Python objects. Containers accept child components through designated slot parameters:

```python
from a2ui.builder.v0_9 import Action, ActionEvent
from a2ui.builder.v0_9.catalogs.basic import Card, Column, Text, Button

tree = Card(
    child=Column(
        children=[
            Text(text="Account Overview", variant="h2"),
            Button(
                child=Text(text="View Details"),
                action=Action(event=ActionEvent(name="view_details", context={"accountId": "123"})),
            ),
        ]
    )
)
```

### Flattening and ID assignment

Calling `flatten_component_tree(tree)` or `tree.flatten()` converts the nested tree into a flat list of component dictionaries:

1. Assigns deterministic IDs to components without an explicit `id` (for example, `panel__text_1`), reserving author-supplied IDs first so allocation cannot collide with one.
2. Replaces nested child objects with their allocated ID strings.
3. Emits children before their parents, so every reference in the list resolves to a component that already appeared.

The traversal itself is Pydantic's. Child resolution is attached to the `Child` slot type as a serializer rather than performed by a separate reflective walk over the object graph, so aliases, defaults, `exclude_none` and nested models behave exactly as they do everywhere else in Pydantic. The builder only supplies the ID allocator and the flat output list.

```python
components = tree.flatten()
```

### Packaging into message envelopes

Flattened component trees are packaged into standard A2UI server-to-client messages using models from `a2ui.core.schema.server_to_client`:

```python
from a2ui.core.schema.server_to_client import (
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)

# 1. Initial surface creation
messages = [
    CreateSurfaceMessage(
        create_surface=CreateSurface(
            surface_id="surface_main",
            catalog_id="https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        )
    ),
    UpdateComponentsMessage(
        update_components=UpdateComponents(
            surface_id="surface_main",
            components=tree.flatten(),
        )
    ),
]

# 2. Updating an existing surface
update_message = UpdateComponentsMessage(
    update_components=UpdateComponents(
        surface_id="surface_main",
        components=tree.flatten(),
    )
)
```

### Data bindings

`DataBinding` constructs dynamic references to client data model paths. The path is emitted exactly as written, because the leading slash is meaningful:

- **Absolute** (`/user/status`) resolves from the root of the data model, wherever the component is rendered.
- **Relative** (`status`) resolves against the enclosing scope. A `DynamicChildList` template creates one scope per item, so a relative path addresses the current item.

```python
from a2ui.builder.v0_9 import DataBinding

status_text = Text(text=DataBinding(path="/user/status"), variant="caption")
```

> Because both forms are preserved, a template's children can bind to their own item with `DataBinding(path="title")` while still reaching global state with `DataBinding(path="/account/plan")`.

When serialized, this emits the standard binding object:

```json
{
  "path": "/user/status"
}
```

## Component and function builder reference

Generated catalog packages contain two categories of constructs: component builder classes and function builder helpers.

### Component builder classes

Component classes inherit from `ComponentBuilderNode` and define the properties specified in their catalog schema:

```python
from typing import Annotated, Literal, Optional, Sequence
from a2ui.builder.v0_9 import (
    OPEN_ENUM,
    AccessibilityAttributes,
    Action,
    CheckRule,
    Child,
    ComponentBuilderNode,
)

ButtonVariant = Annotated[Literal["default", "primary", "borderless"], OPEN_ENUM]

class Button(ComponentBuilderNode):
    r"""Button component."""

    component: Literal["Button"] = "Button"
    accessibility: Optional[AccessibilityAttributes] = None
    weight: Optional[float] = None
    checks: Optional[Sequence[CheckRule]] = None
    child: Child
    variant: Optional[ButtonVariant] = "default"
    action: Action
```

Key characteristics:

- `component`: Literal string constant matching the catalog component identifier.
- Children: parameters annotated `Child` or `ChildList` accept nested `ComponentBuilderNode` instances, an external `ComponentRef`, or a `DynamicChildList` template. The annotation is what makes them resolve to ID references on the wire.
- Properties: primitive properties accept static values, `DataBinding` instances, or `FunctionCall` objects.
- Fields use Python `snake_case` names with a `serialization_alias` where the wire name differs, so `validation_regexp` emits as `validationRegexp`.

### Function builder classes

Catalogs define client-evaluated functions (such as formatters, validators, and logical operators). The code generator emits one class per function, each a `FunctionCall` subclass with typed arguments:

```python
from typing import Any
from a2ui.builder.v0_9 import DataBinding, FunctionCall

class OpenUrl(FunctionCall):
    r"""Invokes catalog function openUrl."""

    def __init__(self, *, url: str, **kwargs: Any):
        super().__init__(call="openUrl", args={"url": url}, **kwargs)
```

An `Action` carries exactly one of a server event or a client function call, matching the spec's `oneOf`. Supplying both, or neither, raises a `ValidationError` at construction:

```python
from a2ui.builder.v0_9 import Action, ActionEvent

# Server event, with an optional context map.
action = Action(event=ActionEvent(name="open_site", context={"target": "docs"}))

# Client function call.
action = Action(function_call=OpenUrl(url="https://a2ui.org"))
```

## Inheritance and customization

### Extending standard components

You can subclass generated components to create domain-specific building blocks with preconfigured styling, accessibility, or defaults:

```python
from typing import Any
from a2ui.builder.v0_9 import Action, ActionEvent
from a2ui.builder.v0_9.catalogs.basic import Button, Text

class PrimaryActionButton(Button):
    """Button configured with primary styling and default event name."""

    variant: str = "primary"

    @classmethod
    def create(cls, label: str, event_name: str, **context: Any) -> "PrimaryActionButton":
        return cls(
            child=Text(text=label),
            action=Action(event=ActionEvent(name=event_name, context=context)),
            variant="primary",
        )
```

### Creating custom components

You can define custom components that are not in the official catalog schema by subclassing `ComponentBuilderNode`:

```python
from typing import Literal, Optional
from a2ui.builder.v0_9 import ComponentBuilderNode, Child

class MetricCard(ComponentBuilderNode):
    """Custom metric card component."""

    component: Literal["MetricCard"] = "MetricCard"
    label: str
    value: str
    trend: Optional[str] = None
    icon: Optional[Child] = None
```

Because `MetricCard` inherits from `ComponentBuilderNode` and annotates `icon` as `Child`:

- Any child component placed in `icon` is assigned an ID and replaced with an ID reference.
- No custom serialization code is required, or accepted: annotating the slot is the whole mechanism.
- It passes validation when nested inside standard containers (`Card`, `Column`, `Row`).

## Code generation

Everything under `v0_9/catalogs/` is generated from the catalog JSON schema by the A2UI CLI (`dart/a2ui_cli`) and should never be edited by hand. Only the runtime in `core/` and `v0_9/` is written directly.

To regenerate after a catalog change:

```sh
cd dart/a2ui_cli
dart run bin/a2ui.dart codegen \
  --catalog ../../specification/v0_9_1/catalogs/basic/catalog.json \
  --out ../../agent_sdks/python/a2ui_agent/src/a2ui/builder/v0_9/catalogs/
```

Pointing `--out` at the directory lets the generator name the module from the catalog ID, which is how the committed filename and the generator stay in step. Passing an explicit `.py` path works too, and is how a catalog whose ID does not make a good module name is handled.

The generator makes a few naming decisions worth knowing, because they determine the public API a catalog exposes:

- **Enums** are named `<Component><Property>`, except where a single type is shared across components (`Row.justify` and `Column.justify` both yield `FlexJustify`). The same value set reached from two places produces one type, regardless of the order the catalog lists it in.
- **Item models** come from inline object schemas. An array property whose singular matches its parent is suffixed (`Tabs.tabs` gives `TabItem`); anything else is qualified by its parent (`ChoicePicker.options` gives `ChoicePickerOption`). A component slot nested inside one of these is annotated `Child` and resolves exactly like a direct slot.
- **Function classes** are the Pascal-case form of the catalog function name (`formatString` gives `FormatString`, `not` gives `Not`). A function is reached only through its class; the generator emits no lowercase alias beside it. Parameter names that collide with a Python keyword take a trailing underscore.
- **Name clashes** are resolved rather than allowed to shadow. `Icon.name` is a `oneOf` of an icon enum and a custom SVG object, both of which want the name `IconName`; the object becomes `IconNameSvgPath` after the property that distinguishes it.

Every branch of a `oneOf` is preserved. Narrowing a property to its most common branch would quietly reject payloads the catalog permits, so `Icon.name` is typed `IconName | IconNameSvgPath | DataBinding | FunctionCall` rather than just the enum.

## Design decisions

### Pydantic owns serialization

No builder model defines a custom serializer or a `to_dict()`. Field shape, aliases, defaults and null handling are Pydantic's, and the wire output is a plain `model_dump`.

The one thing Pydantic cannot express as a field rule is the tree-to-flat-list transformation, because a child both becomes an ID reference in its parent and a new entry in the output list. That is attached to the `Child` type as a `PlainSerializer`, with the ID allocator and output list carried in the serialization context.

The alternative, a reflective walk over `node.__dict__` outside Pydantic, has to reimplement everything Pydantic already does, and gets it subtly wrong: reading raw attribute names means serialization aliases are silently ignored, and each new nested model shape needs another `isinstance` branch.

### Authoring versus deserialization

`ComponentBuilderNode` uses `extra="forbid"` during authoring.

When writing UI code in Python, misspelled properties or unsupported attributes raise an immediate `ValidationError` during construction. This prevents bad payloads from reaching the network or failing silently on the client renderer.

For wire deserialization, dedicated deserialization constructors and an `UnknownComponent` fallback will be used in Phase 2 (#2571) to preserve unrecognized fields during round-tripping.

### Enums: strict when authoring, open when parsing

Enum properties are strict `Literal[...]` sets carrying `OPEN_ENUM` metadata:

```python
TextVariant = Annotated[Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"], OPEN_ENUM]
```

Authoring is unchanged by the metadata: a type checker strips `Annotated` and still sees the bare `Literal`, so `variant="primmary"` is rejected at edit time and again at runtime.

Parsing has the opposite requirement. A client may send a value from a newer catalog revision, and rejecting or dropping it loses information the sender had. Passing `LENIENT_ENUM_CONTEXT` relaxes only that:

```python
from a2ui.builder.v0_9 import LENIENT_ENUM_CONTEXT

Text.model_validate(payload, context=LENIENT_ENUM_CONTEXT)
```

Widening the annotation to `Literal[...] | str` would serve parsing by giving up authoring strictness for everyone. Separating the two modes by context keeps both.

### Decoupled component trees

A subtree is authored without reference to any surface or transport. It can be built in isolation, handed to a sub-agent, returned from an MCP tool, or composed into a larger tree, and only acquires a surface when an envelope helper packages it. Nothing in the builder assumes a particular caller: an MCP server emitting a fixed layout and a macro runtime expanding a parameterised one use the same API.

A `ComponentTree` pairs a primary root with the subtrees that stand alone. Authoring rarely needs it, since a node is already a tree; it earns its place on the parsing side, where a payload does not always reduce to a single root. Its `surface_id` records where a parsed payload came from and is not consulted when authoring.

It deliberately knows nothing about envelopes. Message shape and the protocol version are version-specific, so packaging lives in the versioned `envelopes` module and returns typed message models rather than bare dictionaries.

### Nested model traversal

Components nested within item models (such as `TabItem` inside `Tabs`) or inside arbitrary mappings resolve through the same `Child` serializer as a direct slot. There is no special case: if a field is annotated `Child`, it resolves, wherever it sits.
