# A2UI Python Template Engine (`a2ui.inference_formats.experimental.template`)

The `a2ui.inference_formats.experimental.template` package provides server-side UI template expansion and synthetic catalog compilation for the A2UI Python Agent SDK.

For the language-agnostic protocol specification, JSON schemas, and multi-platform design guidelines, see:
👉 **[`specification/proposals/templates/README.md`](../../../../../../../../specification/proposals/templates/README.md)**

---

## Python API Reference

### 1. `StaticTemplate`

Represents a declarative, immutable UI template defined using typesafe Python component builders or parsed from JSON.

```python
from a2ui.inference_formats.experimental.macros.builder import Card, Column, Icon, Text
from a2ui.inference_formats.experimental.template import StaticTemplate

# Define directly using typesafe builders
layout = Card(
    child=Column(
        children=[
            Text(text="Stock: {{ ticker }}"),
            Text(text="Price: ${{ price }}"),
        ]
    )
)
stock_template = StaticTemplate.from_builder(
    name="StockCard",
    layout=layout,
    description="Displays current stock pricing.",
)

# Or load from JSON
templates = StaticTemplate.from_json_file("path/to/templates.json")
```

### 2. `DynamicTemplate`

Extends templates with server-side execution. Supports two modes:

#### A. Data-Binding Mode (`resolver + layout`)

Takes a lookup argument (e.g. `employeeId`), runs a resolver callback, and injects the result into a presentation layout:

```python
from a2ui.inference_formats.experimental.macros.builder import Card, Column, Text
from a2ui.inference_formats.experimental.template import DynamicTemplate, StaticTemplate

layout = StaticTemplate.from_builder(
    name="SalaryCard",
    layout=Card(
        child=Column(
            children=[
                Text(text="{{ employeeName }}", variant="h3"),
                Text(text="Base: {{ baseSalary }}", variant="body"),
            ]
        )
    ),
)


def resolve_compensation(employeeId: str) -> dict:
  return db.fetch_employee_salary(employeeId)


dynamic_salary = DynamicTemplate(
    template_id="EmployeeSalaryCard",
    resolver=resolve_compensation,
    layout=layout,
    description="Verified compensation. Pass only employeeId.",
    sample_data={"employeeId": "emp_101"},
)
```

#### B. Programmatic Render Mode (`render` or `@dynamic_template`)

Bypasses static layouts and runs native Python logic (loops, arithmetic, conditionals) returning typesafe builder nodes:

```python
from a2ui.inference_formats.experimental.macros.builder import Card, Column, Icon, Text
from a2ui.inference_formats.experimental.template import dynamic_template


@dynamic_template(description="Live server diagnostics.")
def server_health_card(serverId: str, includeDisks: bool = True) -> Card:
  status_icon = "check_circle" if serverId == "srv_01" else "warning"
  return Card(
      child=Column(
          children=[
              Text(text=f"Server {serverId}", variant="h3"),
              Icon(name=status_icon),
          ]
      )
  )
```

### 3. `TemplateProcessor`

The core synchronous template expansion and catalog generation engine.

```python
from a2ui.inference_formats.experimental.template import (
    TemplateProcessor,
    TemplateId,
    A2UIComponentList,
)

processor = TemplateProcessor(templates=[user_profile, dynamic_salary, server_template])

# 1. Synthesize virtual A2UI component catalog for LLMs
synthetic_catalog = processor.generate_inference_catalog()

# 2. Synchronously expand template invocations into standard A2UI primitives
expanded_components: A2UIComponentList = processor.expand_template(
    instance_id="root",
    template_id="ServerHealthCard",
    passed_params={"serverId": "srv_01", "includeDisks": True},
)
```

### 4. `TemplateInferenceFormat`

Integrates templates seamlessly with LLM prompting and parsing.

```python
from a2ui.inference_formats.experimental.template import TemplateInferenceFormat

format_instance = TemplateInferenceFormat(
    templates=[user_profile, dynamic_salary],
    surface_id="main",
    version="0.9.1",
)

# Generate system prompt instructions with template signatures
system_prompt = format_instance.prompt_generator.generate(
    role_description="You are an A2UI assistant.",
    include_schema=True,
)

# Parse response & synchronously expand templates to standard A2UI messages
messages = format_instance.parser.parse_response(llm_response_text)
```
