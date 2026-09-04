# A2UI Macros

Macros allow developers to expose high-level, domain-specific UI components to Large Language Models while compiling them into standard A2UI primitives on the server.

## Overview

When models generate raw A2UI component trees, complex or recurring UI patterns require verbose syntax. For example, rendering a product card with images, badges, pricing, and buy buttons requires authoring dozens of lines of nested JSON or DSL tokens.

Macros solve this by allowing agents to output concise, high-level tags:

```xml
<ProductCard productId="sku_482" title="Trail Runner Shoes" price="$120" onBuy="checkout" />
```

Before transmitting messages to the client renderer, the `MacroParser` expands `<ProductCard ...>` into standard A2UI components (`Card`, `Column`, `Row`, `Text`, `Button`, `Action`) using a Python function registered with the `@macro` decorator. The client renderer receives standard protocol messages without needing custom client-side widget code.

## The `@macro` annotation contract

The `@macro` decorator inspects a Python function's type annotations and docstring to synthesize a catalog component JSON schema and an execution wrapper.

```python
from a2ui.inference_formats.experimental.macros import macro
from a2ui.builder.catalogs.basic import Card, Column, Text, Button, Action

@macro
def product_card(
    title: str,
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
                Text(text=title, variant="h3"),
                Text(text=price, variant="body"),
                Button(
                    child=Text(text="Buy Now" if in_stock else "Out of Stock"),
                    action=on_buy,
                    variant="primary",
                ),
            ]
        )
    )
```

### Parameter type mapping

The decorator maps Python type hints to A2UI JSON schema definitions:

- **Primitives**: `str`, `int`, `float`, and `bool` map to standard JSON schema types.
- **Enums**: `Enum` subclasses or `Literal["a", "b"]` map to enum string schemas.
- **Slots (Single Child)**: Parameters typed as `ComponentBuilderNode`, `Slot`, or concrete component classes (like `Text`) map to `#/$defs/ComponentId`. When the model passes a component ID or nested tag, `MacroProcessor` coerces the input into a `ComponentRef(id=...)`.
- **Slot lists (Children)**: Parameters typed as `Sequence[ComponentBuilderNode]` or `SlotList` map to `#/$defs/ChildList`. Incoming ID arrays are coerced to lists of `ComponentRef`.
- **Actions**: Parameters typed as `Action` map to `#/$defs/Action`.
- **Data bindings**: Values passed as `{"path": "/..."}` are coerced into `DataBinding` objects.

### Docstring contract

`@macro` uses docstring inspection to generate LLM descriptions:

- The summary line of the docstring becomes the `description` of the generated component in the catalog schema.
- Parameter descriptions under `Args:`, `Arguments:`, or `Parameters:` are parsed and assigned as `description` attributes on each property schema.

### Return type contract

A macro function must return a `ComponentBuilderNode` (such as `Card`, `Column`, `Row`, or a custom subclass).

During expansion:

1. `MacroProcessor` calls the function with coerced arguments.
2. The returned node hierarchy is flattened into component dictionaries via `tree.to_components()`.
3. The root component of the returned tree inherits the macro's instance ID. Any parent components that referenced the macro now reference this root component seamlessly.

## Integrating macros with inference formats

Use `MacroInferenceFormat` to bind macros to an underlying syntax format (such as `ExpressFormat` or `ElementalFormat`):

```python
from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.inference_formats.experimental.macros import MacroInferenceFormat
from a2ui.schema.catalog import A2uiCatalog

# 1. Base format with base catalog
base_format = ExpressFormat(catalog=catalog, surface_id="main")

# 2. Wrap with MacroInferenceFormat
format_with_macros = MacroInferenceFormat(
    base_format=base_format,
    macros=[product_card],
)
```

`MacroInferenceFormat` handles two tasks:

1. **Schema synthesis**: Automatically combines base catalog components with the macro schemas into a unified catalog, updating `#/$defs/anyComponent/oneOf`.
2. **Parsing decoration**: Wraps the base parser with `MacroParser`, which intercepts parsed messages and expands macro instances before returning wire messages.
