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
