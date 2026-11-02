# A2UI macros (`MacroExpander`)

Macros let developers expose high-level, domain-specific UI components to language models while lowering them to standard A2UI primitive components on the server before sending messages to the renderer.

Rather than binding to one syntax or inference format, macros work as a catalog and message transformer through `MacroExpander`.

## Overview

When models author raw A2UI component trees directly, recurring UI patterns can take many lines of nested components, bindings, and actions. With `@macro`, a Python function defines a reusable composite component once:

1. At prompt time, `MacroExpander` exposes JSON Schema definitions for registered macros so any inference format (`ExpressFormat`, `DirectJsonFormat`, `ElementalFormat`) can include them in prompts and validate model output.
2. At transport time, `MacroExpander.transform_to_transport` expands macro invocations in outbound messages (`createSurface`, `updateComponents`, `surfaceUpdate`) into flat primitive component lists. The client renderer only needs to know the underlying primitive catalogs.

## Defining macros with `@macro`

The `@macro` decorator inspects a function's type annotations and docstring to synthesize a catalog component schema and coerce incoming wire arguments into typed builder objects.

```python
from a2ui.builder.v1_0 import Action, Button, Card, Column, DynamicString, Text
from a2ui.transformers.macros import macro


@macro
def ProductCard(
    title: DynamicString,
    price: str,
    on_buy: Action,
    in_stock: bool = True,
) -> Card:
    """Renders a product showcase card.

    Args:
        title: Display name of the product.
        price: Formatted price string.
        on_buy: Action triggered when the user clicks buy.
        in_stock: Whether the item is available for purchase.
    """
    return Card(
        child=Column(
            children=[
                Text(text=title, variant="body"),
                Text(text=price, variant="caption"),
                Button(
                    child=Text(text="Buy Now" if in_stock else "Out of Stock"),
                    action=on_buy,
                    variant="primary",
                ),
            ]
        )
    )
```

Both `a2ui.builder.v1_0` and `a2ui.builder.v0_9` are supported. Each macro and `MacroExpander` targets a single protocol family (`1.0` or `0.9`); mixing v0.9 and v1.0 types, catalogs, or returned builder nodes raises `A2uiValidationError`. In v1.0, macro names must be valid UAX #31 identifiers and cannot use the reserved name `Surface`.

### Parameter type mapping

`@macro` maps Python type annotations to A2UI JSON Schema definitions and coerces incoming model arguments before calling the Python function:

| Python annotation                                                                                      | Synthesized JSON Schema                            | Runtime coercion                                                                                                                                                                                |
| :----------------------------------------------------------------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `str`, `int`, `float`, `bool`                                                                          | `string`, `integer`, `number`, `boolean`           | Passed through as primitives (dict bindings rejected).                                                                                                                                          |
| `Literal[...]` or `Enum`                                                                               | `enum` schema                                      | Passed through.                                                                                                                                                                                 |
| `Child`, `ComponentBuilderNode`, or component subclass                                                 | `common_types.json#/$defs/ComponentId`             | Component ID string coerced to `ComponentRef(id=...)`.                                                                                                                                          |
| `ChildList`, `DynamicChildList`, or `Sequence[Child]`                                                  | `common_types.json#/$defs/ChildList`               | ID lists coerced to `list[ComponentRef]`; `{"path": ..., "componentId": ...}` coerced to `DynamicChildList` when typed as `ChildList` or `DynamicChildList`.                                    |
| `Action`                                                                                               | `common_types.json#/$defs/Action`                  | Coerces `"event_name"`, `{"event": "name", ...}`, `{"name": ..., "userMessage": ..., "context": ...}`, `{"@call": ...}` (v1.0) / `{"call": ...}` (v0.9), and full `Action` dicts into `Action`. |
| `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, `DataBinding`, `FunctionCall` | Corresponding `common_types.json#/$defs/...` ref   | Coerces `{"@path": "/..."}` and `{"@call": "...", "args": ...}` in v1.0 (`{"path": "/..."}` and `{"call": "...", "args": ...}` in v0.9) into `DataBinding` and `FunctionCall`.                  |
| `DynamicValue`                                                                                         | `common_types.json#/$defs/DynamicValue`            | Coerces `@path` / `@call` in v1.0 (`path` / `call` in v0.9); in v1.0, plain `{"path": ...}` and `{"call": ...}` maps remain untouched as `LiteralObject` values.                                |
| `CheckRule` or `Sequence[CheckRule]`                                                                   | `common_types.json#/$defs/CheckRule` (or array)    | Coerced to `CheckRule` instances.                                                                                                                                                               |
| `AccessibilityAttributes`                                                                              | `common_types.json#/$defs/AccessibilityAttributes` | Coerced to `AccessibilityAttributes` when declared on the macro signature; otherwise merged onto the expanded root component.                                                                   |

### Docstring parsing

`@macro` reads both Google-style (`Args:`) and Sphinx-style (`:param name: description`) docstrings. The summary paragraph becomes the component's `description`, and per-parameter descriptions populate each property's `description` in the generated schema.

## Integrating with inference formats

### Mixable catalogs in v1.0 (sidecar macro catalog)

In A2UI v1.0, a surface can mix components from multiple catalogs by tagging each component with its `catalogId`. The recommended setup exports the macros as a standalone sidecar catalog with `expander.to_catalog()` and passes it alongside your primitive catalogs to the inference format.

Inside a macro that emits components from multiple catalogs, set `catalog_id` on each custom `ComponentBuilderNode` subclass (or per node instance) so every expanded primitive carries its own explicit `catalogId` on the wire:

```python
from typing import Literal

from a2ui.builder.v1_0 import Action, ChildList, ComponentBuilderNode, DynamicString
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart
from a2ui.transformers.macros import MacroExpander, macro

FOO_CID = "https://example.com/catalogs/foo/v1/catalog.json"
BAR_CID = "https://example.com/catalogs/bar/v1/catalog.json"


class FooPanel(ComponentBuilderNode):
    component: Literal["FooPanel"] = "FooPanel"
    catalog_id: str | None = FOO_CID
    children: ChildList


class FooHeader(ComponentBuilderNode):
    component: Literal["FooHeader"] = "FooHeader"
    catalog_id: str | None = FOO_CID
    title: DynamicString


class BarAction(ComponentBuilderNode):
    component: Literal["BarAction"] = "BarAction"
    catalog_id: str | None = BAR_CID
    label: str
    action: Action


@macro
def BazMacro(
    title: DynamicString,
    cta_label: str,
    on_cta: Action,
) -> FooPanel:
    """Combines FooCatalog layout and header with a BarCatalog action."""
    return FooPanel(
        children=[
            FooHeader(title=title),
            BarAction(label=cta_label, action=on_cta),
        ]
    )


# 1. Register base catalogs on the expander and export the macro sidecar catalog
expander = MacroExpander([BazMacro], base_catalogs=[foo_catalog, bar_catalog])
macro_catalog = expander.to_catalog()

# 2. Pass the primitive catalogs plus the macro sidecar catalog to the format
fmt = ExpressFormat(
    catalogs=[foo_catalog, bar_catalog, macro_catalog],
    surface_id="main",
)
system_prompt = fmt.prompt_generator.generate()

# 3. Parse and validate model output against all three catalogs
parts = fmt.create_parser().parse_response(llm_output)

# 4. Lower macro components into FooCatalog and BarCatalog primitives for the renderer
transport_messages = [
    msg
    for part in parts
    if isinstance(part, A2uiPart)
    for msg in expander.transform_to_transport(part.a2ui)
]
```

When `fmt` receives multiple v1.0 catalogs, unique component names (`FooHeader`, `BarBadge`, `BazMacro`) resolve to their owning `catalogId` automatically without requiring `catalogId=` at every call site in the DSL. After `transform_to_transport`, `BazMacro` is replaced by `FooHeader`, `BarAction`, and `FooPanel` carrying `FOO_CID` and `BAR_CID`, so the client renderer only needs `foo_catalog` and `bar_catalog`.

### Single-catalog surfaces (`transform_to_inference_catalog`)

When a surface uses a single base catalog (including v0.9 surfaces, where every surface binds one `catalogId`), augment that catalog in place with `transform_to_inference_catalog`:

```python
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart
from a2ui.transformers.macros import MacroExpander

expander = MacroExpander([ProductCard])
inference_catalog = expander.transform_to_inference_catalog(base_catalog)

fmt = ExpressFormat([inference_catalog], surface_id="main")
system_prompt = fmt.prompt_generator.generate()

parts = fmt.create_parser().parse_response(llm_output)
transport_messages = [
    msg
    for part in parts
    if isinstance(part, A2uiPart)
    for msg in expander.transform_to_transport(part.a2ui)
]
```

`MacroExpander.transform_to_inference_catalog` also satisfies the `CatalogTransformer` protocol used by `CatalogConfig(catalog=base_catalog, transformers=[expander])` for prompt and catalog negotiation; call `expander.transform_to_transport(...)` on parsed `A2uiPart.a2ui` messages before sending them over the transport.

### Filtering base primitives (`passthrough_components`)

When augmenting a catalog via `transform_to_inference_catalog`, all base catalog components remain available by default. Pass `passthrough_components` to restrict which base primitives stay in the inference catalog alongside your macros:

```python
# Expose macros plus Button only:
expander = MacroExpander([ProductCard], passthrough_components=["Button"])

# Expose only the macros with zero base primitives:
expander = MacroExpander([ProductCard], passthrough_components=[])
```

### Sharing a `MacroExpander` across sessions (`surface_catalogs`)

By default, a `MacroExpander` instance records `createSurface` and `deleteSurface` messages so subsequent `updateComponents` calls on the same surface know its default `catalogId`. Keep one `MacroExpander` per session, or pass `surface_catalogs` on each `transform_to_transport` call to avoid mutating instance state:

```python
transport_messages = expander.transform_to_transport(
    messages,
    surface_catalogs={"main": None},  # None indicates a defaultless v1.0 surface
)
```
