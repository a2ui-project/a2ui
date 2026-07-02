# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Prompt compiler for A2UI Elemental.

Translates standard JSON catalog schemas into TypeScript/TSX interface
definitions and instruction blocks for on-device models.
"""

import json
import re
from typing import Any, Dict, List, Optional, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.experimental.express.schema_helper import CatalogSchemaHelper


def _schema_allows_databinding(prop_schema: Any) -> bool:
  """Helper to check if a JSON schema allows data binding."""
  if not isinstance(prop_schema, dict):
    return False
  if "$ref" in prop_schema:
    ref = prop_schema["$ref"]
    if "DataBinding" in ref or "Dynamic" in ref or "ChildList" in ref:
      return True
  if prop_schema.get("type") == "object" and "path" in prop_schema.get("properties", {}):
    return True
  if "oneOf" in prop_schema or "anyOf" in prop_schema or "allOf" in prop_schema:
    subs = (
        prop_schema.get("oneOf", [])
        + prop_schema.get("anyOf", [])
        + prop_schema.get("allOf", [])
    )
    for sub in subs:
      if _schema_allows_databinding(sub):
        return True
  return False


def _is_action(prop_schema: Any) -> bool:
  """Helper to check if a JSON schema represents an Action."""
  if not isinstance(prop_schema, dict):
    return False
  if "$ref" in prop_schema:
    return "Action" in prop_schema["$ref"]
  if "oneOf" in prop_schema or "anyOf" in prop_schema or "allOf" in prop_schema:
    subs = (
        prop_schema.get("oneOf", [])
        + prop_schema.get("anyOf", [])
        + prop_schema.get("allOf", [])
    )
    return any(_is_action(sub) for sub in subs)
  return False


def _to_kebab_case(name: str) -> str:
  """Converts a CamelCase string to kebab-case."""
  return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


class ElementalPromptGenerator:
  """Generates system prompt contracts guiding models to produce A2UI Elemental.

  Translates component catalog structures and logic helper catalogs into
  TypeScript/TSX interfaces and function declarations.

  Attributes:
      helper: A CatalogSchemaHelper instance loaded with the target catalog.
      catalog_id: The ID of the catalog.
  """

  def __init__(self, catalog: Union[Catalog[Any, Any], A2uiCatalog]):
    """Initializes the generator with the specified catalog.

    Args:
        catalog: A Catalog or an A2uiCatalog.
    """
    self.helper = CatalogSchemaHelper(catalog)
    self.catalog_id = self.helper.catalog.get(
        "catalogId",
        "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    )

  def _map_schema_to_ts_type(
      self, component_name: str, prop_name: str, prop_schema: Any
  ) -> str:
    """Maps a JSON schema definition to a TypeScript type string."""
    if prop_name == "checks":
      return "FunctionCall[]"

    if not isinstance(prop_schema, dict):
      return "any"

    allows_db = _schema_allows_databinding(prop_schema)
    base_type = "any"

    if "$ref" in prop_schema:
      ref = prop_schema["$ref"]
      if "ComponentId" in ref:
        base_type = "A2UIElement"
      elif "ChildList" in ref:
        base_type = "A2UIElement | A2UIElement[]"
      elif "Action" in ref:
        base_type = "Action"
      else:
        ref_name = ref.split("/")[-1]
        if ref_name in ["DynamicString", "String"]:
          base_type = "string"
        elif ref_name in ["DynamicNumber", "Number", "Integer"]:
          base_type = "number"
        elif ref_name in ["DynamicBoolean", "Boolean"]:
          base_type = "boolean"
        else:
          base_type = "any"

    elif prop_schema.get("type") == "object" and "path" in prop_schema.get(
        "properties", {}
    ):
      # Direct mapping of DataBinding object to TS type
      base_type = "DataBinding"

    elif "oneOf" in prop_schema or "anyOf" in prop_schema:
      subs = prop_schema.get("oneOf", []) + prop_schema.get("anyOf", [])
      types = []
      for sub in subs:
        t = self._map_schema_to_ts_type(component_name, prop_name, sub)
        if t != "any":
          types.append(t)
      if types:
        # Deduplicate
        types = list(dict.fromkeys(types))
        # If we have DataBinding and other types, we will handle it later.
        # But if we have both 'DataBinding' and some object representation of it,
        # we keep only 'DataBinding'.
        if "DataBinding" in types:
          types = [t for t in types if not t.startswith("{")]
        base_type = " | ".join(types)
      else:
        base_type = "any"

    elif "enum" in prop_schema:
      base_type = " | ".join([f"'{v}'" for v in prop_schema["enum"]])

    elif "type" in prop_schema:
      t = prop_schema["type"]
      if t == "string":
        base_type = "string"
      elif t in ["number", "integer"]:
        base_type = "number"
      elif t == "boolean":
        base_type = "boolean"
      elif t == "array":
        if "items" in prop_schema:
          items_schema = prop_schema["items"]
          if (
              isinstance(items_schema, dict)
              and items_schema.get("type") == "object"
              and "properties" in items_schema
          ):
            sub_props = []
            for sub_k, sub_v in items_schema["properties"].items():
              sub_t = self._map_schema_to_ts_type(
                  component_name, f"{prop_name}.{sub_k}", sub_v
              )
              is_sub_req = sub_k in items_schema.get("required", [])
              sub_props.append(f"{sub_k}{'' if is_sub_req else '?'}: {sub_t}")
            base_type = f"Array<{{\n    {'; '.join(sub_props)};\n  }}>"
          else:
            item_t = self._map_schema_to_ts_type(
                component_name, prop_name, items_schema
            )
            if "|" in item_t:
              base_type = f"({item_t})[]"
            else:
              base_type = f"{item_t}[]"
        else:
          base_type = "any[]"
      elif t == "object":
        if "properties" in prop_schema:
          sub_props = []
          for sub_k, sub_v in prop_schema["properties"].items():
            sub_t = self._map_schema_to_ts_type(
                component_name, f"{prop_name}.{sub_k}", sub_v
            )
            is_sub_req = sub_k in prop_schema.get("required", [])
            sub_props.append(f"{sub_k}{'' if is_sub_req else '?'}: {sub_t}")
          base_type = f"{{\n    {'; '.join(sub_props)};\n  }}"
        else:
          base_type = "Record<string, any>"

    if (
        allows_db
        and base_type
        not in [
            "A2UIElement",
            "A2UIElement | A2UIElement[]",
            "Action",
            "any",
            "DataBinding",
        ]
    ):
      if "DataBinding" not in base_type:
        if "|" in base_type:
          base_type = f"({base_type}) | DataBinding"
        else:
          base_type = f"{base_type} | DataBinding"

    return base_type

  def generate_component_declarations(self) -> str:
    """Compiles component definitions into TSX interfaces and declarations.

    Returns:
        A string containing TSX interface and const declarations.
    """
    declarations = []
    for name in sorted(self.helper.component_properties.keys()):
      props = self.helper.get_component_properties(name)
      reqs = self.helper.get_component_required(name)
      comp_desc = self.helper.get_component_description(name)

      # Find all action properties to handle renaming
      action_props = []
      for p in props:
        p_schema = self.helper.get_property_schema(name, p)
        if _is_action(p_schema):
          action_props.append(p)

      interface_lines = [f"interface {name}Props {{"]
      # id is technically optional in the compiler (auto-generated),
      # but we make it optional but present.
      interface_lines.append("  /** Unique identifier for the component. */")
      interface_lines.append("  id?: string;")

      for p in props:
        p_schema = self.helper.get_property_schema(name, p)
        is_req = p in reqs

        ts_prop_name = p
        if p in action_props:
          if len(action_props) == 1:
            ts_prop_name = "onclick"
          else:
            # e.g. submitAction -> onSubmitAction
            ts_prop_name = "on" + p[0].upper() + p[1:]

        ts_type = self._map_schema_to_ts_type(name, p, p_schema)

        p_desc = (
            p_schema.get("description") if isinstance(p_schema, dict) else None
        )
        if p_desc:
          # Format multiline description for JSDoc
          desc_lines = p_desc.strip().split("\n")
          if len(desc_lines) == 1:
            interface_lines.append(f"  /** {p_desc} */")
          else:
            interface_lines.append("  /**")
            for dl in desc_lines:
              interface_lines.append(f"   * {dl}")
            interface_lines.append("   */")

        opt_sign = "" if is_req else "?"
        interface_lines.append(f"  {ts_prop_name}{opt_sign}: {ts_type};")

      interface_lines.append("}")

      # Generate JSDoc for the component
      jsdoc = ["/**"]
      if comp_desc:
        for line in comp_desc.strip().split("\n"):
          jsdoc.append(f" * {line}")
      jsdoc.append(f" * @element a2ui-{_to_kebab_case(name)}")
      jsdoc.append(" */")
      jsdoc_str = "\n".join(jsdoc)

      decl = (
          f"{'\n'.join(interface_lines)}\n{jsdoc_str}\ndeclare const"
          f" {name}: React.FC<{name}Props>;"
      )
      declarations.append(decl)

    return "\n\n".join(declarations)

  def generate_function_declarations(self) -> str:
    """Compiles function definitions into TypeScript function declarations.

    Returns:
        A string containing TypeScript function declarations.
    """
    declarations = []
    for name in sorted(self.helper.function_properties.keys()):
      props = self.helper.get_function_properties(name)
      reqs = self.helper.get_function_required(name)
      f_desc = self.helper.get_function_description(name)

      func_schema = self.helper.functions.get(name, {})
      return_type = func_schema.get("returnType", "any")

      args_properties = (
          func_schema.get("properties", {})
          .get("args", {})
          .get("properties", {})
      )

      arg_decls = []
      for p in props:
        is_req = p in reqs
        p_schema = args_properties.get(p, {})
        p_type = self._map_schema_to_ts_type(name, p, p_schema)
        opt_sign = "" if is_req else "?"
        arg_decls.append(f"{p}{opt_sign}: {p_type}")

      jsdoc = []
      if f_desc:
        jsdoc.append("/**")
        for line in f_desc.strip().split("\n"):
          jsdoc.append(f" * {line}")
        jsdoc.append(" */")
      jsdoc_str = "\n".join(jsdoc) + "\n" if jsdoc else ""

      decl = (
          f"{jsdoc_str}declare function {name}({', '.join(arg_decls)}):"
          f" {return_type};"
      )
      declarations.append(decl)

    return "\n\n".join(declarations)

  def generate_prompt(self) -> str:
    """Assembles the complete system instruction block for the LLM.

    Returns:
        The full system prompt string explaining A2UI Elemental and its catalog.
    """
    comp_decls = self.generate_component_declarations()
    func_decls = self.generate_function_declarations()
    catalog_instructions = self.helper.catalog.get("instructions", "")

    # Format catalog instructions block if it exists
    catalog_instructions_block = ""
    if catalog_instructions:
      catalog_instructions_block = (
          f"\n\n## Catalog Instructions\n\n{catalog_instructions}"
      )

    common_types = """type DataBinding = string;
type A2UIElement = React.ReactElement;
type Action = any;
type FunctionCall = any;"""

    prompt_template = r"""# A2UI Elemental Output Contract

You must output the user interface using A2UI Elemental HTML5-like markup.
You MUST surround the entire output with the `<body>` and `</body>` tags.
Inside the `<body>`, you must include a `<link rel="catalog" href="[CATALOG_ID]">` pointing to the active catalog.

## HTML5 Markup Rules

1. **Component Tags**: Use custom elements prefixed with `a2ui-` in kebab-case (e.g. `<a2ui-card>`, `<a2ui-text-input>`).
2. **Component IDs**: Always provide a unique `id` attribute for every component (e.g. `<a2ui-button id="btn_1">`).
3. **Attributes**:
   - Pass static string values as regular attributes: `variant="primary"`.
   - Pass typed literals (numbers, booleans) and expressions inside curly braces `{...}` enclosed in double quotes: `elevation="{4}"`, `disabled="{true}"`.
4. **Data Binding**: Prefix paths in the shared data model with `$` inside curly braces: `value="{$/user/name}"`.
   - Use relative paths (without leading slash) inside list templates: `text="{$name}"`.
   - Use `{$this}` to reference the current item in a primitive list.
5. **Expressions & Functions**: You can call catalog functions inside curly braces. Function arguments MUST be named: `text="{formatCurrency(value: $/price, currency: 'USD')}"`.
6. **Children & Slots**:
   - Nest child elements inside parent elements.
   - If a component has a single child property (like `child`), place it as a direct nested element.
   - If a component has multiple child properties (slots), use the `slot` attribute:
     ```html
     <a2ui-split-view id="split">
       <a2ui-card id="left" slot="leading">...</a2ui-card>
       <a2ui-card id="right" slot="trailing">...</a2ui-card>
     </a2ui-split-view>
     ```
7. **Complex Properties**: For complex JSON object properties, use a `<script type="application/json">` element with a `slot` attribute matching the property name:
     ```html
     <a2ui-table id="table">
       <script type="application/json" slot="columns">
         [{"key": "name", "label": "Name"}]
       </script>
     </a2ui-table>
     ```
8. **Templates**: For dynamic lists, use a `<template>` element:
     ```html
     <a2ui-list id="list" path="{$/items}">
       <template>
         <a2ui-text id="item_title">{$title}</a2ui-text>
       </template>
     </a2ui-list>
     ```
9. **Actions**: Use `on-<property-name>` in kebab-case for action events, or `onclick` if it is the only action: `onclick="{Event('click')}"`.
10. **Data Model Initialization**: You can initialize the data model using a `<script type="application/json">` at the root of the `<body>` (without a slot attribute).

## TypeScript/TSX Component Contracts

Use these TypeScript interfaces and declarations to understand the available components and their properties.
Although you output HTML, your HTML elements and attributes must match these TypeScript definitions (converting camelCase props to kebab-case attributes in HTML where appropriate, e.g. `errorMessage` -> `error-message`).

```typescript
[COMMON_TYPES]

[COMPONENT_DECLARATIONS]
```

## Helper Functions

You can use these functions inside attribute expressions `{...}`.
All function calls MUST use named arguments, e.g. `func(arg: value)`.

```typescript
[FUNCTION_DECLARATIONS]
```[CATALOG_INSTRUCTIONS_BLOCK]"""

    prompt = (
        prompt_template.replace("[CATALOG_ID]", self.catalog_id)
        .replace("[COMMON_TYPES]", common_types)
        .replace("[COMPONENT_DECLARATIONS]", comp_decls)
        .replace("[FUNCTION_DECLARATIONS]", func_decls)
        .replace("[CATALOG_INSTRUCTIONS_BLOCK]", catalog_instructions_block)
    )
    return prompt
