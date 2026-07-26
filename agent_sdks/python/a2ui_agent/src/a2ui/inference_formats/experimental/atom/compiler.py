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

"""Compilation engine for A2UI Atom S-Expressions."""

import re
import json
from typing import Any, Dict, List, Tuple, Union, Optional
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog


class CatalogSchemaHelperWrapper:
    """Wraps catalog schema helpers to provide component and property schema resolution.

    Attributes:
        catalog: The catalog containing component and function definitions.
    """

    def __init__(self, catalog: Any):
        """Initializes a CatalogSchemaHelperWrapper instance.

        Args:
            catalog: The catalog containing component and function definitions.
        """
        self.catalog = catalog
        self._helper = None
        if catalog is not None:
            try:
                from a2ui.schema.schema_helper import CatalogSchemaHelper
            except ImportError:
                from a2ui.inference_formats.experimental.express.schema_helper import (
                    CatalogSchemaHelper,
                )

            try:
                self._helper = CatalogSchemaHelper(self.catalog)
            except (ImportError, TypeError):
                self._helper = None

    def get_available_components(self) -> List[str]:
        if hasattr(self.catalog, "catalog_schema") and isinstance(
            self.catalog.catalog_schema, dict
        ):
            comps = self.catalog.catalog_schema.get("components", {})
            if comps:
                return sorted(list(comps.keys()))
        if hasattr(self.catalog, "get_components"):
            comps = self.catalog.get_components()
            if comps:
                return sorted(list(comps.keys()))
        return []

    def get_component_properties(self, comp_type: str) -> Any:
        if self._helper:
            return self._helper.get_component_properties(comp_type)
        if hasattr(self.catalog, "get_components"):
            comps = self.catalog.get_components()
            if comp_type in comps:
                return comps[comp_type].get("properties", {})
        return {}

    def get_component_required(self, comp_type: str) -> list[str]:
        if self._helper:
            return self._helper.get_component_required(comp_type)
        return []

    def get_property_type(self, comp_type: str, prop_name: str) -> Optional[str]:
        if self._helper:
            return self._helper.get_property_type(comp_type, prop_name)
        return None

    def get_child_list_property(self, comp_type: str) -> Optional[str]:
        props = self.get_component_properties(comp_type)
        if isinstance(props, dict):
            keys = list(props.keys())
        elif isinstance(props, (list, tuple)):
            keys = list(props)
        else:
            keys = []
        for k in keys:
            if self.get_property_type(comp_type, k) == "ChildList":
                return k
        if "children" in keys:
            return "children"
        return None

    def get_single_child_property(self, comp_type: str) -> Optional[str]:
        props = self.get_component_properties(comp_type)
        if isinstance(props, dict):
            keys = list(props.keys())
        elif isinstance(props, (list, tuple)):
            keys = list(props)
        else:
            keys = []
        for k in keys:
            if self.get_property_type(comp_type, k) in ("Child", "ComponentId"):
                return k
        for k in ("child", "content", "trigger"):
            if k in keys:
                return k
        return None


class SExprParser:
    """Tokenizes and parses Atom S-expressions into Abstract Syntax Tree (AST) lists.

    Attributes:
        text: The raw S-expression string.
        tokens: The tokenized list of S-expression elements.
        pos: The current scanner position in the token list.
    """

    def __init__(self, text: str):
        """Initializes an SExprParser instance.

        Args:
            text: The raw S-expression input string to parse.
        """
        self.text = text
        self.tokens = self._tokenize(text)
        self.pos = 0

    def _tokenize(self, text: str) -> List[str]:
        """Tokenizes S-expression string handling parens, brackets, quotes, keywords, comments, and paths."""
        token_spec = [
            ("COMMENT", r";[^\n]*"),
            ("STRING", r'"(?:\\.|[^"\\])*"'),
            ("LPAREN", r"[(\[]"),
            ("RPAREN", r"[\])]"),
            ("KEYWORD_VAL", r':[\w-]+=[^\s()":\[\],]+'),
            ("KEYWORD", r":[\w-]+:?"),
            ("PATH", r"\$/?[\w/-]+"),
            ("SYMBOL", r'[^\s()":\[\],]+'),
            ("SKIP", r"[,\s]+"),
        ]
        tok_regex = "|".join(f"(?P<{pair[0]}>{pair[1]})" for pair in token_spec)
        tokens = []
        last_end = 0
        while last_end < len(text):
            if text[last_end] == '"':
                m = re.match(r'"(?:\\.|[^"\\])*"', text[last_end:])
                if m:
                    tokens.append(m.group())
                    last_end += len(m.group())
                    continue
                else:
                    tokens.append(text[last_end:] + '"')
                    break
            mo = re.match(tok_regex, text[last_end:])
            if not mo:
                skipped = text[last_end:].strip()
                if skipped:
                    raise SyntaxError(
                        f"Unexpected character in Atom input: {skipped!r}"
                    )
                break
            kind = mo.lastgroup
            value = mo.group()
            last_end += len(value)
            if kind in ("SKIP", "COMMENT"):
                continue
            if kind == "KEYWORD_VAL":
                k, v = value.split("=", 1)
                tokens.append(k.rstrip(":"))
                tokens.append(v)
            elif kind == "KEYWORD":
                tokens.append(value.rstrip(":"))
            else:
                tokens.append(value)
        return tokens

    def parse(self) -> List[Any]:
        """Parses tokens into nested S-expression lists."""
        expressions = []
        while self.pos < len(self.tokens):
            expr = self._parse_expr()
            if expr is not None:
                expressions.append(expr)
        return expressions

    def _parse_expr(self) -> Any:
        if self.pos >= len(self.tokens):
            return None

        tok = self.tokens[self.pos]
        if tok in ("(", "[", "{"):
            closing = ")" if tok == "(" else ("]" if tok == "[" else "}")
            self.pos += 1
            elements = []
            while self.pos < len(self.tokens) and self.tokens[self.pos] != closing:
                sub = self._parse_expr()
                if sub is not None:
                    elements.append(sub)
            if self.pos < len(self.tokens) and self.tokens[self.pos] == closing:
                self.pos += 1
            return elements
        elif tok in (")", "]", "}"):
            self.pos += 1
            return None
        else:
            self.pos += 1
            return self._parse_atom(tok)

    def _parse_atom(self, tok: str) -> Any:
        if tok.startswith('"') and tok.endswith('"'):
            try:
                return json.loads(tok, strict=False)
            except Exception:
                return tok[1:-1]
        if tok == "true":
            return True
        if tok == "false":
            return False
        if tok == "null":
            return None
        try:
            if "." in tok:
                return float(tok)
            return int(tok)
        except ValueError:
            return tok


class AtomCompiler:
    """Compiles Atom S-expression ASTs into structured A2UI v1.0 JSON surface payloads.

    Attributes:
        catalog: The catalog containing component and function schemas.
        schema_helper: The catalog schema helper wrapper instance.
        node_counter: Auto-incrementing node ID generator counter.
    """

    def __init__(self, catalog: Union[Catalog[Any, Any], A2uiCatalog, Any]):
        """Initializes an AtomCompiler instance.

        Args:
            catalog: The catalog containing component and function schemas.
        """
        self.catalog = catalog
        self.schema_helper = CatalogSchemaHelperWrapper(catalog)
        self.node_counter = 0

    def _next_id(self) -> str:
        id_str = f"node_{self.node_counter}"
        self.node_counter += 1
        return id_str

    def _is_component_type(self, name: str) -> bool:
        """Determines if a string is a valid component type name."""
        if not name or not isinstance(name, str):
            return False
        if name in (
            "data",
            "dataModel",
            "set!",
            "Event",
            "template",
            "deleteSurface",
            "callFunction",
            "a2ui",
        ):
            return False
        comp_props = self.schema_helper.get_component_properties(name)
        if comp_props:
            return True
        available = self.schema_helper.get_available_components()
        return name in available

    def _get_primitive_text_component(self) -> Optional[Tuple[str, str]]:
        """Dynamically finds a single-string primitive component from catalog schema."""
        available = self.schema_helper.get_available_components()
        for comp in available:
            props = self.schema_helper.get_component_properties(comp)
            if not props:
                continue
            reqs = getattr(self.schema_helper, "get_component_required", lambda c: [])(
                comp
            )
            if len(reqs) == 1 and reqs[0] in (
                "text",
                "content",
                "label",
                "title",
                "value",
            ):
                return (comp, reqs[0])
            prop_keys = [p for p in props if p not in ("id", "component")]
            if len(prop_keys) == 1 and prop_keys[0] in (
                "text",
                "content",
                "label",
                "title",
                "value",
            ):
                return (comp, prop_keys[0])
        return None

    def _auto_wrap_text_child(
        self,
        text_val: str,
        components: List[Dict[str, Any]],
        data_model: Dict[str, Any],
    ) -> str:
        """Auto-wraps a raw text string child into a primitive text component dynamically inspected from catalog."""
        if not text_val or not isinstance(text_val, str):
            return text_val
        text_str = text_val.strip()
        if any(c.get("id") == text_str for c in components):
            return text_str
        text_info = self._get_primitive_text_component()
        if text_info:
            comp_name, text_prop = text_info
            return self._compile_component(
                [comp_name, f":{text_prop}", text_str], components, data_model
            )
        return text_val

    def _extract_data_list(self, data_model: dict, path: str) -> list:
        parts = [p for p in path.lstrip("/").split("/") if p]
        curr = data_model
        for p in parts:
            if isinstance(curr, dict) and p in curr:
                curr = curr[p]
            else:
                return []
        return curr if isinstance(curr, list) else []

    def compile(
        self, text: str, surface_id: str = "main", is_final: bool = True
    ) -> Dict[str, Any]:
        """Compiles raw Atom S-expression text into an A2UI message dictionary.

        Args:
            text: The raw Atom format text string to compile.
            surface_id: The target surface identifier. Defaults to "main".
            is_final: Whether this is the final stream chunk.

        Returns:
            The compiled A2UI JSON surface update payload dictionary.
        """
        cleaned_text = text.strip()
        if "<think>" in cleaned_text:
            cleaned_text = re.sub(
                r"<think>.*?</think>", "", cleaned_text, flags=re.DOTALL
            ).strip()

        if "<a2ui-json>" in cleaned_text:
            match = re.search(r"<a2ui-json>(.*?)</a2ui-json>", cleaned_text, re.DOTALL)
            if match:
                try:
                    parsed_json = json.loads(match.group(1).strip())
                    if isinstance(parsed_json, list) and parsed_json:
                        return parsed_json[0]
                    elif isinstance(parsed_json, dict):
                        return parsed_json
                except json.JSONDecodeError:
                    pass
        elif cleaned_text.startswith("[") or cleaned_text.startswith("{"):
            try:
                parsed_json = json.loads(cleaned_text)
                if isinstance(parsed_json, list) and parsed_json:
                    return parsed_json[0]
                elif isinstance(parsed_json, dict):
                    return parsed_json
            except json.JSONDecodeError:
                pass

        elif "<a2ui>" in cleaned_text:
            match = re.search(r"<a2ui>(.*?)(?:</a2ui>|$)", cleaned_text, re.DOTALL)
            if match:
                cleaned_text = match.group(1).strip()

        parser = SExprParser(cleaned_text)
        exprs = parser.parse()
        if not exprs:
            raise ValueError("No valid Atom expressions found.")

        data_model: Dict[str, Any] = {}
        components: List[Dict[str, Any]] = []

        for expr in exprs:
            if not isinstance(expr, list) or not expr:
                continue

            head = str(expr[0])

            if head in ("data", "set!"):
                self._parse_data_node(expr, data_model)
            elif head == "deleteSurface":
                surface_target = str(expr[1]) if len(expr) > 1 else surface_id
                return {
                    "version": "v1.0",
                    "deleteSurface": {"surfaceId": surface_target},
                }
            elif head == "callFunction":
                func_name = str(expr[1]) if len(expr) > 1 else ""
                args = {}
                i = 2
                while i < len(expr):
                    tok = str(expr[i])
                    if tok.startswith(":") and i + 1 < len(expr):
                        args[tok[1:]] = expr[i + 1]
                        i += 2
                    else:
                        i += 1
                return {
                    "version": "v1.0",
                    "callFunction": {
                        "call": func_name,
                        "args": args,
                    },
                }
            elif head in ("createSurface", "surface"):
                i = 1
                while i < len(expr):
                    item = expr[i]
                    if isinstance(item, str) and item.startswith(":"):
                        val = expr[i + 1] if i + 1 < len(expr) else None
                        if item in (":id", ":surfaceId") and val:
                            surface_id = str(val)
                        elif item == ":data" and isinstance(val, list):
                            self._parse_data_node(val, data_model)
                        elif item in (
                            ":root",
                            ":child",
                            ":children",
                            ":component",
                        ) and isinstance(val, list):
                            if self._is_component_type(str(val[0])):
                                self._compile_component(
                                    val, components, data_model, is_root=True
                                )
                            else:
                                for sub_elem in val:
                                    if (
                                        isinstance(sub_elem, list)
                                        and sub_elem
                                        and self._is_component_type(str(sub_elem[0]))
                                    ):
                                        self._compile_component(
                                            sub_elem,
                                            components,
                                            data_model,
                                            is_root=True,
                                        )
                        i += 2
                    elif isinstance(item, list) and item:
                        if str(item[0]) in ("data", "set!"):
                            self._parse_data_node(item, data_model)
                        elif self._is_component_type(str(item[0])):
                            self._compile_component(
                                item, components, data_model, is_root=True
                            )
                        i += 1
                    elif isinstance(item, str):
                        surface_id = item
                        i += 1
            else:
                # Component root tree
                root_id = self._compile_component(
                    expr, components, data_model, is_root=True
                )

        components = [
            c
            for c in components
            if c.get("component")
            not in (
                "data",
                "dataModel",
                "set!",
                "a2ui",
                "createSurface",
                "updateComponents",
            )
        ]
        all_comp_ids = {c["id"] for c in components}
        for comp in components:
            if "weight" in comp and isinstance(comp["weight"], str):
                try:
                    comp["weight"] = (
                        float(comp["weight"])
                        if "." in comp["weight"]
                        else int(comp["weight"])
                    )
                except ValueError:
                    del comp["weight"]
            if "children" in comp and isinstance(comp["children"], list):
                comp["children"] = [
                    cid
                    for cid in comp["children"]
                    if cid in all_comp_ids
                    or (isinstance(cid, str) and re.match(r"^[a-zA-Z0-9_-]+$", cid))
                ]
            if "child" in comp and isinstance(comp["child"], str):
                if comp["child"] not in all_comp_ids and not re.match(
                    r"^[a-zA-Z0-9_-]+$", comp["child"]
                ):
                    del comp["child"]

        if not components and data_model:
            return {
                "version": "v1.0",
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "path": "/",
                    "value": data_model,
                },
            }

        return {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": getattr(self.catalog, "id", "basic"),
                "components": components,
                "dataModel": data_model,
            },
        }

    def _clean_data_value(self, val: Any) -> Any:
        if isinstance(val, list):
            if not val:
                return []
            clean_list = []
            for item in val:
                if (
                    isinstance(item, list)
                    and item
                    and self._is_component_type(str(item[0]))
                ):
                    break
                clean_list.append(item)
            val = clean_list
            if not val:
                return []
            is_kv_list = (
                len(val) >= 2
                and len(val) % 2 == 0
                and all(
                    isinstance(val[k], str)
                    and not self._is_component_type(val[k])
                    and val[k]
                    not in ("data", "dataModel", "set!", "template", "a2ui", "Event")
                    for k in range(0, len(val), 2)
                )
            )
            is_pair_list = len(val) >= 1 and all(
                isinstance(item, (list, tuple))
                and len(item) == 2
                and isinstance(item[0], str)
                and not self._is_component_type(item[0])
                for item in val
            )

            if is_kv_list:
                res = {}
                i = 0
                while i < len(val) - 1:
                    key_item = val[i]
                    if isinstance(key_item, (list, tuple)) or (
                        isinstance(key_item, str) and self._is_component_type(key_item)
                    ):
                        break
                    key = str(key_item).lstrip(":")
                    res[key] = self._clean_data_value(val[i + 1])
                    i += 2
                return res
            elif is_pair_list:
                res = {}
                for item in val:
                    key = str(item[0]).lstrip(":")
                    res[key] = self._clean_data_value(item[1])
                return res

            return [self._clean_data_value(item) for item in val]
        if isinstance(val, str):
            return val
        return val

    def _extract_and_remove_embedded_components(
        self, node: Any, expr: List[Any]
    ) -> bool:
        """Extracts component expressions embedded within data nodes into main AST expr list."""
        if isinstance(node, list) and node:
            if self._is_component_type(str(node[0])):
                expr.append(node)
                return True
            to_remove = [
                sub
                for sub in node
                if self._extract_and_remove_embedded_components(sub, expr)
            ]
            for sub in to_remove:
                node.remove(sub)
        return False

    def _parse_data_node(self, expr: List[Any], data_model: Dict[str, Any]) -> None:
        """Parses (data $/path/key val ...) into data_model structure."""
        head = str(expr[0])
        pairs = []
        if head == "data":
            i = 1
            while i < len(expr) - 1:
                pairs.append((str(expr[i]), expr[i + 1]))
                i += 2
        elif head == "set!" and len(expr) >= 3:
            pairs.append((str(expr[1]), expr[2]))

        for k, v in pairs:
            if isinstance(k, (list, tuple)) or (
                isinstance(k, str) and self._is_component_type(k)
            ):
                break
            if (
                isinstance(v, list)
                and v
                and (isinstance(v[0], list) or self._is_component_type(str(v[0])))
            ):
                if isinstance(v[0], list) and self._is_component_type(str(v[0][0])):
                    break
            clean_path = (
                k[2:] if k.startswith("$/") else (k[1:] if k.startswith("$") else k)
            )
            clean_path = clean_path.lstrip("/")
            if not clean_path:
                continue
            parts = clean_path.split("/")
            curr = data_model
            for p in parts[:-1]:
                if p not in curr or not isinstance(curr[p], dict):
                    curr[p] = {}
                curr = curr[p]
            curr[parts[-1]] = self._clean_data_value(v)

    def _normalize_path_str(self, val: Any) -> str:
        if isinstance(val, dict) and "path" in val:
            val = val["path"]
        if isinstance(val, str):
            if "/item/" in val:
                val = "item/" + val.split("/item/", 1)[1]
            elif val.startswith("/item/"):
                val = val[1:]
            if val.startswith("$/"):
                return val[1:]
            elif val.startswith("$"):
                return (
                    val[1:]
                    if val.startswith("$/")
                    else ("/" + val[1:] if not val[1:].startswith("/") else val[1:])
                )
            elif not val.startswith("/") and not val.startswith("item/"):
                return "/" + val
            return val
        return "/items"

    def _compile_component(
        self,
        expr: List[Any],
        components: List[Dict[str, Any]],
        data_model: Optional[Dict[str, Any]] = None,
        is_root: bool = False,
    ) -> str:
        """Recursively processes S-expression component nodes into flat JSON adjacency list."""
        if data_model is None:
            data_model = {}
        comp_type = str(expr[0]).strip("`").strip("'")
        if comp_type in ("data", "dataModel", "set!"):
            self._parse_data_node(expr, data_model)
            return ""
        comp_id = (
            "root"
            if is_root and not any(c.get("id") == "root" for c in components)
            else self._next_id()
        )
        comp_dict: Dict[str, Any] = {"id": comp_id, "component": comp_type}

        children: List[str] = []
        i = 1
        pos_arg_index = 0
        comp_props = self.schema_helper.get_component_properties(comp_type)
        standard_a2ui_components = (
            "List",
            "ListView",
            "Grid",
            "Column",
            "Row",
            "Card",
            "Text",
            "TextField",
            "Button",
            "ChoicePicker",
            "RadioButtons",
            "CheckBoxGroup",
            "Image",
            "Icon",
            "Divider",
            "Tabs",
            "Modal",
            "Slider",
            "Switch",
            "Dropdown",
            "Video",
        )
        available = self.schema_helper.get_available_components()
        if (
            not comp_props
            and comp_type not in standard_a2ui_components
            and comp_type not in available
        ):
            cat_id = getattr(
                self.catalog, "id", getattr(self.catalog, "catalog_id", "basic")
            )
            raise ValueError(
                f"Unknown component type '{comp_type}' is not defined in catalog"
                f" '{cat_id}'. Available components in catalog are: {available}. Please"
                f" replace '{comp_type}' with a valid component from the catalog"
                " schema."
            )

        if isinstance(comp_props, dict):
            prop_keys = [k for k in comp_props.keys() if k not in ("id", "component")]
        elif isinstance(comp_props, (list, tuple)):
            prop_keys = [k for k in comp_props if k not in ("id", "component")]
        else:
            prop_keys = []

        child_list_prop = self.schema_helper.get_child_list_property(comp_type)
        items_path_var = None
        template_data = None

        while i < len(expr):
            item = expr[i]
            if isinstance(item, list) and item:
                # Lossless AST simplification: auto-omit/unwrap default key wrappers on container nodes
                if (
                    isinstance(item[0], str)
                    and item[0].startswith(":")
                    and len(item) > 1
                ):
                    wrapper_key = item[0][1:]
                    if wrapper_key in (
                        "children",
                        "child",
                        "content",
                        "items",
                        child_list_prop,
                    ) or self.schema_helper.get_property_type(
                        comp_type, wrapper_key
                    ) in (
                        "ChildList",
                        "Child",
                    ):
                        wrapper_contents = item[1:]
                        if (
                            len(wrapper_contents) == 1
                            and isinstance(wrapper_contents[0], list)
                            and wrapper_contents[0]
                            and not self._is_component_type(str(wrapper_contents[0][0]))
                        ):
                            wrapper_contents = wrapper_contents[0]
                        for sub_w in wrapper_contents:
                            if isinstance(sub_w, list) and sub_w:
                                if self._is_component_type(str(sub_w[0])):
                                    child_id = self._compile_component(
                                        sub_w, components, data_model
                                    )
                                    children.append(child_id)
                                elif str(sub_w[0]) == "template":
                                    template_data = self._compile_template(
                                        sub_w, components
                                    )
                            elif isinstance(sub_w, str) and sub_w not in (
                                "]",
                                ")",
                                "[",
                                "(",
                            ):
                                children.append(
                                    self._auto_wrap_text_child(
                                        sub_w, components, data_model
                                    )
                                )
                        i += 1
                        continue
                if str(item[0]) in ("data", "dataModel", "set!"):
                    self._extract_and_remove_embedded_components(item, expr)
                    self._parse_data_node(item, data_model)
                    i += 1
                    continue
            if isinstance(item, str) and item.startswith(":"):
                # Tagged keyword attribute :key val
                key = item[1:]
                val = expr[i + 1] if i + 1 < len(expr) else None
                if (
                    key in ("items", "dataset", "source", "path")
                    and key not in prop_keys
                ):
                    items_path_var = self._resolve_val(val, components)
                elif (
                    key == "children"
                    or key == child_list_prop
                    or self.schema_helper.get_property_type(comp_type, key)
                    == "ChildList"
                ) and isinstance(val, list):
                    if val and str(val[0]) == "template":
                        template_data = self._compile_template(val, components)
                    else:
                        for child_item in val:
                            if isinstance(child_item, list):
                                if child_item and str(child_item[0]) == "template":
                                    template_data = self._compile_template(
                                        child_item, components
                                    )
                                else:
                                    child_id = self._compile_component(
                                        child_item, components, data_model
                                    )
                                    children.append(child_id)
                            elif isinstance(child_item, str) and child_item not in (
                                "]",
                                ")",
                                "[",
                                "(",
                            ):
                                children.append(
                                    self._auto_wrap_text_child(
                                        child_item, components, data_model
                                    )
                                )
                elif (
                    (
                        self.schema_helper.get_property_type(comp_type, key)
                        in ("Child", "ComponentId")
                        or key
                        in (
                            "child",
                            "trigger",
                            "content",
                            "header",
                            "footer",
                            "leading",
                            "trailing",
                        )
                    )
                    and isinstance(val, list)
                    and val
                    and self._is_component_type(str(val[0]))
                ):
                    child_id = self._compile_component(val, components, data_model)
                    comp_dict[key] = child_id
                elif key == "tabs" and isinstance(val, list):
                    comp_dict["tabs"] = self._compile_tabs(val, components, data_model)
                elif key in ("template", "itemTemplate") and isinstance(val, list):
                    if val and str(val[0]) == "template":
                        template_data = self._compile_template(val, components)
                    else:
                        child_id = self._compile_component(val, components, data_model)
                        template_data = {"componentId": child_id}
                else:
                    resolved_v = self._resolve_val(val, components)
                    if (
                        key in ("items", "options")
                        and isinstance(resolved_v, dict)
                        and "path" in resolved_v
                    ):
                        p_str = resolved_v["path"]
                        extracted = self._extract_data_list(data_model, p_str)
                        if extracted:
                            norm_items = [
                                {
                                    "label": str(
                                        x.get("label", x) if isinstance(x, dict) else x
                                    ),
                                    "value": str(
                                        x.get("value", x) if isinstance(x, dict) else x
                                    ),
                                }
                                for x in extracted
                            ]
                        else:
                            norm_items = [{"label": "Option 1", "value": "option_1"}]
                        target_k = (
                            "items"
                            if ("items" in prop_keys or "options" not in prop_keys)
                            else key
                        )
                        comp_dict[target_k] = norm_items
                    elif (
                        key in ("items", "options")
                        and isinstance(resolved_v, list)
                        and resolved_v
                        and not (
                            isinstance(resolved_v[0], dict)
                            and "componentId" in resolved_v[0]
                        )
                    ):
                        norm_items = []
                        for it in resolved_v:
                            if isinstance(it, str):
                                norm_items.append({"label": it, "value": it})
                            elif isinstance(it, dict):
                                norm_items.append(it)
                            else:
                                norm_items.append({"label": str(it), "value": str(it)})
                        target_k = (
                            "items"
                            if ("items" in prop_keys or "options" not in prop_keys)
                            else key
                        )
                        comp_dict[target_k] = norm_items
                    elif key == "variant" and comp_type in (
                        "ChoicePicker",
                        "RadioButtons",
                        "CheckBoxGroup",
                    ):
                        v_str = str(resolved_v)
                        if v_str in (
                            "checkbox",
                            "checkboxes",
                            "multipleChoice",
                            "multipleSelection",
                        ):
                            v_str = "multipleSelection"
                        elif v_str in (
                            "radio",
                            "radioButtons",
                            "singleSelect",
                            "mutuallyExclusive",
                        ):
                            v_str = "mutuallyExclusive"
                        comp_dict["variant"] = v_str
                    elif key == "checks":
                        checks_list = (
                            resolved_v if isinstance(resolved_v, list) else [resolved_v]
                        )
                        norm_checks = []
                        for chk in checks_list:
                            if isinstance(chk, dict):
                                if "condition" not in chk:
                                    msg = chk.pop("message", "Invalid input")
                                    norm_checks.append(
                                        {"condition": chk, "message": str(msg)}
                                    )
                                else:
                                    if "message" not in chk:
                                        chk["message"] = "Invalid input"
                                    norm_checks.append(chk)
                        for chk in norm_checks:
                            cond = chk.get("condition")
                            if isinstance(cond, dict) and cond.get("call") == "regex":
                                args = cond.setdefault("args", {})
                                if "value" not in args and "value" in comp_dict:
                                    args["value"] = comp_dict["value"]
                        comp_dict["checks"] = norm_checks
                    else:
                        comp_dict[key] = resolved_v
                i += 2
            elif isinstance(item, list):
                # Nested child component or expression
                if item and str(item[0]) in ("data", "set!"):
                    self._parse_data_node(item, data_model)
                elif item and str(item[0]) == "Event":
                    # Inline (Event "action_name")
                    comp_dict["action"] = self._compile_event(item)
                elif item and str(item[0]) == "template":
                    # Inline template
                    template_data = self._compile_template(item, components)
                elif item and self._is_component_type(str(item[0])):
                    child_id = self._compile_component(item, components, data_model)
                    children.append(child_id)
                else:
                    # Flatten list of child component IDs, templates, or primitives
                    for sub_c in item:
                        if isinstance(sub_c, list) and sub_c:
                            if str(sub_c[0]) in ("data", "dataModel", "set!"):
                                self._parse_data_node(sub_c, data_model)
                            elif str(sub_c[0]) == "template":
                                template_data = self._compile_template(
                                    sub_c, components
                                )
                            elif self._is_component_type(str(sub_c[0])):
                                child_id = self._compile_component(
                                    sub_c, components, data_model
                                )
                                children.append(child_id)
                        elif (
                            isinstance(sub_c, str)
                            and sub_c not in ("]", ")", "[", "(")
                            and sub_c != "..."
                        ):
                            children.append(
                                self._auto_wrap_text_child(
                                    sub_c, components, data_model
                                )
                            )
                i += 1
            else:
                # Positional attribute matching schema definition order
                single_child_p = self.schema_helper.get_single_child_property(comp_type)
                if (
                    child_list_prop
                    or single_child_p
                    or self.schema_helper.get_property_type(comp_type, "children")
                    == "ChildList"
                    or "children" in prop_keys
                    or "child" in prop_keys
                ):
                    if (
                        isinstance(item, str)
                        and item not in ("]", ")", "[", "(")
                        and item != "..."
                    ):
                        children.append(
                            self._auto_wrap_text_child(item, components, data_model)
                        )
                else:
                    if pos_arg_index < len(prop_keys):
                        pkey = prop_keys[pos_arg_index]
                        comp_dict[pkey] = self._resolve_val(item, components)
                        pos_arg_index += 1
                i += 1

        target_child_list_key = child_list_prop or (
            "children" if "children" in prop_keys else None
        )

        if template_data:
            tmpl_child_id = template_data.get("componentId", "")
            raw_path = template_data.get("items_path") or items_path_var
            if not raw_path:
                for k, v in data_model.items():
                    if isinstance(v, list):
                        raw_path = f"/{k}"
                        break
            norm_path = self._normalize_path_str(raw_path)
            tmpl_obj = {"componentId": tmpl_child_id, "path": norm_path}

            comp_dict[target_child_list_key or "children"] = tmpl_obj
            if "template" in prop_keys or comp_type in ("List", "ListView", "Grid"):
                comp_dict["template"] = tmpl_obj
            if "items" not in comp_dict and "items" not in prop_keys:
                comp_dict["items"] = {"path": norm_path}
        elif children:
            single_child_prop = self.schema_helper.get_single_child_property(comp_type)
            if len(children) == 1 and single_child_prop and "children" not in prop_keys:
                comp_dict[single_child_prop] = children[0]
            elif target_child_list_key:
                comp_dict[target_child_list_key] = children
            elif len(children) == 1 and single_child_prop:
                comp_dict[single_child_prop] = children[0]
            else:
                comp_dict["children"] = children

        for slot_k in (
            "child",
            "content",
            "trigger",
            "header",
            "footer",
            "leading",
            "trailing",
        ):
            if slot_k in comp_dict and isinstance(comp_dict[slot_k], list):
                if len(comp_dict[slot_k]) == 1:
                    comp_dict[slot_k] = comp_dict[slot_k][0]
                elif not comp_dict[slot_k]:
                    del comp_dict[slot_k]

        if prop_keys:
            for invalid_k in (
                "items",
                "template",
                "displayStyle",
                "options",
                "center",
                "zoom",
                "pins",
                "latitude",
                "longitude",
            ):
                if invalid_k in comp_dict and invalid_k not in prop_keys:
                    del comp_dict[invalid_k]

        # Strict schema validation: required properties and enum constraints
        if hasattr(self.schema_helper, "get_component_required"):
            req_props = self.schema_helper.get_component_required(comp_type)
            for req in req_props:
                if req not in ("id", "component") and req not in comp_dict:
                    if req == "children" and "template" in comp_dict:
                        continue
                    raise ValueError(
                        f"Component '{comp_type}' (id: '{comp_id}') is missing required"
                        f" property '{req}' defined by catalog schema."
                    )

        if hasattr(self.schema_helper, "_helper") and self.schema_helper._helper:
            for p_name, p_val in list(comp_dict.items()):
                if p_name in ("id", "component", "children", "child"):
                    continue
                enum_vals = self.schema_helper._helper.get_property_enum(
                    comp_type, p_name
                )
                if enum_vals and isinstance(p_val, str) and p_val not in enum_vals:
                    if p_val == "radio" and "mutuallyExclusive" in enum_vals:
                        comp_dict[p_name] = "mutuallyExclusive"
                    elif p_val == "checkbox" and "multipleChoice" in enum_vals:
                        comp_dict[p_name] = "multipleChoice"
                    else:
                        comp_dict[p_name] = (
                            "body"
                            if (comp_type == "Text" and "body" in enum_vals)
                            else enum_vals[0]
                        )

        components.insert(0, comp_dict)
        return comp_id

    def _resolve_val(self, val: Any, components: List[Dict[str, Any]]) -> Any:
        """Resolves primitive values, dynamic bindings, and helper expressions."""
        if isinstance(val, dict):
            if "functionCall" in val and isinstance(val["functionCall"], dict):
                val = val["functionCall"]
            return {k: self._resolve_val(v, components) for k, v in val.items()}
        if isinstance(val, list) and val:
            if isinstance(val[0], str) and val[0] in ("openUrl", "callFunction"):
                fn_name = val[0]
                fn_args = {}
                if (
                    len(val) == 2
                    and isinstance(val[1], str)
                    and not val[1].startswith(":")
                ):
                    k = "url" if fn_name == "openUrl" else "function"
                    fn_args[k] = self._resolve_val(val[1], components)
                else:
                    i = 1
                    while i < len(val):
                        item = val[i]
                        if (
                            isinstance(item, str)
                            and item.startswith(":")
                            and i + 1 < len(val)
                        ):
                            k = item.lstrip(":")
                            if k in ("0", "arg_0") and fn_name == "openUrl":
                                k = "url"
                            fn_args[k] = self._resolve_val(val[i + 1], components)
                            i += 2
                        elif not (isinstance(item, str) and item.startswith(":")):
                            k = (
                                "url"
                                if (fn_name == "openUrl" and "url" not in fn_args)
                                else f"arg_{i-1}"
                            )
                            fn_args[k] = self._resolve_val(item, components)
                            i += 1
                        else:
                            i += 1
                return {"functionCall": {"call": fn_name, "args": fn_args}}
            if isinstance(val[0], str) and val[0].lower() == "event" and len(val) >= 2:
                evt_name = str(val[1]).strip("'\"")
                evt_ctx = {}
                i = 2
                pos_idx = 0
                while i < len(val):
                    item = val[i]
                    if isinstance(item, str) and item.startswith(":") and len(item) > 1:
                        k_name = item[1:]
                        if i + 1 < len(val):
                            v_val = self._resolve_val(val[i + 1], components)
                            if k_name in ("val", "data") and "value" not in evt_ctx:
                                k_name = "value"
                            if k_name not in ("name", "action") or v_val != evt_name:
                                evt_ctx[k_name] = v_val
                            i += 2
                        else:
                            i += 1
                    else:
                        param_k = "value" if pos_idx == 0 else f"arg_{pos_idx}"
                        evt_ctx[param_k] = self._resolve_val(item, components)
                        pos_idx += 1
                        i += 1
                return {
                    "event": (
                        {"name": evt_name, "context": evt_ctx}
                        if evt_ctx
                        else {"name": evt_name}
                    )
                }
            if isinstance(val[0], str) and val[0] in (
                "required",
                "regex",
                "not",
                "and",
                "or",
                "equal",
                "greaterThan",
                "lessThan",
                "pluralize",
                "formatDate",
                "formatCurrency",
                "formatString",
            ):
                fn_name = val[0]
                fn_args = {}
                pos = 0
                i = 1
                while i < len(val):
                    item = val[i]
                    if isinstance(item, str) and item.startswith(":") and len(item) > 1:
                        if i + 1 < len(val):
                            fn_args[item[1:]] = self._resolve_val(
                                val[i + 1], components
                            )
                            i += 2
                        else:
                            i += 1
                    else:
                        arg_key = (
                            "value"
                            if (
                                pos == 0
                                and fn_name
                                in (
                                    "required",
                                    "regex",
                                    "formatString",
                                    "formatDate",
                                    "formatCurrency",
                                    "not",
                                )
                            )
                            else f"arg_{pos}"
                        )
                        fn_args[arg_key] = self._resolve_val(item, components)
                        pos += 1
                        i += 1
                return {"call": fn_name, "args": fn_args}
            return [self._resolve_val(item, components) for item in val]
        if isinstance(val, str):
            if val.startswith("$/"):
                path_str = val[1:]
            elif val.startswith("$") and len(val) > 1 and val[1].isalpha():
                path_str = "/" + val[1:]
            elif (
                val.startswith("/")
                and not val.startswith("//")
                and len(val) > 1
                and val[1].isalpha()
            ):
                path_str = val
            elif val.startswith("item/") or (
                not val.startswith("http://")
                and not val.startswith("https://")
                and not val.startswith("file://")
                and "/" in val
                and " " not in val
                and val.split("/")[0].isidentifier()
            ):
                path_str = "/" + val if not val.startswith("/") else val
            else:
                path_str = None

            if path_str:
                if "/item/" in path_str:
                    path_str = "item/" + path_str.split("/item/", 1)[1]
                elif path_str.startswith("/item/"):
                    path_str = path_str[1:]
                return {"path": path_str}
        return val

    def _compile_event(self, expr: List[Any]) -> Dict[str, Any]:
        event_name = ""
        if len(expr) > 1 and not str(expr[1]).startswith(":"):
            event_name = str(expr[1]).strip("`").strip("'")
        else:
            for idx in range(1, len(expr) - 1):
                if str(expr[idx]) in (":name", ":action", ":event") and idx + 1 < len(
                    expr
                ):
                    event_name = str(expr[idx + 1]).strip("`").strip("'")
                    break
        context = {}
        i = 2
        pos_idx = 0
        while i < len(expr):
            item = expr[i]
            if isinstance(item, str) and item.startswith(":") and len(item) > 1:
                k = item[1:]
                if i + 1 < len(expr):
                    v = expr[i + 1]
                    if k == "context":
                        if isinstance(v, dict):
                            for sub_k, sub_v in v.items():
                                context[sub_k] = sub_v
                        elif isinstance(v, list):
                            j = 0
                            while j < len(v) - 1:
                                if isinstance(v[j], str) and v[j].startswith(":"):
                                    context[v[j][1:]] = v[j + 1]
                                    j += 2
                                else:
                                    j += 1
                        else:
                            context["value"] = v
                    elif k not in ("name", "action"):
                        context[k] = v
                    i += 2
                else:
                    i += 1
            elif isinstance(item, dict):
                for k, v in item.items():
                    if k not in ("name", "action"):
                        context[k] = v
                i += 1
            else:
                if (
                    isinstance(item, str)
                    and not item.startswith(":")
                    and item not in ("]", ")", "[", "(")
                ):
                    if pos_idx == 0:
                        context["id"] = item
                    pos_idx += 1
                i += 1
        ev_obj: Dict[str, Any] = {"name": event_name}
        resolved_context = (
            {k: self._resolve_val(v, []) for k, v in context.items()} if context else {}
        )
        if resolved_context:
            ev_obj["context"] = resolved_context
        return {"event": ev_obj}

    def _compile_template(
        self, expr: List[Any], components: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        template_child_id = ""
        items_path = None
        item_var = None
        i = 1
        while i < len(expr):
            item = expr[i]
            if isinstance(item, str) and item.startswith(":") and i + 1 < len(expr):
                if item in (":items", ":dataset", ":data", ":source", ":path"):
                    items_path = self._resolve_val(expr[i + 1], components)
                elif item in (":item", ":var", ":itemVar"):
                    item_var = str(expr[i + 1]).lstrip("$").strip("/")
                i += 2
            elif isinstance(item, list):
                template_child_id = self._compile_component(item, components)
                i += 1
            elif (
                isinstance(item, str)
                and item not in ("]", ")", "[", "(")
                and not item.startswith(":")
            ):
                item_var = item.lstrip("$").strip("/")
                i += 1
            else:
                i += 1

        if item_var and item_var != "item":
            for c in components:
                for k, v in list(c.items()):
                    if (
                        isinstance(v, dict)
                        and "path" in v
                        and isinstance(v["path"], str)
                    ):
                        p = v["path"]
                        if (
                            f"/{item_var}/" in p
                            or p.startswith(f"{item_var}/")
                            or p.startswith(f"/{item_var}/")
                        ):
                            sub_path = p.split(f"{item_var}/", 1)[-1]
                            v["path"] = f"item/{sub_path}"

        res: Dict[str, Any] = {"componentId": template_child_id}
        if items_path:
            res["items_path"] = items_path
        return res

    def _compile_tabs(
        self,
        val: List[Any],
        components: List[Dict[str, Any]],
        data_model: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        tabs_list = []
        for item in val:
            if isinstance(item, list):
                title = ""
                child_id = ""
                i = 0
                if (
                    item
                    and isinstance(item[0], str)
                    and item[0].lower() in ("tab", "item")
                ):
                    i = 1
                while i < len(item):
                    elem = item[i]
                    if isinstance(elem, str) and elem.startswith(":"):
                        k = elem[1:]
                        v = item[i + 1] if i + 1 < len(item) else None
                        if k in ("title", "label") and isinstance(v, str):
                            title = v
                        elif k in ("content", "child", "component") and isinstance(
                            v, list
                        ):
                            child_id = self._compile_component(
                                v, components, data_model
                            )
                        i += 2
                    elif isinstance(elem, str):
                        if elem not in ("Tab", "tab", "child", "content", "item"):
                            title = elem
                        i += 1
                    elif isinstance(elem, list):
                        child_id = self._compile_component(elem, components, data_model)
                        i += 1
                    else:
                        i += 1
                if title or child_id:
                    tab_obj = {"title": title}
                    if child_id:
                        tab_obj["child"] = child_id
                    tabs_list.append(tab_obj)
        return tabs_list

    def _schema_expects_single_child(self, comp_type: str) -> bool:
        props = self.schema_helper.get_component_properties(comp_type)
        return "child" in props and "children" not in props
