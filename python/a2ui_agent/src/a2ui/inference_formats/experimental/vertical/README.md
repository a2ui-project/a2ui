# Vertical Inference Format

The **Vertical** inference format (`a2ui.inference_formats.experimental.vertical`) provides a concise, token-efficient, constructor-based syntax designed for chat applications, standalone assistant cards, macros, and templates where the model emits a single component or a flat sequence of components.

## Motivation & Architecture

In many conversational or assistant contexts, the agent only needs to instantiate one or two UI components inline with zero manual layout nesting. Complex nesting hierarchies (such as manually constructing `Column`, `Row`, `Card`, or `Tabs`) increase token usage, latency, and reasoning overhead.

The Vertical format streamlines this:

1. **Surface-per-Component Architecture**: When multiple components are emitted, each constructor call maps directly to an independent surface (`main`, `main_1`, `main_2`, ...). This eliminates the need for container wrapping (`Column` / `List`) and enables true incremental streaming as tokens arrive.
2. **Filtered Catalog Signatures**: Any component in the catalog that *requires* children (`child`, `children`, `ChildList`) is automatically filtered out from the system prompt rules and component signatures, focusing the model exclusively on leaf components, domain widgets, macros, and templates.
3. **Catalog-Driven Schema Coercion**: Small models frequently emit numbers or booleans enclosed in quotes (e.g. `temperature="58"`) or with percentage affixes (`"+10.9%"`). The `VerticalCompiler` dynamically introspects the catalog schema to safely coerce quoted strings into expected primitive types while strictly preserving dynamic data-binding paths (`$/...`).
4. **Token & Latency Efficiency**: Eliminates variable planning ceremony (`root = ...`) and surface boilerplate (`surface(...)`), reducing prompt overhead by ~24%, thinking load by ~20-40%, and cloud request latency by ~22%.
5. **Resilient & Permissive Parsing**: The parser tolerates minor LLM syntax anomalies including missing quotes, trailing commas, unclosed parentheses, colons instead of equals (`key: "val"`), and JSON/JSX fallbacks.

## Syntax Overview

### Single Component

```a2ui
<a2ui>
WeatherWidget(city="Seattle", temperature=58, condition="rainy", high=62, low=50)
</a2ui>
```

### Multiple Components (Independent Surfaces)

Multiple root components are emitted sequentially without container nesting, each mounting to its own surface:

```a2ui
<a2ui>
StockTicker(symbol="GOOGL", price=182.50, change="+1.25%")
WeatherWidget(city="Seattle", temperature=58, condition="rainy")
</a2ui>
```

### Properties and Positional Arguments

Arguments can be passed by position (for primary required fields defined by the catalog's `positionalIndex`) or by name:

```a2ui
<a2ui>
Button("Submit Order", action="submit_order", variant="primary")
</a2ui>
```

Both `=` and `:` delimiters are supported:

```a2ui
<a2ui>
TextInput(label: "Your Name", value: "Alex")
</a2ui>
```

### Data Bindings

Dynamic data binding paths are prefaced with `$`:

```a2ui
<a2ui>
Text(text=$/user/profile/displayName)
</a2ui>
```

### Actions & Events

Events can be specified using `Event(...)` constructors or string action names:

```a2ui
<a2ui>
Button("View Details", onClick=Event("openDetails", item="123"))
</a2ui>
```

## Python SDK Usage

```python
from a2ui.inference_formats.experimental.vertical import VerticalFormat
from a2ui.core.catalog import Catalog

# 1. Initialize format with catalog
catalog = Catalog.from_json(catalog_dict, protocol_version="0.9.1")
vertical_format = VerticalFormat(catalog=catalog, surface_id="main", version="v0.9.1")

# 2. Generate prompt instructions for the LLM
system_instructions = vertical_format.prompt_generator.generate_system_prompt()

# 3. Parse and compile LLM response
model_response = """
Here is your confirmation:
<a2ui>
FlightStatusCard(airline="United Airlines", flightNumber="UA 421", status="On Time")
</a2ui>
"""

# Extract response parts
parts = vertical_format.parser.unwrap(model_response)

# Compile to standard A2UI messages (createSurface and updateComponents)
messages = vertical_format.parser.compile(parts[0].a2ui_raw)
```

## Specifications & Conformance

- **Technical Specification**: [`specification/proposals/vertical/a2ui_vertical.md`](../../../../../../../../specification/proposals/vertical/a2ui_vertical.md)
- **Grammar & DSL Examples**: [`specification/proposals/vertical/vertical_examples.md`](../../../../../../../../specification/proposals/vertical/vertical_examples.md)
- **ANTLR4 Grammar**: [`specification/inference_formats/vertical/Vertical.g4`](../../../../../../../../specification/inference_formats/vertical/Vertical.g4)
- **Feature Blueprint**: [`blueprints/features/vertical_format.blueprint.md`](../../../../../../../../blueprints/features/vertical_format.blueprint.md)
- **Conformance Test Suites**: [`conformance/agent/vertical/`](../../../../../../../../conformance/agent/vertical/)
