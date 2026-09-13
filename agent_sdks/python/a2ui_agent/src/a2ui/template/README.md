# A2UI Templates developer guide

The `a2ui.template` package provides server-side UI template expansion for the A2UI Python Agent SDK.

Templates allow language models to generate concise UI invocations (such as in Express DSL) that expand into standard A2UI Basic Catalog primitives before being transmitted to the client.

---

## Core concepts

- **Static templates** (`StaticTemplate`): Reusable layout structures defined in JSON or Python. All parameters are provided by the language model.
- **Dynamic templates** (`DynamicTemplate`): Templates backed by a server-side resolver function (e.g. database query, API fetch). The model only passes lookup identifiers; sensitive or real-time data is resolved and injected server-side.
- **Typed AST models**: Fluent builder classes for constructing templates in code (`Param`, `ParamRef`, `Concat`, `FormatExpr`, `TemplateLoop`, `TemplateComponent`).
- **Inference format** (`TemplateInferenceFormat`): Generates prompt system instructions containing synthetic template signatures and parses responses by expanding templates synchronously.

---

## Authoring templates

### 1. Declarative JSON templates

Create a JSON file conforming to `specification/v0_9_1/json/template_definition.json`.

```json
{
  "templateId": "UserProfile",
  "description": "User profile card displaying avatar, full name, and role.",
  "parameters": {
    "userId": {
      "type": "string",
      "description": "Unique user account ID."
    },
    "userName": {
      "type": "string",
      "description": "Full name of the user."
    },
    "role": {
      "type": "string",
      "description": "Job title or role."
    }
  },
  "components": [
    {
      "id": "card",
      "component": "Card",
      "child": "col"
    },
    {
      "id": "col",
      "component": "Column",
      "align": "center",
      "children": ["avatar", "name_txt", "role_txt"]
    },
    {
      "id": "avatar",
      "component": "Icon",
      "name": "person"
    },
    {
      "id": "name_txt",
      "component": "Text",
      "text": {"param": "userName"},
      "variant": "h3"
    },
    {
      "id": "role_txt",
      "component": "Text",
      "text": {"param": "role"},
      "variant": "caption"
    }
  ],
  "sampleData": {
    "userId": "usr_101",
    "userName": "Alice Smith",
    "role": "Lead Architect"
  }
}
```

Load the template in Python:

```python
from a2ui.template import StaticTemplate

profile_template = StaticTemplate.from_json_file("path/to/user_profile.json")
```

---

### 2. Programmatic templates with typed Python models

You can construct templates in Python without JSON files:

```python
from a2ui.template import (
    StaticTemplate,
    Param,
    ParamType,
    ParamRef,
    Concat,
    TemplateComponent,
)

profile_template = StaticTemplate(
    template_id="UserProfile",
    description="User profile card displaying avatar, full name, and role.",
    parameters={
        "userId": Param.string(description="Unique user account ID."),
        "userName": Param.string(description="Full name."),
        "role": Param.string(description="Job title."),
    },
    components=[
        TemplateComponent(id="card", component="Card", child="col"),
        TemplateComponent(
            id="col",
            component="Column",
            align="center",
            children=["avatar", "name_txt", "role_txt"],
        ),
        TemplateComponent(id="avatar", component="Icon", name="person"),
        TemplateComponent(
            id="name_txt",
            component="Text",
            properties={"text": ParamRef("userName"), "variant": "h3"},
        ),
        TemplateComponent(
            id="role_txt",
            component="Text",
            properties={"text": ParamRef("role"), "variant": "caption"},
        ),
    ],
    sample_data={
        "userId": "usr_101",
        "userName": "Alice Smith",
        "role": "Lead Architect",
    },
)
```

---

### 3. Dynamic templates with server callbacks

When rendering data that should not be visible to the model in prompt context (such as verified salaries, account balances, or live sensors), use a `DynamicTemplate`.

```python
from typing import Any, Dict
from a2ui.template import DynamicTemplate, StaticTemplate

# 1. Load the underlying presentation layout
salary_layout = StaticTemplate.from_json_file("path/to/salary_card.json")

# 2. Define the resolver function
def fetch_employee_compensation(employee_id: str) -> Dict[str, Any]:
    # Query database or internal microservice
    employee = hr_database.lookup(employee_id)
    return {
        "employeeName": employee.name,
        "role": employee.title,
        "baseSalary": f"${employee.salary:,}",
        "annualBonus": f"${employee.bonus:,}",
        "equity": f"{employee.equity:,} RSUs",
        "clearanceLevel": employee.clearance,
        "verifiedAt": employee.last_verified,
    }

# 3. Register the DynamicTemplate
salary_template = DynamicTemplate(
    template_id="EmployeeSalaryCard",
    resolver=fetch_employee_compensation,
    layout=salary_layout,
    description=(
        "Displays verified compensation. Pass only the employee_id. "
        "Financial numbers are resolved server-side."
    ),
    sample_data={"employee_id": "emp_101"},
)
```

The language model prompt signature only exposes:

```
EmployeeSalaryCard(employee_id: string)
```

When the model emits:

```
<a2ui>
root = EmployeeSalaryCard("emp_102")
</a2ui>
```

The server calls `fetch_employee_compensation("emp_102")` and expands the layout with the returned data.

---

## Parameter expressions syntax

| Expression           | JSON syntax                                                 | Python AST class                                   | Description                                       |
| :------------------- | :---------------------------------------------------------- | :------------------------------------------------- | :------------------------------------------------ |
| **Direct Reference** | `{"param": "name"}`                                         | `ParamRef("name")`                                 | Extracts parameter value (supports dot-notation). |
| **Concatenation**    | `{"concat": ["Due: ", {"param": "date"}]}`                  | `Concat(["Due: ", ParamRef("date")])`              | Joins string and parameter parts.                 |
| **Formatting**       | `{"format": "{val}%", "args": {"val": {"param": "score"}}}` | `FormatExpr("{val}%", {"val": ParamRef("score")})` | Evaluates format strings with named arguments.    |
| **Iteration**        | `{"param": "items", "template": "ItemCard"}`                | `TemplateLoop("items", "ItemCard")`                | Expands child template for each element in list.  |

---

## Integration with agent workflows

```python
from a2ui.template import TemplateInferenceFormat, StaticTemplate
from google import genai
from google.genai import types

# 1. Initialize template inference format
templates = [
    StaticTemplate.from_json_file("user_profile.json"),
    StaticTemplate.from_json_file("team_goals.json"),
    salary_template,
]

format_instance = TemplateInferenceFormat(
    templates=templates,
    surface_id="main",
    version="0.9.1",
)

# 2. Build system instructions
system_prompt = format_instance.prompt_generator.generate(
    role_description="You are an interface assistant. Use templates when relevant.",
    include_schema=True,
)

# 3. Invoke LLM
client = genai.Client()
response = client.models.generate_content(
    model="gemini-flash-latest",
    contents=["Show verified compensation for Marcus Vance (ID emp_102)"],
    config=types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="text/plain",
    ),
)

# 4. Parse response and expand templates into basic components
parts = format_instance.parser.parse_response(response.text)
messages = []
for part in parts:
    if part.a2ui_json:
        messages.extend(part.a2ui_json)

# 5. Send expanded messages to client renderer
# messages contains standard createSurface and updateComponents with Basic Catalog items
```

---

## Common scenarios

### Nested child components (slots)

To allow the language model to inject arbitrary child components into a container template:

```json
{
  "templateId": "SectionCard",
  "parameters": {
    "title": {"type": "string"},
    "children": {"type": "children"}
  },
  "components": [
    {
      "id": "card",
      "component": "Card",
      "child": "col"
    },
    {
      "id": "col",
      "component": "Column",
      "children": ["header_text", {"param": "children"}]
    },
    {
      "id": "header_text",
      "component": "Text",
      "text": {"param": "title"},
      "variant": "h2"
    }
  ]
}
```

The language model can then compose templates with primitives:

```
<a2ui>
t1 = Text("First task")
t2 = Text("Second task")
root = SectionCard("Active Projects", [t1, t2])
</a2ui>
```

### Action handlers

Templates pass action objects to buttons or clickable elements:

```json
{
  "id": "action_btn",
  "component": "Button",
  "onClick": {"param": "onConfirm"},
  "child": "btn_txt"
}
```
