# Inference Formats

Inference formats define how Large Language Models (LLMs) and autonomous agents emit user interface definitions.

While the A2UI client runtime always consumes standard JSON wire protocol messages (`createSurface`, `updateComponents`, `updateDataModel`), agents can use different inference formats to generate those messages efficiently.

---

## Available Formats

A2UI supports two primary inference formats:

### 1. Direct JSON
In Direct JSON format, the model generates standard A2UI JSON envelopes directly, typically using structured output mode or standard JSON prompting.
- **Best for**: Models with native JSON schema enforcement, or when debugging raw wire messages.
- **Trade-off**: Higher token overhead due to repetitive structural keys, quotes, and JSON envelope boilerplate.

### 2. A2UI Express
**A2UI Express** is an official, compact declarative domain-specific language (DSL) designed specifically for LLM UI generation.
- **Best for**: Production agents, on-device models (such as Gemma 4), and high-throughput applications where latency and token costs matter.
- **Key advantage**: **55% to 70% reduction in output tokens** compared to raw JSON, with ~2.5x faster generation latency and line-by-line streaming compilation.

---

## How A2UI Express Works

Instead of generating verbose JSON:

```json
{
  "createSurface": {
    "surfaceId": "main",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    "root": "flight_card",
    "components": {
      "flight_card": {
        "component": "Card",
        "child": "title_text"
      },
      "title_text": {
        "component": "Text",
        "text": "Flight SFO -> JFK: On Time",
        "variant": "h2"
      }
    }
  }
}
```

The model generates concise Express syntax enclosed in `<a2ui>` sentinel tags:

```
<a2ui>
title_text = Text("Flight SFO -> JFK: On Time", variant="h2")
root = Card(child=title_text)
</a2ui>
```

A host-side compiler in the A2UI Agent SDK parses this syntax using an ANTLR grammar and compiles it into standard A2UI v1.0 / v0.9 wire protocol JSON before transmitting it to the client renderer.

---

## Using Express in the Python Agent SDK

The `a2ui-agent-sdk` provides built-in support for Express via `ExpressFormat`:

```python
from a2ui.inference_formats.express import ExpressFormat, ExpressCompiler
from a2ui.basic_catalog import BasicCatalog

# 1. Initialize the Express format with your catalog
catalog = BasicCatalog.get_catalog(version="v1.0")
express_format = ExpressFormat(catalog=catalog, surface_id="main", version="v1.0")

# 2. Generate model system instructions with positional component signatures
system_prompt = express_format.prompt_generator.generate(
    role_description="You are a flight status assistant.",
    include_schema=True,
    include_examples=True,
)

# 3. Parse and compile model responses
compiler = ExpressCompiler(catalog=catalog, surface_id="main", version="v1.0")
wire_messages = compiler.compile(llm_output_text)
```

---

## Further Reading

- [A2UI Express Technical Specification](../../../specification/inference_formats/express/a2ui_express.md)
- [Express ANTLR Grammar (Express.g4)](../../../specification/inference_formats/express/Express.g4)
- [Express Developer Guide & Benchmarks](../../../specification/inference_formats/express/README.md)
- [Agent Development Guide](../guides/agent-development.md)
