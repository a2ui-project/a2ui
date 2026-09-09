# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Compilation engine and permissive parser for A2UI Vertical inference format.

Parses plain-text component instantiations into structured A2UI messages.
Supports single-component instantiation and vertical sequences of components,
permissively healing syntax variations (missing parens, quotes, colon vs equals,
variable assignments, JSX, JSON).
"""

import json
import re
from typing import Any, Dict, List, Optional, Tuple, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.schema_helper import CatalogSchemaHelper


def _strip_markdown_and_tags(text: str) -> str:
    """Removes enclosing sentinel tags and markdown code blocks."""
    if not text:
        return ""
    text = text.strip()

    # Remove enclosing sentinel tags if present
    text = re.sub(r"<\/?(?:a2ui|a2ui-vertical)\b[^>]*>", "", text, flags=re.IGNORECASE)

    # Remove markdown code fences (including indented ones and languages like a2ui)
    text = re.sub(r"^\s*```\S*[ \t]*\r?\n?", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*```[ \t]*\r?\n?", "", text, flags=re.MULTILINE)
    return text.strip()


def _is_legacy_version(target_version: str) -> bool:
    """Returns True if the protocol version is legacy (< v1.0)."""
    try:
        clean = target_version.lstrip("v")
        major = int(clean.split(".", 1)[0])
        return major < 1
    except (ValueError, AttributeError):
        return False


def _split_statements(text: str) -> List[str]:
    """Splits input text into discrete component statements.

    Correctly balances parentheses, brackets, braces, and quotes so newlines
    or commas inside values are not treated as statement boundaries.
    """
    statements: List[str] = []
    current: List[str] = []
    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    in_quote: Optional[str] = None
    escape = False

    i = 0
    n = len(text)
    while i < n:
        ch = text[i]

        if escape:
            current.append(ch)
            escape = False
            i += 1
            continue

        if ch == "\\" and in_quote:
            escape = True
            current.append(ch)
            i += 1
            continue

        if ch == "\n":
            in_quote = None

        if in_quote:
            if ch == in_quote:
                in_quote = None
            current.append(ch)
            i += 1
            continue

        if ch in ('"', "'"):
            in_quote = ch
            current.append(ch)
            i += 1
            continue

        # Comment handling at depth 0
        if (
            ch in ("#", ";")
            and paren_depth == 0
            and bracket_depth == 0
            and brace_depth == 0
        ):
            while i < n and text[i] != "\n":
                i += 1
            continue
        if (
            ch == "/"
            and i + 1 < n
            and text[i + 1] == "/"
            and paren_depth == 0
            and bracket_depth == 0
            and brace_depth == 0
        ):
            while i < n and text[i] != "\n":
                i += 1
            continue

        if ch == "(":
            paren_depth += 1
            current.append(ch)
            i += 1
            continue
        elif ch == ")":
            if paren_depth > 0:
                paren_depth -= 1
            current.append(ch)
            i += 1
            continue
        elif ch == "[":
            bracket_depth += 1
            current.append(ch)
            i += 1
            continue
        elif ch == "]":
            if bracket_depth > 0:
                bracket_depth -= 1
            current.append(ch)
            i += 1
            continue
        elif ch == "{":
            brace_depth += 1
            current.append(ch)
            i += 1
            continue
        elif ch == "}":
            if brace_depth > 0:
                brace_depth -= 1
            current.append(ch)
            i += 1
            continue

        # Statement separators at depth 0
        if paren_depth == 0 and bracket_depth == 0 and brace_depth == 0:
            if ch in ("\n", ";"):
                stmt = "".join(current).strip()
                if stmt:
                    statements.append(stmt)
                current = []
                i += 1
                continue
        elif ch == "\n":
            # Permissive healing: If an unclosed statement is followed by a new
            # component statement on the next line, split and reset depth.
            rest = text[i + 1 :].lstrip(" \t\r\n")
            if (
                re.match(r"^[A-Z][A-Za-z0-9_]*\s*\(", rest)
                or re.match(r"^<[A-Za-z0-9_]+", rest)
                or re.match(
                    r"^(?:(?:var|val|let|\$[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*[:=]\s*)?[A-Z][A-Za-z0-9_]*\s*\(",
                    rest,
                )
            ):
                stmt = "".join(current).strip()
                if stmt:
                    statements.append(stmt)
                current = []
                paren_depth = 0
                bracket_depth = 0
                brace_depth = 0
                in_quote = None
                i += 1
                continue

        current.append(ch)
        i += 1

    stmt = "".join(current).strip()
    if stmt:
        statements.append(stmt)

    return statements


def _split_args(args_str: str) -> List[str]:
    """Splits argument string into comma-separated argument chunks at depth 0."""
    chunks: List[str] = []
    current: List[str] = []
    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    in_quote: Optional[str] = None
    escape = False

    i = 0
    n = len(args_str)
    while i < n:
        ch = args_str[i]

        if escape:
            current.append(ch)
            escape = False
            i += 1
            continue

        if ch == "\\" and in_quote:
            escape = True
            current.append(ch)
            i += 1
            continue

        if ch == "\n":
            in_quote = None

        if in_quote:
            if ch == in_quote:
                in_quote = None
            current.append(ch)
            i += 1
            continue

        if ch in ('"', "'"):
            in_quote = ch
            current.append(ch)
            i += 1
            continue

        if ch == "(":
            paren_depth += 1
        elif ch == ")":
            if paren_depth > 0:
                paren_depth -= 1
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]":
            if bracket_depth > 0:
                bracket_depth -= 1
        elif ch == "{":
            brace_depth += 1
        elif ch == "}":
            if brace_depth > 0:
                brace_depth -= 1

        if ch == "," and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0:
            chunk = "".join(current).strip()
            if chunk:
                chunks.append(chunk)
            current = []
            i += 1
            continue

        current.append(ch)
        i += 1

    chunk = "".join(current).strip()
    if chunk:
        chunks.append(chunk)
    return chunks


def _parse_value(val_str: str) -> Any:
    """Parses a single raw argument value string permissively."""
    val_str = val_str.strip()
    if not val_str:
        return ""

    # Quoted string
    if (val_str.startswith('"') and val_str.endswith('"')) or (
        val_str.startswith("'") and val_str.endswith("'")
    ):
        inner = val_str[1:-1]
        try:
            return inner.encode("utf-8").decode("unicode_escape")
        except Exception:
            return inner

    # Healing unclosed quotes
    if val_str.startswith('"') or val_str.startswith("'"):
        quote_char = val_str[0]
        inner = val_str[1:]
        if inner.endswith(quote_char):
            inner = inner[:-1]
        try:
            return inner.encode("utf-8").decode("unicode_escape")
        except Exception:
            return inner

    # Booleans
    if val_str.lower() in ("true", "t"):
        return True
    if val_str.lower() in ("false", "f"):
        return False

    # Null / None
    if val_str.lower() in ("null", "none", "nil"):
        return None

    # Numbers
    try:
        if "." in val_str:
            return float(val_str)
        return int(val_str)
    except ValueError:
        pass

    # Data binding: $/path/to/data or $path
    if val_str.startswith("$"):
        path = val_str[1:]
        if not path.startswith("/"):
            path = "/" + path
        return {"path": path}

    # Action / Event helper call: Event("name", key="val") or action("name")
    if re.match(r"^(?:Event|action)\s*\(", val_str, re.IGNORECASE):
        inner = val_str[val_str.find("(") + 1 :].strip()
        if inner.endswith(")"):
            inner = inner[:-1].strip()
        inner_args = _split_args(inner)
        event_name = ""
        context: Dict[str, Any] = {}
        for idx, arg_chunk in enumerate(inner_args):
            key, val = _parse_arg_chunk(arg_chunk)
            if key is not None:
                if key in ("name", "action", "event"):
                    event_name = str(val)
                else:
                    context[key] = val
            else:
                if idx == 0:
                    event_name = str(val)
                elif isinstance(val, dict):
                    context.update(val)
                else:
                    context[f"arg_{idx}"] = val
        return {"event": {"name": event_name, "context": context}}

    # List literal: [item1, item2]
    if val_str.startswith("["):
        inner = val_str[1:]
        if inner.endswith("]"):
            inner = inner[:-1]
        items = _split_args(inner)
        return [_parse_value(item) for item in items]

    # Map literal: {k: v, ...}
    if val_str.startswith("{"):
        inner = val_str[1:]
        if inner.endswith("}"):
            inner = inner[:-1]
        entries = _split_args(inner)
        res_dict: Dict[str, Any] = {}
        for entry in entries:
            k, v = _parse_arg_chunk(entry)
            if k is not None:
                res_dict[k] = v
        return res_dict

    # Function call: fn(arg1, arg2)
    fn_call_header = re.match(r"^([A-Za-z0-9_]+)\s*\(", val_str)
    if fn_call_header:
        fn_name = fn_call_header.group(1)
        inner = val_str[val_str.find("(") + 1 :].strip()
        if inner.endswith(")"):
            inner = inner[:-1].strip()
        inner_args = _split_args(inner)
        parsed_args = []
        parsed_kwargs = {}
        for arg_chunk in inner_args:
            k, v = _parse_arg_chunk(arg_chunk)
            if k is not None:
                parsed_kwargs[k] = v
            else:
                parsed_args.append(v)
        res_call: Dict[str, Any] = {"call": fn_name, "args": parsed_args}
        if parsed_kwargs:
            res_call["kwargs"] = parsed_kwargs
        return res_call

    # Fallback to unquoted string literal
    return val_str


def _parse_arg_chunk(chunk: str) -> Tuple[Optional[str], Any]:
    """Splits an argument chunk into (key, value) if named, or (None, value) if positional."""
    chunk = chunk.strip()
    if not chunk:
        return None, ""

    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    in_quote: Optional[str] = None
    escape = False

    separator_idx = -1
    for i, ch in enumerate(chunk):
        if escape:
            escape = False
            continue
        if ch == "\\" and in_quote:
            escape = True
            continue
        if in_quote:
            if ch == in_quote:
                in_quote = None
            continue
        if ch in ('"', "'"):
            in_quote = ch
            continue
        if ch in ("(", "[", "{"):
            if ch == "(":
                paren_depth += 1
            elif ch == "[":
                bracket_depth += 1
            elif ch == "{":
                brace_depth += 1
            continue
        if ch in (")", "]", "}"):
            if ch == ")" and paren_depth > 0:
                paren_depth -= 1
            elif ch == "]" and bracket_depth > 0:
                bracket_depth -= 1
            elif ch == "}" and brace_depth > 0:
                brace_depth -= 1
            continue

        if paren_depth == 0 and bracket_depth == 0 and brace_depth == 0:
            if i > 0 and ch in ("=", ":"):
                separator_idx = i
                break

    if separator_idx != -1:
        key_str = chunk[:separator_idx].strip()
        val_str = chunk[separator_idx + 1 :].strip()
        if (key_str.startswith('"') and key_str.endswith('"')) or (
            key_str.startswith("'") and key_str.endswith("'")
        ):
            key_str = key_str[1:-1]
        if key_str.startswith(":"):
            key_str = key_str[1:]
        val = _parse_value(val_str)
        return key_str, val

    if chunk.startswith(":"):
        parts = chunk[1:].split(None, 1)
        if len(parts) == 2:
            return parts[0].strip(), _parse_value(parts[1].strip())

    return None, _parse_value(chunk)


class VerticalCompiler:
    """Compiles A2UI Vertical plain-text component instantiations into A2UI messages.

    Attributes:
        catalog: Catalog or A2uiCatalog schema helper instance.
        surface_id: The default surface identifier.
        version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
    """

    def __init__(
        self,
        catalog: Union[Catalog[Any, Any], A2uiCatalog],
        surface_id: str = "main",
        version: str = "v1.0",
    ):
        """Initializes the compiler with a catalog and protocol version.

        Args:
            catalog: Catalog or A2uiCatalog instance.
            surface_id: Default surface ID for created surfaces.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
        """
        self.catalog = catalog
        self.surface_id = surface_id
        self.version = version
        if isinstance(catalog, CatalogSchemaHelper):
            self.helper = catalog
        elif isinstance(catalog, (Catalog, A2uiCatalog)):
            self.helper = CatalogSchemaHelper(catalog)
        elif hasattr(catalog, "get_components"):
            comps = catalog.get_components()
            fns = catalog.get_functions() if hasattr(catalog, "get_functions") else {}
            cid = getattr(
                catalog,
                "catalog_id",
                getattr(catalog, "id", "https://a2ui.org/mock"),
            )
            cat = Catalog.from_json(
                {"catalogId": cid, "components": comps, "functions": fns},
                spec_version="0.9.1",
            )
            self.helper = CatalogSchemaHelper(cat)
        else:
            self.helper = CatalogSchemaHelper(catalog)

    def _find_vertical_container(self) -> Optional[Tuple[str, str]]:
        """Finds an available vertical container component in the catalog that accepts children.

        Returns:
            Tuple of (component_name, child_property_name) or None if no container found.
        """
        candidates = ["Column", "List"]
        all_comps = list(self.helper.components.keys())

        for name in candidates + all_comps:
            if name not in self.helper.components:
                continue
            props = self.helper.get_component_properties(name)
            for p in props:
                p_type = self.helper.get_property_type(name, p)
                if p_type == "ChildList" or p == "children":
                    return name, p
        return None

    def _parse_statement_to_component(
        self, stmt: str
    ) -> Optional[Tuple[str, List[Any], Dict[str, Any]]]:
        """Parses a raw statement into (component_name, positional_args, keyword_args)."""
        stmt = stmt.strip()
        if not stmt:
            return None

        # 1. Check if the statement is raw JSON
        if stmt.startswith("{") or stmt.startswith("["):
            try:
                data = json.loads(stmt)
                if isinstance(data, dict) and "component" in data:
                    comp_name = data.get("component", "")
                    kwargs = {k: v for k, v in data.items() if k != "component"}
                    return comp_name, [], kwargs
                elif (
                    isinstance(data, list)
                    and data
                    and isinstance(data[0], dict)
                    and "component" in data[0]
                ):
                    comp_name = data[0].get("component", "")
                    kwargs = {k: v for k, v in data[0].items() if k != "component"}
                    return comp_name, [], kwargs
            except Exception:
                pass

        # 2. Check if the statement is JSX-style: <Text text="Hello" />
        jsx_match = re.match(
            r"^<([A-Za-z0-9_]+)\b([^>]*)(?:\/>|>(?:.*?<\/\1>)?)$",
            stmt,
            re.DOTALL | re.IGNORECASE,
        )
        if jsx_match:
            comp_name = jsx_match.group(1)
            attrs_str = jsx_match.group(2)
            attr_matches = re.findall(
                r'([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))',
                attrs_str,
            )
            kwargs = {}
            for k, val_d, val_s, val_raw in attr_matches:
                v = val_d or val_s or val_raw
                kwargs[k] = _parse_value(v)
            return comp_name, [], kwargs

        # 3. Strip variable assignment if present (e.g. root = Text(...) or $v1 = Text(...))
        stmt = re.sub(
            r"^(?:(?:var|val|let)\s+)?(?:\$[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*[:=]\s*",
            "",
            stmt,
        ).strip()

        # 4. Extract ComponentName(args...)
        call_match = re.match(r"^([A-Za-z0-9_]+)\s*(?:\((.*)\)?)?$", stmt, re.DOTALL)
        if not call_match:
            return None

        comp_name = call_match.group(1)
        args_raw = call_match.group(2) or ""
        if args_raw.endswith(")"):
            args_raw = args_raw[:-1]

        arg_chunks = _split_args(args_raw)
        pos_args: List[Any] = []
        kw_args: Dict[str, Any] = {}

        for chunk in arg_chunks:
            k, v = _parse_arg_chunk(chunk)
            if k is not None:
                kw_args[k] = v
            else:
                pos_args.append(v)

        return comp_name, pos_args, kw_args

    def _get_expected_primitive_type(
        self, schema: Optional[Dict[str, Any]]
    ) -> Optional[str]:
        """Resolves the expected primitive type (number, integer, boolean, string) from a schema."""
        if not isinstance(schema, dict):
            return None

        t = schema.get("type")
        if t in ("integer", "number", "boolean", "string"):
            return t

        ref = schema.get("$ref")
        if isinstance(ref, str):
            if "DynamicNumber" in ref or "Number" in ref:
                return "number"
            if "DynamicInteger" in ref or "Integer" in ref:
                return "integer"
            if "DynamicBoolean" in ref or "Boolean" in ref:
                return "boolean"
            if "DynamicString" in ref or "String" in ref:
                return "string"

        for k in ("anyOf", "oneOf", "allOf"):
            if k in schema and isinstance(schema[k], list):
                for sub in schema[k]:
                    sub_t = self._get_expected_primitive_type(sub)
                    if sub_t:
                        return sub_t
        return None

    def _coerce_property_value(self, comp_name: str, prop_name: str, val: Any) -> Any:
        """Coerces property value (actions, numbers, booleans) based on catalog schema."""
        p_type = (
            self.helper.get_property_type(comp_name, prop_name)
            if comp_name in self.helper.components
            else None
        )
        if (
            p_type == "Action" or prop_name in ("action", "onClick", "onPress")
        ) and isinstance(val, str):
            return {"event": {"name": val}}

        # Don't coerce data binding expressions
        if isinstance(val, str) and (val.startswith("$/") or val.startswith("$")):
            return val

        p_schema = (
            self.helper.get_property_schema(comp_name, prop_name)
            if comp_name in self.helper.components
            else None
        )
        expected_type = self._get_expected_primitive_type(p_schema)

        if expected_type in ("number", "integer"):
            if isinstance(val, str):
                try:
                    cleaned = val.strip()
                    if cleaned.endswith("%"):
                        cleaned = cleaned[:-1].strip()
                    if cleaned.startswith("+"):
                        cleaned = cleaned[1:].strip()
                    if expected_type == "integer":
                        return int(float(cleaned))
                    else:
                        if "." in cleaned or "e" in cleaned.lower():
                            return float(cleaned)
                        else:
                            return int(cleaned)
                except (ValueError, TypeError):
                    pass
            elif (
                isinstance(val, float)
                and expected_type == "integer"
                and val.is_integer()
            ):
                return int(val)
        elif expected_type == "boolean":
            if isinstance(val, str):
                cleaned = val.strip().lower()
                if cleaned in ("true", "1"):
                    return True
                elif cleaned in ("false", "0"):
                    return False

        return val

    def _resolve_component(
        self, comp_name: str, pos_args: List[Any], kw_args: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Resolves parsed args and kwargs into a valid A2UI component dictionary."""
        matched_name = comp_name
        if comp_name not in self.helper.components:
            for c in self.helper.components:
                if c.lower() == comp_name.lower():
                    matched_name = c
                    break

        comp_dict: Dict[str, Any] = {"component": matched_name}

        if matched_name in self.helper.components:
            ordered_props = [
                p
                for p in self.helper.get_component_properties(matched_name) or []
                if p not in ("component", "id", "child", "children")
            ]
        else:
            ordered_props = []

        for idx, arg_val in enumerate(pos_args):
            if idx < len(ordered_props):
                prop_name = ordered_props[idx]
                comp_dict[prop_name] = self._coerce_property_value(
                    matched_name, prop_name, arg_val
                )

        for k, v in kw_args.items():
            prop_target = k
            for p in ordered_props:
                if p.lower() == k.lower():
                    prop_target = p
                    break

            comp_dict[prop_target] = self._coerce_property_value(
                matched_name, prop_target, v
            )

        return comp_dict

    def compile(
        self,
        raw_text: str,
        surface_id: Optional[str] = None,
        catalog_id: str = "",
        is_final: bool = True,
        version: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Compiles raw Vertical format text into structured A2UI protocol messages.

        Args:
            raw_text: Raw plain-text response containing component constructors.
            surface_id: Target surface ID (defaults to self.surface_id).
            catalog_id: Catalog URI/ID (defaults to catalog ID from catalog schema).
            is_final: Whether this is the final compilation pass.
            version: Protocol version override ("v0.9", "v0.9.1", or "v1.0").

        Returns:
            List of compiled A2UI message dictionaries.
        """
        target_version = version or self.version
        resolved_surface_id = surface_id or self.surface_id
        resolved_catalog_id = (
            catalog_id
            or getattr(self.catalog, "id", "")
            or getattr(self.catalog, "catalog_id", "")
            or "https://a2ui.org/catalogs/basic.json"
        )

        clean_text = _strip_markdown_and_tags(raw_text)
        if not clean_text:
            return []

        surf_match = re.search(
            r"(?:surface|surfaceId)\s*\(?\s*['\"]([^'\"]+)['\"]\s*\)?",
            clean_text,
            re.IGNORECASE,
        )
        if surf_match:
            resolved_surface_id = surf_match.group(1)

        statements = _split_statements(clean_text)
        parsed_components: List[Dict[str, Any]] = []

        for stmt in statements:
            if re.match(r"^(?:surface|surfaceId)\s*\(?.*?\)?$", stmt, re.IGNORECASE):
                continue
            res = self._parse_statement_to_component(stmt)
            if res:
                comp_name, pos_args, kw_args = res
                comp_dict = self._resolve_component(comp_name, pos_args, kw_args)
                parsed_components.append(comp_dict)

        if not parsed_components:
            return []

        # Construct component messages: Surface per component
        messages: List[Dict[str, Any]] = []
        for i, comp in enumerate(parsed_components):
            surf_id = resolved_surface_id if i == 0 else f"{resolved_surface_id}_{i}"
            root_comp = {"id": "root", **comp}
            if _is_legacy_version(target_version):
                messages.append({
                    "version": target_version,
                    "createSurface": {
                        "surfaceId": surf_id,
                        "catalogId": resolved_catalog_id,
                    },
                })
                messages.append({
                    "version": target_version,
                    "updateComponents": {
                        "surfaceId": surf_id,
                        "components": [root_comp],
                    },
                })
            else:
                messages.append({
                    "version": target_version,
                    "createSurface": {
                        "surfaceId": surf_id,
                        "catalogId": resolved_catalog_id,
                        "components": [root_comp],
                    },
                })

        return messages
