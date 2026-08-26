# A2UI Python Template Engine (`a2ui.inference_formats.experimental.template`)

The `a2ui.inference_formats.experimental.template` package provides server-side UI template expansion and synthetic catalog compilation for the A2UI Python Agent SDK.

For the language-agnostic protocol specification, JSON schemas, and multi-platform design guidelines, see:
👉 **[`specification/proposals/templates/README.md`](../../../../../../../../specification/proposals/templates/README.md)**

---

## Python API Reference

### 1. `StaticTemplate`

Represents a declarative, immutable UI template parsed from YAML or a dictionary.

```python
from a2ui.inference_formats.experimental.template import StaticTemplate

# Load from single or multi-document ('---') YAML files
templates = StaticTemplate.from_yaml_file("path/to/templates.yaml")

# Load directly from a YAML string
single_template = StaticTemplate.from_yaml(yaml_string)
```

### 2. `DynamicTemplate`

Extends templates with server-side execution. Supports two modes:

#### A. Data-Binding Mode (`resolver + layout`)

Takes a lookup argument (e.g. `employeeId`), runs a resolver callback, and injects the result into a static YAML presentation layout:

```python
from a2ui.inference_formats.experimental.template import DynamicTemplate, StaticTemplate

layout = StaticTemplate.from_yaml_file("salary_card.yaml")[0]

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

#### B. Programmatic Render Mode (`render`)

Bypasses static layouts and runs native Python logic (loops, arithmetic, conditionals) returning a component AST:

```python
from a2ui.inference_formats.experimental.template import DynamicTemplate

def render_server_health(serverId: str, includeDisks: bool = True) -> dict:
    status_icon = "check_circle" if serverId == "srv_01" else "warning"
    return {
        "component": "Card",
        "child": {
            "component": "Column",
            "children": [
                {"component": "Text", "text": f"Server {serverId}", "variant": "h3"},
                {"component": "Icon", "name": status_icon},
            ]
        }
    }

server_template = DynamicTemplate(
    template_id="ServerHealthCard",
    render=render_server_health,
    description="Live server diagnostics.",
    sample_data={"serverId": "srv_01", "includeDisks": True},
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
