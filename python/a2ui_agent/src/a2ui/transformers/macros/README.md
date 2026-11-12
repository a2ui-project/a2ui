# A2UI macros (`MacroExpander`)

Macros let developers expose high-level, domain-specific UI components to language models while lowering them to standard A2UI primitive components on the server before sending messages to the renderer.

Rather than binding to one syntax or inference format, macros work as a catalog and message transformer through [`MacroExpander`](expander.py).

## Overview

When models author raw A2UI component trees directly, recurring UI patterns can take many lines of nested components, bindings, and actions. With [`@macro`](macro.py), a Python function defines a reusable composite component once:

1. At prompt time, `MacroExpander` exposes JSON Schema definitions for registered macros so inference formats (`ExpressFormat`, `DirectJsonFormat`, `ElementalFormat`) can include them in prompts and validate model output.
2. At transport time, `MacroExpander.transform_to_transport` expands macro invocations in outbound messages (`createSurface`, `updateComponents`, `surfaceUpdate`) into flat primitive component lists closed over the registered transport catalogs. The client renderer only needs to know the underlying primitive catalogs.

## Defining macros with `@macro`

The `@macro` decorator inspects a function's type annotations and docstring to synthesize a catalog component schema and coerce incoming wire arguments into typed builder objects. Every macro must return a single root `ComponentBuilderNode` tree.

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

Both `a2ui.builder.v1_0` and `a2ui.builder.v0_9` are supported. Each macro and `MacroExpander` targets one protocol family (`1.0` or `0.9`); mixing v0.9 and v1.0 types, catalogs, or returned builder nodes raises `A2uiValidationError`. In v1.0, macro names must be valid UAX #31 identifiers and cannot use the reserved name `Surface`.

When a standalone v1.0 macro uses only version-neutral annotations (such as `str`, `int`, or `Child`) and no `base_catalogs` are registered yet, pass `protocol_version="1.0"` to `MacroExpander(...)`. Without v1.0 builder types or a registered v1.0 catalog, `to_catalog()` defaults to `"0.9.1"`.

### Parameter type mapping

`@macro` maps Python type annotations to A2UI JSON Schema definitions and coerces incoming model arguments before calling the Python function:

| Python annotation                                                                                      | Synthesized JSON Schema                                                        | Runtime coercion                                                                                                                                                                                |
| :----------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `str`, `int`, `float`, `bool`                                                                          | `string`, `integer`, `number`, `boolean`                                       | Passed through as primitives (dict bindings rejected).                                                                                                                                          |
| `Literal[...]` or `Enum`                                                                               | `enum` schema                                                                  | Passed through.                                                                                                                                                                                 |
| `Child`, `ComponentBuilderNode`, or component subclass                                                 | `common_types.json#/$defs/Child` (v1.0) or `ComponentId` (v0.9)                | Component ID string coerced to `ComponentRef(id=...)`.                                                                                                                                          |
| `ChildList`, `DynamicChildList`, or `Sequence[Child]`                                                  | `common_types.json#/$defs/ChildList`                                           | ID lists coerced to `list[ComponentRef]`; `{"path": ..., "componentId": ...}` coerced to `DynamicChildList` when typed as `ChildList` or `DynamicChildList`.                                    |
| `Action`                                                                                               | `common_types.json#/$defs/Action`                                              | Coerces `"event_name"`, `{"event": "name", ...}`, `{"name": ..., "userMessage": ..., "context": ...}`, `{"@call": ...}` (v1.0) / `{"call": ...}` (v0.9), and full `Action` dicts into `Action`. |
| `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, `DataBinding`, `FunctionCall` | Corresponding `common_types.json#/$defs/...` ref                               | Coerces `{"@path": "/..."}` and `{"@call": "...", "args": ...}` in v1.0 (`{"path": "/..."}` and `{"call": "...", "args": ...}` in v0.9) into `DataBinding` and `FunctionCall`.                  |
| `DynamicValue`                                                                                         | `common_types.json#/$defs/DynamicValue`                                        | Coerces `@path` / `@call` in v1.0 (`path` / `call` in v0.9); in v1.0, plain `{"path": ...}` and `{"call": ...}` maps remain untouched as `LiteralObject` values.                                |
| `CheckRule` or `Sequence[CheckRule]`                                                                   | `common_types.json#/$defs/CheckRule` (or array)                                | Coerced to `CheckRule` instances.                                                                                                                                                               |
| `AccessibilityAttributes`                                                                              | `common_types.json#/$defs/AccessibilityAttributes`                             | Coerced to `AccessibilityAttributes` when declared on the macro signature; otherwise merged onto the expanded root component (see [Envelope fields](#envelope-fields-on-macro-instances)).      |
| `Extensions` (v1.0)                                                                                    | `common_types.json#/$defs/Extensions`                                          | Passed through as an extension map without directive coercion.                                                                                                                                  |
| `dict[str, V]` or `Mapping[str, V]`                                                                    | `object` (with `additionalProperties` schema when `V` is not `Any`)            | Recursively coerces dictionary values against `V` when `V` is not `Any`.                                                                                                                        |
| Catalog sub-models (`TabItem`, `ChoicePickerOption`, `IconNameSvgPath`, `ActionEvent`, `BaseModel`)    | Object schema from `model_fields` (or `array` when wrapped in `Sequence[...]`) | Nested wire fields (`Child` IDs, `@path`, `@call`, and aliases) are coerced before validating the Pydantic model.                                                                               |
| Non-canonical unions (`Literal[...] \| DataBinding`, `IconName \| IconNameSvgPath`)                    | `oneOf` across member schemas                                                  | Coerced against matching union branches.                                                                                                                                                        |

### Envelope fields on macro instances

A macro instance component can carry the component envelope fields `accessibility`, `checks`, and (from v1.0) `metadata`. `transform_to_transport` does not pass them to the macro function. Instead it merges them onto the expanded root component: `accessibility` and `metadata` merge with any value the root already has (including `metadata.extensions`), and `checks` are appended to the root's checks.

From v1.0, these keys carry an `@` prefix on the wire (`@accessibility`, `@checks`, `@metadata`, `@catalogId`), and the expanded root receives the `@` keys. For payloads written before the prefix, the expander also reads the bare keys, unless the macro declares a parameter of that name; a declared bare name is an ordinary macro argument, and only the `@` key is the envelope field. In v0.9, `accessibility` and `checks` stay bare, and `metadata` is dropped.

The instance's `catalogId` (`@catalogId` in v1.0) selects the macro catalog and is not copied onto the expanded root. Lowered v1.0 primitives receive their own `@catalogId` (see [Component-to-catalog resolution](#component-to-catalog-resolution)).

### Docstring and `Annotated` parameter descriptions

`@macro` reads Google-style (`Args:`), Sphinx-style (`:param name: description`), and `typing.Annotated` descriptions (`Annotated[str, Field(description="...")]` or `Annotated[str, "..."]`). An `Annotated` description takes precedence over docstring text, and undocumented parameters omit `description` from the generated schema.

## Integrating with inference formats

### Mixable catalogs in v1.0 (`transform_catalogs` and sidecar catalogs)

In A2UI v1.0, a surface can mix components from multiple catalogs by tagging each component with its `@catalogId`. Pass your transport catalogs through `expander.transform_catalogs([...])` (or construct `MacroExpander(..., base_catalogs=[...])` and append `expander.to_catalog()`). In v1.0, `transform_catalogs` registers the base catalogs on the expander and appends the standalone macro sidecar catalog; in v0.9, it augments the single catalog in place.

For custom catalogs, pass `catalog_id=...` when subclassing `ComponentBuilderNode` to stamp that catalog ID across a family of builder classes. Standard `BasicCatalog("1.0")` widgets (`Card`, `Text`, `Button`) or other primitives whose names belong to a single registered base catalog do not need per-node `catalog_id=` boilerplate: `transform_to_transport` stamps their owning `@catalogId` when lowering onto a multi-catalog surface, and rewrites a pure macro-sidecar `createSurface.catalogId` to the transport catalog (or omits it when multiple base catalogs are registered).

```python
from typing import Literal

from a2ui.builder.v1_0 import (
    Action,
    Card,
    ChildList,
    ComponentBuilderNode,
    DynamicString,
    Text,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart
from a2ui.transformers.macros import MacroExpander, macro

FOO_CID = "https://example.com/catalogs/foo/v1/catalog.json"
BAR_CID = "https://example.com/catalogs/bar/v1/catalog.json"


class FooCatalogNode(ComponentBuilderNode, catalog_id=FOO_CID):
    pass


class BarCatalogNode(ComponentBuilderNode, catalog_id=BAR_CID):
    pass


class FooPanel(FooCatalogNode):
    component: Literal["FooPanel"] = "FooPanel"
    children: ChildList


class FooHeader(FooCatalogNode):
    component: Literal["FooHeader"] = "FooHeader"
    title: DynamicString


class BarAction(BarCatalogNode):
    component: Literal["BarAction"] = "BarAction"
    label: str
    action: Action


@macro
def BazMacro(
    title: DynamicString,
    subtitle: str,
    cta_label: str,
    on_cta: Action,
) -> Card:
    """Combines BasicCatalog, FooCatalog, and BarCatalog components."""
    return Card(
        child=FooPanel(
            children=[
                FooHeader(title=title),
                Text(text=subtitle, variant="caption"),
                BarAction(label=cta_label, action=on_cta),
            ]
        )
    )


# 1. Transform transport catalogs into inference catalogs (appends macro sidecar)
basic_catalog = BasicCatalog("1.0")
expander = MacroExpander([BazMacro])
inference_catalogs = expander.transform_catalogs(
    [basic_catalog, foo_catalog, bar_catalog]
)

# 2. Build the inference format with the resulting catalogs
fmt = ExpressFormat(catalogs=inference_catalogs, surface_id="main")
system_prompt = fmt.prompt_generator.generate()

# 3. Parse and validate model output against the inference catalogs
parts = fmt.create_parser().parse_response(llm_output)

# 4. Lower macro components into Basic, Foo, and Bar primitives for the renderer
transport_messages = [
    msg
    for part in parts
    if isinstance(part, A2uiPart)
    for msg in expander.transform_to_transport(part.a2ui)
]
```

When `fmt` receives multiple v1.0 catalogs, unique component names (`FooHeader`, `BarAction`, `BazMacro`) resolve to their owning `catalogId` without `catalogId=` at every call site in the DSL. After `transform_to_transport`, `BazMacro` is replaced by `Card` and `Text` (stamped with `basic_catalog.catalog_id`), `FooPanel` and `FooHeader` (`FOO_CID`), and `BarAction` (`BAR_CID`), so the client renderer only needs `basic_catalog`, `foo_catalog`, and `bar_catalog`. If an unannotated lowered component exists in multiple registered base catalogs (or in none of them) on a defaultless surface, `transform_to_transport` raises `A2uiCatalogError`.

When chaining multiple sidecar `MacroExpander` instances across the same message stream, pass a distinct `catalog_id="https://..."` URI to each expander so their sidecar catalogs do not share the default `https://a2ui.org/catalogs/macros` identifier.

### Single-catalog surfaces (`transform_to_inference_catalog`)

When a surface binds a single base catalog (including all v0.9 surfaces), you can also augment that catalog directly in place with `transform_to_inference_catalog`:

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

### Component-to-catalog resolution

During `transform_to_transport`, `MacroExpander` determines whether a component invokes a registered macro in four steps:

1. An explicit non-empty `catalogId` string on the component takes precedence (`catalogId: null` behaves like omitting `catalogId`, while an empty string or non-string logs a warning and leaves the component unexpanded). In v1.0, the component's `@catalogId` is read first, and a legacy bare `catalogId` is read only when the macro declares no parameter of that name.
2. Inside an outer macro expansion (`depth > 0`), an unannotated component inherits the enclosing macro's `catalogId`, unless the surface uses an unregistered foreign catalog or the component name belongs to a registered base catalog on that surface (or any registered base catalog on a defaultless surface).
3. Otherwise, the component inherits the surface's default `catalogId` from `createSurface` or `surface_catalogs` (`None` on a defaultless v1.0 surface).
4. A scoped `MacroExpander(catalog_id=...)` expands only when the effective `catalogId` matches `expander.catalog_id`. An unscoped expander with registered `base_catalogs` skips components whose effective `catalogId` names a registered base catalog that defines a primitive of the same name (unless that primitive was pruned out via `passthrough_components`).

### Filtering base primitives (`passthrough_components`)

When transforming catalogs via `transform_catalogs` or `transform_to_inference_catalog`, all base catalog components remain available by default. Pass `passthrough_components` to restrict which base primitives stay in the inference catalogs alongside your macros:

```python
# Expose macros plus Button only:
expander = MacroExpander([ProductCard], passthrough_components=["Button"])

# Expose only the macros with zero base primitives:
expander = MacroExpander([ProductCard], passthrough_components=[])
```

### Error handling (`on_error`)

By default (`on_error="passthrough"`), if a macro fails argument coercion or raises a runtime exception during `transform_to_transport`, `MacroExpander` logs the error and retains the unexpanded component so valid sibling components in the message still expand. Pass `on_error="raise"` when running inside an agent retry or validation loop so invalid macro invocations raise `A2uiValidationError` immediately:

```python
expander = MacroExpander([ProductCard], on_error="raise")
```

Structural errors (`A2uiRecursionError`, `A2uiCatalogError`, and protocol-version or reserved-name `A2uiValidationError`) always raise regardless of `on_error`.

### Sharing a `MacroExpander` across sessions (`surface_catalogs`)

By default, a `MacroExpander` instance records `createSurface` and `deleteSurface` messages (up to 256 active surfaces, evicting the oldest entry with a warning log) so subsequent `updateComponents` calls on the same surface know its default `catalogId`. Construct one `MacroExpander` per session, or pass `surface_catalogs` on each `transform_to_transport` call in multi-tenant servers to avoid mutating instance state:

```python
transport_messages = expander.transform_to_transport(
    messages,
    surface_catalogs={"main": None},  # None indicates a defaultless v1.0 surface
)
```
