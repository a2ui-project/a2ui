# A2UI Macros (`MacroExpander`)

Macros allow developers to expose high-level, domain-specific composite UI components to Large Language Models while compiling them into standard A2UI primitive components on the server.

Rather than being tied to a specific syntax or inference format, macros operate as an **asymmetric catalog and message transformer** via `MacroExpander`.

---

## 1. Overview

When models generate raw A2UI component trees, complex or recurring UI patterns require verbose syntax. For example, rendering a product card with images, badges, pricing, and buy buttons requires authoring dozens of lines of nested JSON or DSL tokens.

Macros solve this by allowing agents to output concise, high-level tags:

```xml
<ProductCard productId="sku_482" title="Trail Runner Shoes" price="$120" onBuy="checkout" />
```

Before transmitting messages to the client renderer, `MacroExpander` expands `<ProductCard ...>` into standard A2UI primitives (`Card`, `Column`, `Row`, `Text`, `Button`, `Action`) using a Python function registered with the `@macro` decorator. The client renderer receives standard protocol messages without needing custom client-side widget code.

---

## 2. Defining Macros with `@macro`

The `@macro` decorator inspects a Python function's type annotations and docstring to synthesize a catalog component JSON schema and an execution wrapper.

```python
from a2ui.transformers.macros import macro
from a2ui.builder.v0_9 import Action
from a2ui.builder.v0_9.catalogs.basic import Button, Card, Column, Text

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

### Parameter Type Mapping

The decorator maps Python type hints to canonical A2UI JSON schema definitions:

- **Primitives**: `str`, `int`, `float`, and `bool` map to standard JSON schema types.
- **Enums**: `Enum` subclasses or `Literal["a", "b"]` map to enum string schemas.
- **Slots (Single Child)**: Parameters typed as `ComponentBuilderNode`, `Child`, or concrete component classes (like `Text`) map to `#/$defs/ComponentId`. When the model passes a component ID, `MacroProcessor` coerces the input into a `ComponentRef(id=...)`.
- **Slot Lists (Children)**: Parameters typed as `Sequence[ComponentBuilderNode]` or `ChildList` map to `#/$defs/ChildList`. Incoming ID arrays are coerced to lists of `ComponentRef`.
- **Actions**: Parameters typed as `Action` map to `#/$defs/Action`. In Python, build one as `Action(event=ActionEvent(name="name", context=...))`; `MacroProcessor` coerces standard shorthands emitted by models (`"name"`, `{"event": "name"}`, `{"name": ..., "context": ...}`).
- **Data Bindings**: Values passed as `{"path": "/..."}` are coerced into `DataBinding` objects.

### Docstring Contract

`@macro` supports both Google-style (`Args:`) and Sphinx-style (`:param name: description`) docstrings:

- The top-level summary becomes the `description` of the generated component in the catalog schema.
- Per-parameter descriptions are parsed and assigned as `description` attributes on each property schema.
- Plain docstrings without structured sections are also supported gracefully without errors.

---

## 3. The `MacroExpander` Transformer Interface

`MacroExpander` implements the three canonical transformer methods:

1. **`transform_to_inference_catalog(base_catalog: Catalog) -> Catalog`**:
   Derives an authoring catalog by augmenting the base catalog with the synthesized macro component schemas. Fails fast with `A2uiCatalogError` if any macro name collides with an existing primitive in the base catalog.
2. **`transform_to_transport(messages: Sequence[AgentToRendererMessage]) -> list[AgentToRendererMessage]`**:
   Lowers outbound envelopes (`createSurface`, `updateComponents`, `surfaceUpdate`) emitted by the LLM by recursively expanding all macro components into primitive subtrees.
3. **`transform_to_inference(messages: Sequence[AgentToRendererMessage]) -> list[AgentToRendererMessage]`**:
   Safe identity pass-through (`return list(messages)`) for replaying traces or inspecting state without unexpansion.

---

## 4. Manual Wiring (Current Usage Pattern)

Until the full `TransformerPipeline` and `CatalogConfig` abstractions land in the shared core SDK, developers wire `MacroExpander` manually in two simple steps:

```python
from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.transformers.macros import MacroExpander, macro

# 1. Initialize the expander with your macros
expander = MacroExpander([product_card])

# 2. Derive the authoring/inference catalog from your base catalog
inference_catalog = expander.transform_to_inference_catalog(base_catalog)

# 3. Configure any standard inference format with the inference catalog
# (ExpressFormat, DirectJsonFormat, ElementalFormat, etc.)
format_strategy = ExpressFormat([inference_catalog], surface_id="main")
system_prompt = format_strategy.prompt_generator.generate()

# 4. Invoke your LLM with system_prompt...
# When the model outputs Express DSL, parse it with the standard parser. It
# returns typed AgentToRendererMessage models:
typed_messages = format_strategy.parser.compile(llm_output)

# 5. Lower the typed messages to transport primitives using the expander:
transport_messages = expander.transform_to_transport(typed_messages)

# 6. Deliver transport_messages (containing primitive Card, Column, Text) to the client renderer!
```

### Filtering Base Primitives (`passthrough_components`)

By default, all components from the base catalog pass through to the inference catalog alongside the macros. To restrict which base components the model is allowed to use, specify `passthrough_components`:

```python
# Expose macros + Button to the model (all other base primitives are pruned from prompt):
expander = MacroExpander([product_card], passthrough_components=["Button"])

# Pure Macro Mode: expose ONLY the macros with zero base primitives:
expander = MacroExpander([product_card], passthrough_components=[])
```

---

## 5. Future State: `CatalogConfig` & `TransformerPipeline`

In the upcoming agent SDK modernization (tracked in RFC issue), manual wiring will be replaced by a declarative pipeline:

```python
catalog_config = CatalogConfig(
    catalog=base_catalog,
    transformer=TransformerPipeline([
        MacroExpander([product_card]),
        ComponentPruningTransformer(allowed_components=["product_card", "Button"]),
    ]),
)
```

The request processor will automatically handle catalog synthesis ahead of prompt generation and message lowering during response parsing.
