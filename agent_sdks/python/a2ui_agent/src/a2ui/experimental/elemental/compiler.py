# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Compilation engine for A2UI Elemental.

Parses A2UI Elemental HTML5-like markup into a DOM tree, resolves reactive
bindings and validation checks, and compiles it into standard A2UI v1.0 JSON.
"""

import json
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.experimental.express.schema_helper import CatalogSchemaHelper
from a2ui.experimental.express.constants import SurfaceOperation
from .expression_parser import ElementalExpressionParser

TAG_PREFIX = "ui-"


def _is_action_property(prop_schema: Any) -> bool:
    """Helper to check if a property schema definition represents an Action."""
    if not isinstance(prop_schema, dict):
        return False
    if "$ref" in prop_schema:
        ref = prop_schema["$ref"]
        ref_name = ref.split("/")[-1]
        if ref_name == "Action":
            return True
    if "oneOf" in prop_schema or "anyOf" in prop_schema or "allOf" in prop_schema:
        subs = (
            prop_schema.get("oneOf", [])
            + prop_schema.get("anyOf", [])
            + prop_schema.get("allOf", [])
        )
        for sub in subs:
            if _is_action_property(sub):
                return True
    return False


class Node:
    """A simple DOM node representing an HTML element or text."""

    def __init__(self, tag: str, attrs: List[tuple[str, str]]):
        self.tag = tag.lower()
        self.attrs = dict(attrs)
        self.children: List[Node] = []
        self.text = ""


class DomBuilder(HTMLParser):
    """A forgiving HTML parser that builds a simple DOM tree."""

    def __init__(self, container_tags: Optional[set[str]] = None):
        super().__init__()
        self.root: Optional[Node] = None
        self.stack: List[Node] = []
        self.container_tags = container_tags or set()

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        # Auto-close top of stack if it is a leaf component and we are starting a new component tag
        if tag_lower.startswith(TAG_PREFIX):
            while (
                self.stack
                and self.stack[-1].tag.startswith(TAG_PREFIX)
                and self.stack[-1].tag not in self.container_tags
            ):
                self.stack.pop()

        node = Node(tag_lower, attrs)
        if not self.root:
            self.root = node
        if self.stack:
            self.stack[-1].children.append(node)
        # Do not push void elements to the stack since they do not have closing tags
        if tag_lower not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self.stack.append(node)

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        # Forgivingly pop matching tag from stack
        if self.stack and self.stack[-1].tag == tag_lower:
            self.stack.pop()
        elif self.stack:
            # Handle misaligned closing tags by looking up the stack
            for idx in range(len(self.stack) - 1, -1, -1):
                if self.stack[idx].tag == tag_lower:
                    self.stack = self.stack[:idx]
                    break

    def handle_startendtag(self, tag, attrs):
        tag_lower = tag.lower()
        if tag_lower.startswith(TAG_PREFIX):
            while (
                self.stack
                and self.stack[-1].tag.startswith(TAG_PREFIX)
                and self.stack[-1].tag not in self.container_tags
            ):
                self.stack.pop()

        node = Node(tag_lower, attrs)
        if not self.root:
            self.root = node
        if self.stack:
            self.stack[-1].children.append(node)

    def handle_data(self, data):
        if self.stack:
            self.stack[-1].text += data


def _has_label_value(sub: Any) -> bool:
    if not isinstance(sub, dict):
        return False
    if (
        "properties" in sub
        and "label" in sub["properties"]
        and "value" in sub["properties"]
    ):
        return True
    for k in ["allOf", "oneOf", "anyOf"]:
        if k in sub and isinstance(sub[k], list):
            if any(_has_label_value(s) for s in sub[k]):
                return True
    return False


def _schema_expects_option_objects(schema: Any) -> bool:
    """Checks if a property's schema expects a list of objects with label/value."""
    if not isinstance(schema, dict):
        return False
    if "items" in schema:
        return _has_label_value(schema["items"])
    for key in ["allOf", "oneOf", "anyOf"]:
        if key in schema and isinstance(schema[key], list):
            if any(_schema_expects_option_objects(sub) for sub in schema[key]):
                return True
    return False


def _get_enum_values(schema: Any) -> Optional[List[Any]]:
    """Recursively finds and extracts enum values from a schema dict."""
    if not isinstance(schema, dict):
        return None
    if "enum" in schema:
        return schema["enum"]
    for key in ["oneOf", "anyOf", "allOf"]:
        if key in schema and isinstance(schema[key], list):
            for sub in schema[key]:
                vals = _get_enum_values(sub)
                if vals is not None:
                    return vals
    return None


def _escape_nested_script_tags(html: str) -> str:
    """Escapes nested </script> tags inside <script type="application/json"> blocks.

    If a JSON string property contains "</script>" (e.g. game HTML code), it
    breaks standard HTML parsers unless escaped as "<\\/script>".
    """
    pos = 0
    result = []
    while pos < len(html):
        # Find start of script tag
        start_idx = html.lower().find("<script", pos)
        if start_idx == -1:
            result.append(html[pos:])
            break

        # Find the closing '>' of the start tag
        tag_end = html.find(">", start_idx)
        if tag_end == -1:
            result.append(html[pos:])
            break

        tag_content = html[start_idx : tag_end + 1]
        result.append(html[pos : tag_end + 1])
        pos = tag_end + 1

        if "application/json" in tag_content.lower():
            # Scan until matching </script>, escaping nested ones
            in_string = False
            escape = False
            script_content = []

            while pos < len(html):
                # Check if we reached the true </script> (only when not in string)
                if not in_string and html[pos : pos + 9].lower() == "</script>":
                    break

                c = html[pos]
                if in_string:
                    if escape:
                        escape = False
                        script_content.append(c)
                    elif c == "\\":
                        escape = True
                        script_content.append(c)
                    elif c == '"':
                        in_string = False
                        script_content.append(c)
                    else:
                        # If we see </script> inside a string, we escape the slash
                        if html[pos : pos + 9].lower() == "</script>":
                            script_content.append("<\\/script>")
                            pos += 8  # skip the rest of /script
                        else:
                            script_content.append(c)
                else:
                    if c == '"':
                        in_string = True
                    script_content.append(c)
                pos += 1

            result.append("".join(script_content))

    return "".join(result)


def _property_schema_accepts_components(schema: Any) -> bool:
    """Recursively checks if a property schema accepts component ID strings or lists of them."""
    if not isinstance(schema, dict):
        return False
    ref = schema.get("$ref", "")
    if isinstance(ref, str) and any(
        ref.endswith(suffix)
        for suffix in ["ComponentId", "ComponentIdArray", "Child", "ChildList"]
    ):
        return True
    if "items" in schema:
        if _property_schema_accepts_components(schema["items"]):
            return True
    for k in ["oneOf", "anyOf", "allOf"]:
        if k in schema and isinstance(schema[k], list):
            if any(_property_schema_accepts_components(sub) for sub in schema[k]):
                return True
    return False


class _CompileContext:
    """Holds mutable state during compilation."""

    def __init__(self):
        self.components: List[Dict[str, Any]] = []
        self.auto_id_counter = 0

    def next_auto_id(self) -> str:
        self.auto_id_counter += 1
        return f"comp_{self.auto_id_counter}"


class ElementalCompiler:
    """Compilation pipeline for A2UI Elemental HTML."""

    def __init__(self, catalog: Union[Catalog[Any, Any], A2uiCatalog]):
        self.helper = CatalogSchemaHelper(catalog)
        self.expr_parser = ElementalExpressionParser()

        # Pre-compute container tags for forgiving parsing
        self.container_tags = {"body", "template"}
        for comp_name in self.helper.components:
            properties = self.helper.get_component_properties(comp_name)
            has_slotted_children = False
            for prop_name in properties:
                prop_schema = self.helper.get_property_schema(comp_name, prop_name)
                if _property_schema_accepts_components(prop_schema):
                    has_slotted_children = True
                    break
            if has_slotted_children:
                # Convert PascalCase to kebab-case
                s1 = re.sub("(.)([A-Z][a-z]+)", r"\1-\2", comp_name)
                kebab_name = (
                    TAG_PREFIX + re.sub("([a-z0-9])([A-Z])", r"\1-\2", s1).lower()
                )
                self.container_tags.add(kebab_name)

    def _resolve_action_property_name(self, name: str, properties: List[str]) -> str:
        """Maps React-like event names (onclick, onSubmitAction) back to catalog properties (action, submitAction)."""
        if name == "onclick" and "action" in properties and "onclick" not in properties:
            return "action"
        if name.startswith("on") and len(name) > 2:
            camel_action = name[2].lower() + name[3:]
            if camel_action in properties and name not in properties:
                return camel_action
        return name

    def compile(
        self,
        html_text: str,
        surface_id: str = "default_surface",
        catalog_id: str = "",
        is_final: bool = True,
    ) -> dict:
        """Compiles A2UI Elemental HTML into standard A2UI v1.0 wire JSON."""
        escaped_html = _escape_nested_script_tags(html_text)
        builder = DomBuilder(self.container_tags)
        builder.feed(escaped_html)
        root = builder.root

        if not root:
            raise ValueError("A2UI Elemental document is empty.")

        if root.tag == "body":
            # If there is a standalone operation inside body, treat it as the root
            standalone = None
            for child in root.children:
                if child.tag in [
                    f"{TAG_PREFIX}delete-surface",
                    f"{TAG_PREFIX}call-function",
                ]:
                    standalone = child
                    break
            if standalone:
                root = standalone

        if root.tag == f"{TAG_PREFIX}delete-surface":
            surf_id = root.attrs.get("surface-id", "")
            return {
                "version": "v1.0",
                SurfaceOperation.DELETE: {"surfaceId": surf_id},
            }

        if root.tag == f"{TAG_PREFIX}call-function":
            call_name = root.attrs.get("name", "")
            func_call_id = root.attrs.get("id", "")
            want_resp_val = root.attrs.get("want-response", "")
            want_response = False
            if want_resp_val:
                parsed_want_resp = self.expr_parser.parse(want_resp_val)
                if isinstance(parsed_want_resp, bool):
                    want_response = parsed_want_resp
                else:
                    want_response = str(parsed_want_resp).lower() == "true"

            args = {}
            for attr_name, attr_val in root.attrs.items():
                if attr_name in ["id", "name", "want-response"]:
                    continue
                # Map kebab-case attribute names to camelCase property names
                prop_parts = attr_name.split("-")
                prop_name = prop_parts[0] + "".join(
                    p.capitalize() for p in prop_parts[1:]
                )
                args[prop_name] = self.expr_parser.parse(attr_val)

            call_op = {
                "call": call_name,
                "args": args,
            }

            envelope = {
                "version": "v1.0",
                SurfaceOperation.CALL_FUNC: call_op,
            }
            if want_response:
                envelope["wantResponse"] = True
            if func_call_id:
                envelope["functionCallId"] = func_call_id
            return envelope

        if root.tag != "body":
            raise ValueError(
                "A2UI Elemental document must have a <body>,"
                f" <{TAG_PREFIX}delete-surface>, or <{TAG_PREFIX}call-function> root"
                " element."
            )

        # 1. Surface ID from body
        surface_id = root.attrs.get("id", surface_id)

        # 2. Extract catalog ID and data model from children
        catalog_id_from_link = ""
        data_model = {}
        remaining_children = []

        for child in root.children:
            if child.tag == "link" and child.attrs.get("rel") == "catalog":
                catalog_id_from_link = child.attrs.get("href", "")
            elif (
                child.tag == "script" and child.attrs.get("type") == "application/json"
            ):
                if "slot" not in child.attrs:
                    try:
                        data_model = json.loads(child.text.strip())
                    except json.JSONDecodeError as e:
                        raise ValueError(
                            f"Invalid JSON in root dataModel script: {e}"
                        ) from e
                else:
                    remaining_children.append(child)
            else:
                remaining_children.append(child)

        if not catalog_id:
            catalog_id = catalog_id_from_link or self.helper.catalog.get(
                "catalogId", "https://a2ui.org/catalog.json"
            )

        ctx = _CompileContext()

        # If the document contains ONLY a data model and no components, output updateDataModel
        # Note: we filter out any empty text nodes or non-component nodes
        component_children = [
            c for c in remaining_children if c.tag.startswith(TAG_PREFIX)
        ]

        if not component_children and data_model:
            return {
                "version": "v1.0",
                SurfaceOperation.UPDATE_DATA: {
                    "surfaceId": surface_id,
                    "path": "/",
                    "value": data_model,
                },
            }

        # 3. Compile components recursively
        for child in remaining_children:
            if not child.tag.startswith(TAG_PREFIX):
                raise ValueError(
                    f"Invalid element tag '{child.tag}' under <body>. Only"
                    f" '{TAG_PREFIX}*' components are supported inside A2UI surfaces."
                )

        for child in component_children:
            self._compile_node(child, ctx)

        # Wrap in standard envelope
        envelope = {
            "version": "v1.0",
            SurfaceOperation.CREATE: {
                "surfaceId": surface_id,
                "catalogId": catalog_id,
                "components": ctx.components,
            },
        }
        if data_model:
            envelope[SurfaceOperation.CREATE]["dataModel"] = data_model

        return envelope

    def _compile_value(self, val: Any, is_action: bool = False) -> Any:
        """Recursively post-processes parsed expressions to match A2UI JSON structures."""
        if isinstance(val, dict):
            if "path" in val:
                return val
            if "call" in val:
                fn_name = val["call"]
                fn_args = val.get("args", {})

                # Translate Event signature
                if fn_name == "Event":
                    event_name = ""
                    context = {}
                    if isinstance(fn_args, list):
                        if len(fn_args) > 0:
                            event_name = self._compile_value(fn_args[0], is_action)
                        if len(fn_args) > 1:
                            raw_ctx = self._compile_value(fn_args[1], is_action)
                            if isinstance(raw_ctx, dict):
                                context.update(raw_ctx)
                    elif isinstance(fn_args, dict):
                        if "name" in fn_args:
                            event_name = self._compile_value(fn_args["name"], is_action)
                        if "context" in fn_args:
                            raw_ctx = self._compile_value(fn_args["context"], is_action)
                            if isinstance(raw_ctx, dict):
                                context.update(raw_ctx)
                    return {"event": {"name": event_name, "context": context}}

                # Translate catalog functions
                if fn_name in self.helper.functions:
                    fn_props = self.helper.get_function_properties(fn_name)
                    compiled_args = {}
                    if isinstance(fn_args, dict):
                        for k, v in fn_args.items():
                            compiled_args[k] = self._compile_value(v, is_action)
                    elif isinstance(fn_args, list):
                        for idx, v in enumerate(fn_args):
                            if idx < len(fn_props):
                                compiled_args[fn_props[idx]] = self._compile_value(
                                    v, is_action
                                )

                    fn_schema = self.helper.functions[fn_name]

                    if is_action:
                        return {
                            "functionCall": {"call": fn_name, "args": compiled_args}
                        }

                    return {"call": fn_name, "args": compiled_args}

            return {k: self._compile_value(v, is_action) for k, v in val.items()}

        if isinstance(val, list):
            return [self._compile_value(item, is_action) for item in val]

        return val

    def _compile_node(self, node: Node, ctx: _CompileContext) -> Optional[str]:
        """Compiles a DOM node into a component and returns its ID."""
        if not node.tag.startswith(TAG_PREFIX):
            raise ValueError(
                f"Invalid element tag '{node.tag}'. Only '{TAG_PREFIX}*' components are"
                " supported inside A2UI surfaces."
            )

        # Map kebab-case to PascalCase (e.g., ui-text-input -> TextInput)
        comp_name = "".join(
            word.capitalize() for word in node.tag.replace(TAG_PREFIX, "").split("-")
        )

        if comp_name not in self.helper.components:
            raise ValueError(
                f"Unknown component '{comp_name}' for tag '{node.tag}' in the loaded"
                " catalog."
            )
        properties = self.helper.get_component_properties(comp_name)
        comp_id = node.attrs.get("id") or ctx.next_auto_id()

        comp_dict = {"id": comp_id, "component": comp_name}

        # Track sibling value path for implicit validation injection
        sibling_value_path = None

        # Check for template child
        template_node = next((c for c in node.children if c.tag == "template"), None)

        # 1. Map attributes to properties
        for attr_name, attr_val in node.attrs.items():
            if attr_name in ["id", "slot"]:
                continue
            if attr_name == "path" and template_node:
                continue

            # Map kebab-case attribute names to camelCase property names
            prop_parts = attr_name.split("-")
            prop_name = prop_parts[0] + "".join(p.capitalize() for p in prop_parts[1:])

            # Map TS/HTML action names back to catalog properties
            prop_name = self._resolve_action_property_name(prop_name, properties)

            if comp_name in self.helper.components and prop_name not in properties:
                continue

            # Parse value
            if attr_val is None or attr_val == "":
                # HTML boolean attribute shorthand (e.g., <ui-button disabled>)
                prop_schema = self.helper.get_property_schema(comp_name, prop_name)
                if prop_schema and prop_schema.get("type") == "boolean":
                    parsed_val = True
                else:
                    parsed_val = ""
            else:
                parsed_val = self.expr_parser.parse(attr_val)

            # Post-process expression value (events, functions, etc.)
            parsed_val = self._compile_value(
                parsed_val, is_action=(prop_name in ["action", "submitAction"])
            )

            # Handle option auto-expansion
            prop_schema = self.helper.get_property_schema(comp_name, prop_name)
            if (
                prop_schema
                and isinstance(parsed_val, list)
                and _schema_expects_option_objects(prop_schema)
            ):
                parsed_val = [
                    {"label": opt, "value": opt} if isinstance(opt, str) else opt
                    for opt in parsed_val
                ]

            if parsed_val is None:
                continue
            if parsed_val == "" and prop_name in ["action", "submitAction", "onclick"]:
                continue

            # Try case-insensitive matching for enums, raising ValueError if still invalid
            if isinstance(parsed_val, str):
                enum_vals = _get_enum_values(prop_schema)
                if enum_vals is not None and parsed_val not in enum_vals:
                    matched = False
                    # Normalize to ignore casing, hyphens, and underscores
                    normalized_val = (
                        parsed_val.lower().replace("-", "").replace("_", "")
                    )
                    for ev in enum_vals:
                        if isinstance(ev, str):
                            normalized_ev = ev.lower().replace("-", "").replace("_", "")
                            if normalized_ev == normalized_val:
                                parsed_val = ev
                                matched = True
                                break
                    if not matched:
                        raise ValueError(
                            f"Property '{prop_name}' in component '{comp_name}' has"
                            f" invalid enum value '{parsed_val}'. Valid values:"
                            f" {enum_vals}"
                        )

            comp_dict[prop_name] = parsed_val

            if (
                prop_name == "value"
                and isinstance(parsed_val, dict)
                and "path" in parsed_val
            ):
                sibling_value_path = parsed_val

        # 3. Map children (slots and templates)
        default_slot = None
        if "children" in properties:
            default_slot = "children"
            comp_dict["children"] = []
        elif "child" in properties:
            default_slot = "child"

        if template_node and default_slot:
            # It's a dynamic list template!
            path_attr = node.attrs.get("path") or template_node.attrs.get("path")
            if not path_attr:
                raise ValueError(
                    f"Component '{comp_id}' has a <template> child but is missing the"
                    " 'path' attribute."
                )
            path_val = self.expr_parser.parse(path_attr)
            if not isinstance(path_val, dict) or "path" not in path_val:
                raise ValueError(
                    f"The 'path' attribute of component '{comp_id}' must be a dynamic"
                    f" data binding, got: {path_attr}"
                )

            # Compile template children
            template_ids = []
            for template_child in template_node.children:
                t_id = self._compile_node(template_child, ctx)
                if t_id:
                    template_ids.append(t_id)

            if template_ids:
                comp_dict[default_slot] = {
                    "path": path_val["path"],
                    "componentId": template_ids[0],
                }

            # Process other script slots if present
            for child in node.children:
                if (
                    child.tag == "script"
                    and child.attrs.get("type") == "application/json"
                ):
                    slot_name = child.attrs.get("slot")
                    if slot_name:
                        slot_name = self._resolve_action_property_name(
                            slot_name, properties
                        )
                        try:
                            comp_dict[slot_name] = json.loads(child.text.strip())
                        except json.JSONDecodeError as e:
                            raise ValueError(
                                f"Invalid JSON in script slot '{slot_name}' of"
                                f" component '{comp_id}': {e}"
                            ) from e
        else:
            # Normal child processing
            for child in node.children:
                if (
                    child.tag == "script"
                    and child.attrs.get("type") == "application/json"
                ):
                    slot_name = child.attrs.get("slot")
                    if slot_name:
                        slot_name = self._resolve_action_property_name(
                            slot_name, properties
                        )
                        try:
                            comp_dict[slot_name] = json.loads(child.text.strip())
                        except json.JSONDecodeError as e:
                            raise ValueError(
                                f"Invalid JSON in script slot '{slot_name}' of"
                                f" component '{comp_id}': {e}"
                            ) from e
                else:
                    child_id = self._compile_node(child, ctx)
                    if not child_id:
                        continue
                    slot_name = child.attrs.get("slot")
                    if slot_name:
                        slot_name = self._resolve_action_property_name(
                            slot_name, properties
                        )
                        if slot_name in properties:
                            slot_schema = self.helper.get_property_schema(
                                comp_name, slot_name
                            )
                            if slot_schema and slot_schema.get("type") == "array":
                                if slot_name not in comp_dict:
                                    comp_dict[slot_name] = []
                                comp_dict[slot_name].append(child_id)
                            else:
                                comp_dict[slot_name] = child_id
                    elif default_slot:
                        if default_slot == "children":
                            comp_dict["children"].append(child_id)
                        else:
                            comp_dict["child"] = child_id

        # 4. Handle implicit validation check value injection and wrap in condition objects
        if "checks" in comp_dict and isinstance(comp_dict["checks"], list):
            wrapped_checks = []
            for check in comp_dict["checks"]:
                if isinstance(check, dict) and "call" in check:
                    fn_name = check["call"]
                    fn_args = check.get("args", {})
                    fn_props = self.helper.get_function_properties(fn_name)

                    # Extract message if it was incorrectly placed inside the function call dict
                    msg = "Invalid input"
                    if isinstance(fn_args, dict):
                        msg = fn_args.pop(
                            "message", fn_args.pop("errorMessage", "Invalid input")
                        )
                    else:
                        msg = check.pop(
                            "message", check.pop("errorMessage", "Invalid input")
                        )

                    # Inject sibling value path if "value" is a parameter of the function and is omitted
                    if (
                        isinstance(fn_args, dict)
                        and fn_props
                        and "value" in fn_props
                        and "value" not in fn_args
                        and sibling_value_path
                    ):
                        fn_args["value"] = sibling_value_path

                    if fn_args:
                        check["args"] = fn_args

                    if "returnType" in check:
                        del check["returnType"]

                    if "message" in check:
                        del check["message"]
                    if "errorMessage" in check:
                        del check["errorMessage"]

                    wrapped_checks.append({"condition": check, "message": msg})
                elif isinstance(check, dict) and "condition" in check:
                    cond = check["condition"]
                    if isinstance(cond, dict) and "call" in cond:
                        fn_name = cond["call"]
                        fn_args = cond.get("args", {})
                        fn_props = self.helper.get_function_properties(fn_name)

                        # Extract message if it was incorrectly placed inside the condition function call
                        msg_from_cond = None
                        if isinstance(fn_args, dict):
                            msg_from_cond = fn_args.pop(
                                "message", fn_args.pop("errorMessage", None)
                            )
                        if not msg_from_cond:
                            msg_from_cond = cond.pop(
                                "message", cond.pop("errorMessage", None)
                            )

                        if msg_from_cond and "message" not in check:
                            check["message"] = msg_from_cond
                        if "message" in cond:
                            del cond["message"]
                        if "errorMessage" in cond:
                            del cond["errorMessage"]

                        # Inject sibling value path if "value" is a parameter of the function and is omitted
                        if (
                            isinstance(fn_args, dict)
                            and fn_props
                            and "value" in fn_props
                            and "value" not in fn_args
                            and sibling_value_path
                        ):
                            fn_args["value"] = sibling_value_path

                        if fn_args:
                            cond["args"] = fn_args

                        if "returnType" in cond:
                            del cond["returnType"]

                    # Ensure the check dict has a message property
                    if "message" not in check:
                        check["message"] = "Invalid input"

                    wrapped_checks.append(check)
            comp_dict["checks"] = wrapped_checks

        # Clean up empty slots
        if "children" in comp_dict and not comp_dict["children"]:
            del comp_dict["children"]

        # Inject default action for any required Action property if missing (required by schema)
        required_props = self.helper.get_component_required(comp_name)
        for prop_name in required_props:
            if prop_name not in comp_dict:
                p_schema = self.helper.get_property_schema(comp_name, prop_name)
                if p_schema and _is_action_property(p_schema):
                    comp_dict[prop_name] = {
                        "event": {
                            "name": f"{comp_id}_clicked",
                            "context": {"component": comp_name, "property": prop_name},
                        }
                    }

        ctx.components.append(comp_dict)
        return comp_id
