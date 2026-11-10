# Vertical Inference Format

The **Vertical** inference format (`VerticalFormat`) provides a concise, token-efficient, constructor-based syntax designed for chat applications, standalone assistant cards, and domain widgets where an agent emits a single component or a flat vertical sequence of components across A2UI v0.9, v0.9.1, and v1.0.

## Motivation & Architecture

In many conversational or assistant contexts, the agent only needs to instantiate one or a few standalone UI components inline without manual layout nesting (`Column`, `Row`, `Card`, `Tabs`) or variable assignments (`root = ...`).

The Vertical format streamlines this:

1. **Surface-per-Component Architecture**: When multiple components are emitted, each constructor call maps directly to an independent surface (`main`, `main_1`, `main_2`, ...). In A2UI v1.0, each component emits a single `createSurface` envelope with inline `components`; in v0.9 and v0.9.1, it emits `createSurface` followed by `updateComponents`.
2. **Filtered Catalog Signatures**: Components in active catalogs that _require_ children (`Child`, `ChildList`, `ComponentId`) or whose `allowedParents` excludes `"Surface"` are automatically omitted from system prompt signatures, focusing the model exclusively on standalone components and domain widgets.
3. **Catalog-Driven Schema Coercion**: Small models frequently emit numbers or booleans enclosed in quotes (e.g. `temperature="58"`) or with percentage affixes (`"+10.9%"`). `VerticalCompiler` dynamically introspects the catalog schema to coerce quoted strings into expected primitive types while preserving dynamic data-binding paths (`$/...`).
4. **Full A2UI v1.0 Support**: Supports v1.0 `@path` data bindings, `@call` function calls, `Event(..., userMessage=...)`, `functionCall` actions, multi-catalog resolution (`catalogId=`), component `extensions=`, checkable inputs (`?required`), and standalone `callRendererFunction` invocations.

## Syntax Overview

### Single & Multi-Component Blocks

```a2ui
<a2ui>
StockTicker(symbol="GOOGL", price=182.50, change="+1.25%")
WeatherWidget(city="Seattle", temperature=58, condition="rainy")
</a2ui>
```

### Data Bindings, Events & Function Actions

```a2ui
<a2ui>
UserProfileCard(
  name=$/user/profile/displayName,
  onEdit=Event("openEditProfile", userId=$/user/id, userMessage="Editing profile"),
  onHelp=openUrl("https://example.com/help")
)
</a2ui>
```

## Python SDK Usage

```python
from a2ui.core import Catalog
from a2ui.inference_formats import VerticalFormat

# 1. Initialize format with one or more catalogs (targets catalog's protocol version by default)
catalog = Catalog.from_json(catalog_dict, protocol_version="1.0")
vertical_format = VerticalFormat([catalog], surface_id="main")

# 2. Generate prompt instructions for the LLM
system_instructions = vertical_format.prompt_generator.generate()

# 3. Parse and validate a complete LLM response
parser = vertical_format.create_parser()
parts = parser.parse_response(
    'Here is your confirmation:\n<a2ui>\nFlightStatusCard(airline="United", flightNumber="UA 421")\n</a2ui>'
)

# 4. Or read a streamed LLM response incrementally
stream = parser.open_stream()
for chunk in chunks:
    emitted_parts = stream.feed(chunk)
final_parts = stream.close()
```

## Specifications & Conformance

- **Technical Specification**: [`specification/inference_formats/vertical/a2ui_vertical.md`](../../../../../../../specification/inference_formats/vertical/a2ui_vertical.md)
- **Grammar & DSL Examples**: [`specification/inference_formats/vertical/vertical_examples.md`](../../../../../../../specification/inference_formats/vertical/vertical_examples.md)
- **ANTLR4 Grammar**: [`specification/inference_formats/vertical/Vertical.g4`](../../../../../../../specification/inference_formats/vertical/Vertical.g4)
- **Feature Blueprint**: [`blueprints/features/vertical_format.blueprint.md`](../../../../../../../blueprints/features/vertical_format.blueprint.md)
- **Conformance Test Suites**: [`conformance/agent/vertical/`](../../../../../../../conformance/agent/vertical/)
