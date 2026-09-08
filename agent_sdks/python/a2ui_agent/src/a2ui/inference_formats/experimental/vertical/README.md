# Vertical Inference Format

The **Vertical** inference format (`a2ui.inference_formats.experimental.vertical`) provides a concise, token-efficient, constructor-based syntax designed for chat applications, domain-specific components, macros, and templates where the model emits a single component or a non-nested vertical list of components.

## Motivation & Architecture

In many conversational or assistant contexts, the agent only needs to instantiate one or two UI components inline with zero manual layout nesting. Complex nesting hierarchies (such as manually constructing `Column`, `Row`, `Card`, or `Tabs`) increase token usage, latency, and reasoning overhead.

The Vertical format streamlines this:

1. **No Manual Layout Containers**: If multiple components are emitted, the compiler automatically nests them in the catalog's standard vertical container (e.g. `Column` or `List`).
2. **Filtered Catalog Signatures**: Any component in the catalog that _requires_ children is automatically filtered out from the system prompt rules and component signatures so that the LLM focuses exclusively on leaf components, domain widgets, macros, and templates.
3. **High Token Efficiency**: Uses compact constructor call syntax `ComponentName(...)` with optional positional arguments, minimal punctuation, and clean sentinel tags `<a2ui>...</a2ui>`.
4. **Resilient & Permissive Parsing**: The parser tolerates minor LLM syntax anomalies including missing quotes, trailing commas, unclosed parentheses, variable assignments (`root = ...`), colons instead of equals (`key: "val"`), and JSON/JSX fallbacks.

## Syntax Overview

### Single Component

```a2ui
<a2ui>
Text("Hello world!")
</a2ui>
```

### Multiple Components (Implicit Vertical Container)

Multiple root components will automatically be wrapped into a vertical layout (`Column` or `List`) by the compiler:

```a2ui
<a2ui>
Text("Order Summary", variant="heading")
Divider()
Text("Item: 2x Cold Brew")
</a2ui>
```

### Properties and Positional Arguments

Arguments can be passed by position (for primary required fields) or by name:

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

Prefix paths with `$/` or direct reference paths:

```a2ui
<a2ui>
Text($/user/displayName)
</a2ui>
```

### Actions

Events and actions can be specified using `Event(...)` constructors or string action names:

```a2ui
<a2ui>
Button("View Details", action=Event("view_details", id=123))
</a2ui>
```

## Python SDK Usage

```python
from a2ui.inference_formats.experimental.vertical import VerticalFormat
from a2ui.schema.catalog import A2uiCatalog

# 1. Initialize format with catalog
catalog = A2uiCatalog.from_file("path/to/catalog.json")
vertical_format = VerticalFormat(catalog=catalog, surface_id="main", version="v0.9.1")

# 2. Generate prompt instructions for the LLM
system_instructions = vertical_format.prompt_generator.generate_system_prompt()

# 3. Parse and compile LLM response
model_response = """
Here is your confirmation:
<a2ui>
Text("Flight Confirmed: UA 101", variant="title")
Text("Departure: 08:30 AM")
</a2ui>
"""

# Extract response parts
parts = vertical_format.parser.unwrap(model_response)

# Compile to standard A2UI messages (dataModelUpdate and surfaceUpdate)
messages = vertical_format.parser.compile(parts[1].content)
```
