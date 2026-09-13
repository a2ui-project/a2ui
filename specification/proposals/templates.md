# A2UI templates proposal

## Abstract

This document proposes a server-side templating system for A2UI. Templates define reusable, parameterized UI subtrees on the server. When an agent or language model outputs a compact template invocation (e.g. in Express DSL), the backend expands the invocation into standard A2UI Basic Catalog components in a single synchronous pass.

Templates address two constraints:

- **Token efficiency**: Models emit concise function-like signatures with parameters rather than deep nested component trees.
- **Client simplicity**: Client renderers only implement the standard Basic Catalog (`Card`, `Column`, `Row`, `Text`, `Divider`, `Icon`, `Button`). No custom client-side widget development is needed.

---

## Architectural overview

A2UI templates operate on the server side within the Agent SDK:

```
+-------------------------------------------------------------+
| LLM Agent Generation                                       |
| e.g. Express DSL: root = UserProfile("u1", "Alice", "Lead") |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| TemplateInferenceFormat / TemplateParser                     |
| 1. Parses Express DSL / JSON format                         |
| 2. Identifies template components in AST                    |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| TemplateProcessor                                           |
| 1. Resolves dynamic callbacks if DynamicTemplate            |
| 2. Evaluates parameter expressions (param, concat, format)   |
| 3. Unrolls loops and nested slot pass-throughs              |
| 4. Emits standard Basic Catalog primitive components        |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| Client Renderer (@a2ui/react, @a2ui/lit, @a2ui/angular)     |
| Receives standard updateComponents with basic primitives     |
+-------------------------------------------------------------+
```

---

## Template types

### 1. Static templates

Static templates are declarative layouts defined in JSON files or in Python code. All parameters are provided directly by the model.

```json
{
  "templateId": "UserProfile",
  "description": "Standard user identity card.",
  "parameters": {
    "userId": {"type": "string"},
    "userName": {"type": "string"},
    "role": {"type": "string"}
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
      "children": ["name_txt", "role_txt"]
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
  ]
}
```

### 2. Dynamic templates

Dynamic templates separate public input arguments from server-resolved private or live data. The language model prompt exposes only the parameters required by a Python resolver callback (such as an account ID or employee ID). At expansion time, the resolver runs, queries the data source, and injects the resolved values into the underlying layout template.

```python
def resolve_compensation(employee_id: str) -> dict:
    record = hr_database.get(employee_id)
    return {
        "employeeName": record["name"],
        "baseSalary": record["salary"],
        "annualBonus": record["bonus"],
    }

dynamic_salary_template = DynamicTemplate(
    template_id="EmployeeSalaryCard",
    resolver=resolve_compensation,
    layout=salary_layout_template,
    description="Verified salary package. Pass only employee_id.",
)
```

---

## Parameter expressions

Templates replace string interpolation with explicit JSON expressions:

- **Direct parameter reference**:

  ```json
  {"param": "userName"}
  ```

  Supports dot-notation for nested objects: `{"param": "user.address.city"}`.

- **String concatenation**:

  ```json
  {"concat": ["Due: ", {"param": "targetDate"}]}
  ```

- **String format expression**:

  ```json
  {
    "format": "Level {lvl} ({exp} yrs)",
    "args": {
      "lvl": {"param": "level"},
      "exp": {"param": "years"}
    }
  }
  ```

- **List iteration**:
  ```json
  {
    "param": "goals",
    "template": "GoalItem"
  }
  ```

---

## Template definition schema

Templates are validated against `specification/v0_9_1/json/template_definition.json`.

Supported parameter types:

- `string`
- `number`
- `integer`
- `boolean`
- `enum` (with `values` array)
- `object` (with optional `properties`)
- `array` (with optional `items`)
- `child` (single component slot)
- `children` (multi-component slot)
- `action` (event handler reference)
