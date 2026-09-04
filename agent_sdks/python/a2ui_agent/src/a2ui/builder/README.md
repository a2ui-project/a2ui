# A2UI Python builder API

This package provides type-safe Python models for constructing A2UI component trees and generating protocol-compliant wire messages.

## Overview

A2UI represents interfaces as flat arrays of components, where parent components reference child components by string IDs. Writing this flat representation by hand or constructing dictionaries manually is error-prone.

The builder API allows developers and agents to author interfaces as nested Python objects. The library assigns component IDs, converts parent-child relationships into ID references, and serializes the tree into standard protocol envelopes.

## Core concepts

### Tree construction

Components are instantiated as Python objects. Containers accept child components through designated slot parameters:

```python
from a2ui.builder.catalogs.basic import Card, Column, Text, Button, Action

tree = Card(
    child=Column(
        children=[
            Text(text="Account Overview", variant="h2"),
            Button(
                child=Text(text="View Details"),
                action=Action(event="view_details", context={"accountId": "123"}),
            ),
        ]
    )
)
```

### Flattening and ID assignment

Calling `flatten_component_tree(tree)` or `tree.to_components()` converts the nested tree into a flat list of component dictionaries:

1. Traverses the hierarchy recursively.
2. Assigns deterministic IDs to components that do not have an explicit `id` specified (for example, `Card_0`, `Column_1`, `Text_2`).
3. Replaces child object references in parent properties (`child`, `children`, and dictionary slots) with the assigned string IDs.

```python
components = tree.to_components()
```

### Message envelopes

Helper functions package component trees into standard A2UI envelopes:

* `create_surface`: Generates both `createSurface` and initial `updateComponents` envelopes.
* `update_components`: Generates an `updateComponents` envelope for existing surfaces.

```python
from a2ui.builder.base import create_surface, update_components

# Initial surface creation
messages = create_surface(
    "surface_main",
    root=tree,
    catalog_id="org.a2ui.basic",
)

# Updating an existing surface
update = update_components("surface_main", root=tree)
```

### Data bindings

The `bind` helper constructs dynamic references to client data model paths:

```python
from a2ui.builder.base import bind

status_text = Text(text=bind("/user/status"), variant="caption")
```

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
from typing import Any, Literal, Optional
from a2ui.builder.base import (
    Action,
    ComponentBuilderNode,
    DataBinding,
    FunctionCall,
    Slot,
    _serialize_prop,
)

ButtonVariant = Literal["default", "primary", "borderless"] | str

class Button(ComponentBuilderNode):
    r"""Button component."""

    component: Literal["Button"] = "Button"
    accessibility: Optional[Any] = None
    weight: Optional[float] = None
    child: Slot
    variant: Optional[ButtonVariant] = "default"
    action: Action

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"component": self.component}
        if self.accessibility is not None:
            d["accessibility"] = _serialize_prop(self.accessibility)
        if self.weight is not None:
            d["weight"] = _serialize_prop(self.weight)
        if self.child is not None:
            d["child"] = _serialize_prop(self.child)
        if self.variant is not None:
            d["variant"] = _serialize_prop(self.variant)
        if self.action is not None:
            d["action"] = _serialize_prop(self.action)
        if self.id is not None:
            d["id"] = self.id
        return d
```

Key characteristics:
* `component`: Literal string constant matching the catalog component identifier.
* Slots: Parameters accepting children (`child: Slot`, `children: SlotList | DynamicChildList`) accept nested `ComponentBuilderNode` instances or data-bound templates.
* Properties: Primitive properties accept static values, `DataBinding` instances, or `FunctionCall` objects.
* `to_dict`: Serializes node properties while preserving unassigned IDs for the allocator.

### Function builder helpers

Catalogs define client-evaluated functions (such as formatters, validators, and logical operators). The code generator emits helper functions that return `FunctionCall` objects:

```python
from typing import Any, Optional
from a2ui.builder.base import DataBinding, FunctionCall

def open_url(
    *,
    url: str | DataBinding | FunctionCall,
    call_id: Optional[str] = None,
) -> FunctionCall:
    r"""Opens a URL in the client browser."""
    args: dict[str, Any] = {}
    if url is not None:
        args["url"] = url.to_dict() if hasattr(url, "to_dict") else url
    return FunctionCall(call="openUrl", args=args, call_id=call_id)
```

These helpers can be passed directly to component properties that accept dynamic values:

```python
action = Action(
    event="open_site",
    context={"target": open_url(url="https://a2ui.org")},
)
```

## Inheritance and customization

### Extending standard components

You can subclass generated components to create domain-specific building blocks with preconfigured styling, accessibility, or defaults:

```python
from typing import Any
from a2ui.builder.catalogs.basic import Button, Text, Action

class PrimaryActionButton(Button):
    """Button configured with primary styling and default event name."""

    variant: str = "primary"

    @classmethod
    def create(cls, label: str, event_name: str, **context: Any) -> "PrimaryActionButton":
        return cls(
            child=Text(text=label),
            action=Action(event=event_name, context=context),
            variant="primary",
        )
```

### Creating custom components

You can define custom components that are not in the official catalog schema by subclassing `ComponentBuilderNode`:

```python
from typing import Any, Literal, Optional
from a2ui.builder.base import ComponentBuilderNode, Slot, _serialize_prop

class MetricCard(ComponentBuilderNode):
    """Custom metric card component."""

    component: Literal["MetricCard"] = "MetricCard"
    label: str
    value: str
    trend: Optional[str] = None
    icon: Optional[Slot] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "component": self.component,
            "label": self.label,
            "value": self.value,
        }
        if self.trend is not None:
            d["trend"] = self.trend
        if self.icon is not None:
            d["icon"] = _serialize_prop(self.icon)
        if self.id is not None:
            d["id"] = self.id
        return d
```

Because `MetricCard` inherits from `ComponentBuilderNode`:
* It participates in tree traversal and deterministic ID allocation automatically.
* Any child components placed in `icon` are discovered, assigned IDs, and replaced with ID references.
* It passes validation when nested inside standard containers (`Card`, `Column`, `Row`).

## Design decisions

### Pydantic validation

`ComponentBuilderNode` inherits from Pydantic `BaseModel`. This provides:

* Static typing and auto-completion in Python IDEs.
* Validation of required arguments and property types when nodes are constructed.
* Serialization logic via standard model configurations.

### Authoring versus deserialization

`ComponentBuilderNode` uses `extra="forbid"` during authoring.

When writing UI code in Python, misspelled properties or unsupported attributes raise an immediate `ValidationError` during construction. This prevents bad payloads from reaching the network or failing silently on the client renderer.

For wire deserialization, a separate permissive mode (`extra="allow"`) and an `UnknownComponent` fallback will be used to preserve unrecognized fields during round-tripping.

### Open enums

Enum properties are typed as unions with `str`:

```python
TextVariant = Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"] | str
ButtonVariant = Literal["default", "primary", "borderless"] | str
```

This prevents runtime validation crashes when an agent or client uses valid variants from newer or alternate catalog versions that are not defined in the local schema snapshot.

### Decoupled component trees

A `ComponentTree` is independent of any specific surface ID or transport connection. A subtree can be defined in isolation, passed to sub-agents, returned from MCP tools, or embedded inside macros before binding it to a target surface.

### Mapping traversal

Components nested within arbitrary key-value mappings (such as tab item definitions in `Tabs`) are recursively visited during flattening. ID allocation and serialization handle dictionaries and lists without special casing.
