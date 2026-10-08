# Copyright 2024 Google LLC
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
bindings and validation checks, and compiles it into A2UI message envelopes.

Catalog resolution:

- With a single catalog, every component and function call comes from it, and
  `createSurface` names it. A `<link rel="catalog">` may name it too.
- With several catalogs (A2UI v1.0 and later), `createSurface` names no
  catalog, so the surface has no default catalog and every compiled component
  and function call carries its own `catalogId`. A component or function the
  markup writes without `catalog-id` / `catalogId` is looked up by name across
  the catalogs; a name that several catalogs define must name its catalog.
  A `<link rel="catalog">` is an error, since there is no surface catalog.
"""

from collections.abc import Mapping, Sequence
from html.parser import HTMLParser
import json
import re
from typing import Any, Literal

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    check_dsl_catalogs,
    surface_catalog_id,
    to_message_models,
)
from a2ui.inference_formats.experimental.express.constants import SurfaceOperation

from .expression_parser import ElementalExpressionParser

TAG_PREFIX = "ui-"

# Attribute on `<body>` that marks the block as an update of an existing
# surface (`updateComponents` / `updateDataModel`) instead of a new surface.
UPDATE_ATTR = "update"

_JSON_SCRIPT_TYPE = "application/json"
_CATALOG_ID_ATTRS = ("catalog-id", "catalogid")
_STRUCTURAL_CONTAINER_TAGS = frozenset({"root", "body", "template"})
_VOID_TAGS = frozenset({
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
})


def _kebab_to_camel(name: str) -> str:
    parts = name.split("-")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _component_tag(comp_name: str) -> str:
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1-\2", comp_name)
    return TAG_PREFIX + re.sub("([a-z0-9])([A-Z])", r"\1-\2", s1).lower()


def _attr_catalog_id(attrs: Mapping[str, str | None]) -> str | None:
    for key in _CATALOG_ID_ATTRS:
        val = attrs.get(key)
        if val:
            return val
    return None


def _is_catalog_link(node: "Node") -> bool:
    return node.tag == "link" and node.attrs.get("rel") == "catalog"


def _is_json_script(node: "Node") -> bool:
    return node.tag == "script" and node.attrs.get("type") == _JSON_SCRIPT_TYPE


def _is_flag_set(attrs: Mapping[str, str | None], name: str) -> bool:
    if name not in attrs:
        return False
    val = attrs[name]
    return val is None or val.strip().lower() in ("", "true", "{true}")


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

    def __init__(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
        is_container: bool = True,
    ):
        self.tag = tag.lower()
        self.attrs: dict[str, Any] = dict(attrs)
        self.children: list[Node] = []
        self.text = ""
        self.is_container = is_container


class DomBuilder(HTMLParser):
    """A forgiving HTML parser that builds a simple DOM tree.

    A component element that cannot hold child components is closed
    automatically when the next component element starts. Whether a component
    can hold children is looked up in the catalog that its `catalog-id`
    attribute names, or else in the catalogs that define it.
    """

    def __init__(
        self,
        container_tags_by_catalog: Mapping[str, set[str]] | None = None,
    ):
        super().__init__()
        self.root: Node | None = None
        self.stack: list[Node] = []
        self.container_tags_by_catalog = dict(container_tags_by_catalog or {})
        # A tag without `catalog-id` is a container if a catalog that defines
        # it as a container exists. A tag that several catalogs define fails
        # compilation unless it names its catalog.
        self._unannotated_container_tags: set[str] = set().union(
            *self.container_tags_by_catalog.values()
        )

    def _new_node(self, tag: str, attrs: list[tuple[str, str | None]]) -> Node:
        tag_lower = tag.lower()
        if not tag_lower.startswith(TAG_PREFIX):
            return Node(tag_lower, attrs, is_container=True)
        cat_id = _attr_catalog_id(dict(attrs))
        container_tags = (
            self.container_tags_by_catalog.get(cat_id, set())
            if cat_id
            else self._unannotated_container_tags
        )
        return Node(tag_lower, attrs, is_container=tag_lower in container_tags)

    def _close_leaf_components(self) -> None:
        while (
            self.stack
            and self.stack[-1].tag.startswith(TAG_PREFIX)
            and not self.stack[-1].is_container
        ):
            self.stack.pop()

    def _attach(self, node: Node) -> None:
        if not self.root:
            self.root = node
        if self.stack:
            self.stack[-1].children.append(node)

    def handle_starttag(self, tag, attrs):
        node = self._new_node(tag, attrs)
        if node.tag.startswith(TAG_PREFIX):
            self._close_leaf_components()
        self._attach(node)
        # Do not push void elements to the stack since they do not have closing tags
        if node.tag not in _VOID_TAGS:
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
        node = self._new_node(tag, attrs)
        if node.tag.startswith(TAG_PREFIX):
            self._close_leaf_components()
        self._attach(node)

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


def _get_enum_values(schema: Any) -> list[Any] | None:
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


def _get_primitive_property_type(schema: Any) -> str | None:
    """Resolves primitive type or Dynamic* reference type from a property schema."""
    if not isinstance(schema, dict):
        return None
    if "type" in schema:
        if isinstance(schema["type"], str):
            return schema["type"]
        if isinstance(schema["type"], list):
            for t in schema["type"]:
                if isinstance(t, str) and t != "null":
                    return t
    if "$ref" in schema and isinstance(schema["$ref"], str):
        ref_lower = schema["$ref"].lower()
        if "dynamicboolean" in ref_lower or ref_lower.endswith("/boolean"):
            return "boolean"
        if "dynamicinteger" in ref_lower or ref_lower.endswith("/integer"):
            return "integer"
        if "dynamicnumber" in ref_lower or ref_lower.endswith("/number"):
            return "number"
        if "dynamicstring" in ref_lower or ref_lower.endswith("/string"):
            return "string"
    for key in ["oneOf", "anyOf", "allOf"]:
        if key in schema and isinstance(schema[key], list):
            for sub in schema[key]:
                res = _get_primitive_property_type(sub)
                if res:
                    return res
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


def _function_allows_extra_args(fn_schema: Any) -> bool:
    """Whether a function schema accepts arguments it does not declare.

    The arguments are closed when the `args` object schema, at the top level
    of the function schema or in one of its `allOf` parts, sets
    `additionalProperties` or `unevaluatedProperties` to false. A function
    without a schema is treated as open.
    """
    if not isinstance(fn_schema, dict):
        return True
    sub_schemas = [fn_schema, *fn_schema.get("allOf", [])]
    for sub in sub_schemas:
        if not isinstance(sub, dict) or not isinstance(sub.get("properties"), dict):
            continue
        args_schema = sub["properties"].get("args")
        if not isinstance(args_schema, dict):
            continue
        if (
            args_schema.get("additionalProperties") is False
            or args_schema.get("unevaluatedProperties") is False
        ):
            return False
    return True


class _CompileContext:
    """Holds mutable state during compilation."""

    def __init__(self):
        self.components: list[dict[str, Any]] = []
        self.auto_id_counter = 0

    def next_auto_id(self) -> str:
        self.auto_id_counter += 1
        return f"comp_{self.auto_id_counter}"


class ElementalCompiler:
    """Compilation pipeline for A2UI Elemental HTML."""

    def __init__(self, catalogs: Sequence[CatalogApi]):
        """Initializes the compiler.

        Args:
            catalogs: The catalogs to resolve components and functions against.
                Several catalogs need A2UI v1.0 or later.

        Raises:
            A2uiCatalogError: If no catalog is given, two catalogs share an ID,
                the catalogs target different protocol versions, there are
                several catalogs before v1.0, or they target v0.8.
        """
        self._catalogs = check_dsl_catalogs(catalogs)
        # The messages use the catalogs' protocol version: v1.0 emits one
        # `createSurface` carrying the components and data model, while v0.9
        # and v0.9.1 emit `createSurface`, `updateComponents` and
        # `updateDataModel`.
        self.version = to_protocol_version(self._catalogs[0].protocol_version)
        if self.version == ProtocolVersion.V0_8:
            raise A2uiCatalogError(
                "The Elemental format supports catalogs for protocol v0.9, v0.9.1"
                " and v1.0, got v0.8."
            )
        self.helpers = build_catalog_helpers(self._catalogs)
        # With several catalogs, the surface has no default catalog: every
        # compiled component and function call names its own catalog.
        self._multi = len(self._catalogs) > 1
        self.expr_parser = ElementalExpressionParser()

        # From v1.0 on, components and function calls may name their own
        # catalog, and data bindings / function calls inside component values
        # use the `@path` / `@call` keys.
        self.supports_catalog_overrides = self.version == ProtocolVersion.V1_0
        self._path_key = "@path" if self.supports_catalog_overrides else "path"
        self._call_key = "@call" if self.supports_catalog_overrides else "call"

        # Tags of the components that hold child components, per catalog, for
        # forgiving parsing of unclosed leaf components.
        self.container_tags_by_catalog: dict[str, set[str]] = {}
        for cat_id, helper in self.helpers.items():
            tags: set[str] = set()
            for comp_name in helper.components:
                for prop_name in helper.get_component_properties(comp_name):
                    prop_schema = helper.get_property_schema(comp_name, prop_name)
                    if _property_schema_accepts_components(prop_schema):
                        tags.add(_component_tag(comp_name))
                        break
            self.container_tags_by_catalog[cat_id] = tags

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs, in the order the compiler received them."""
        return list(self._catalogs)

    def _resolve_helper(self, catalog_id: str) -> CatalogSchemaHelper:
        """Returns the helper for a catalog ID.

        Raises:
            ValueError: If `catalog_id` names no configured catalog.
        """
        if catalog_id in self.helpers:
            return self.helpers[catalog_id]
        raise ValueError(
            f"Unknown catalogId '{catalog_id}'. Available catalogs: "
            f"{list(self.helpers.keys())}"
        )

    def _resolve_override(self, catalog_id: str, kind: str) -> CatalogSchemaHelper:
        """Resolves a per-component or per-function catalog override.

        Raises:
            ValueError: If the catalogs target a protocol version that does not
                allow overrides, or `catalog_id` names no configured catalog.
        """
        if not self.supports_catalog_overrides:
            raise ValueError(
                f"A {kind} catalogId override ('{catalog_id}') requires protocol"
                " v1.0 or later, but the catalogs target"
                f" '{self._catalogs[0].protocol_version}'. Only the surface may"
                " name a catalog."
            )
        return self._resolve_helper(catalog_id)

    def _sole_helper(self) -> CatalogSchemaHelper:
        return next(iter(self.helpers.values()))

    def _catalog_defining(
        self, kind: Literal["component", "function"], name: str
    ) -> str:
        """Returns the one catalog that defines an un-annotated name.

        Raises:
            ValueError: If no catalog or several catalogs define `name`.
        """
        matches = catalogs_defining(self.helpers, kind, name)
        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise ValueError(
                f"Unknown {kind} '{name}': none of the catalogs"
                f" {list(self.helpers)} defines it."
            )
        raise ValueError(
            f"The {kind} '{name}' is defined in several catalogs: {matches}. Name"
            " its catalog with a `catalog-id` attribute on the element, or a"
            " `catalogId` argument in a function call."
        )

    def _resolve_component(
        self, comp_name: str, tag: str, explicit_catalog_id: str | None
    ) -> tuple[CatalogSchemaHelper, str | None]:
        """Finds the catalog of a component element.

        Returns:
            The catalog's helper, and the `catalogId` to write on the compiled
            component: the explicit one, the catalog found by name when there
            are several catalogs, or None with a single catalog.

        Raises:
            ValueError: If the catalog does not define the component, or, with
                several catalogs, no catalog or several catalogs define an
                un-annotated component.
        """
        if explicit_catalog_id:
            helper = self._resolve_override(explicit_catalog_id, "component")
            write_id: str | None = explicit_catalog_id
        elif self._multi:
            write_id = self._catalog_defining("component", comp_name)
            helper = self.helpers[write_id]
        else:
            helper, write_id = self._sole_helper(), None
        if comp_name not in helper.components:
            raise ValueError(
                f"Unknown component '{comp_name}' for tag '{tag}' in catalog"
                f" '{self._catalog_id_of(helper)}'."
            )
        return helper, write_id

    def _resolve_function(
        self, fn_name: str, explicit_catalog_id: str | None
    ) -> tuple[CatalogSchemaHelper, str | None]:
        """Finds the catalog of a function call.

        With a single catalog, an un-annotated call resolves against it even
        if the catalog does not declare the function.

        Returns:
            The catalog's helper, and the `catalogId` to write on the compiled
            call: the explicit one, the catalog found by name when there are
            several catalogs, or None with a single catalog.

        Raises:
            ValueError: If an explicit catalog does not define the function,
                or, with several catalogs, no catalog or several catalogs
                define an un-annotated function.
        """
        if explicit_catalog_id:
            helper = self._resolve_override(explicit_catalog_id, "function")
            if fn_name not in helper.functions:
                raise ValueError(
                    f"Unknown function '{fn_name}' in catalog '{explicit_catalog_id}'."
                )
            return helper, explicit_catalog_id
        if self._multi:
            cat_id = self._catalog_defining("function", fn_name)
            return self.helpers[cat_id], cat_id
        return self._sole_helper(), None

    def _stamp_literal_calls(self, value: Any) -> Any:
        """Names the catalog of each function call in literal slot JSON.

        With several catalogs every compiled call must carry a `catalogId`, so
        a `@call` object without one gets the catalog found by its name.

        Raises:
            ValueError: If no catalog or several catalogs define such a call.
        """
        if not self._multi:
            return value
        if isinstance(value, list):
            return [self._stamp_literal_calls(v) for v in value]
        if not isinstance(value, dict):
            return value
        stamped = {k: self._stamp_literal_calls(v) for k, v in value.items()}
        fn_name = stamped.get(self._call_key)
        if isinstance(fn_name, str) and not stamped.get("catalogId"):
            stamped["catalogId"] = self._catalog_defining("function", fn_name)
        return stamped

    def _load_slot_json(self, text: str, what: str) -> Any:
        return self._stamp_literal_calls(self._load_json(text, what))

    @staticmethod
    def _catalog_id_of(helper: CatalogSchemaHelper) -> str:
        return helper.catalog_model.catalog_id

    def _resolve_action_property_name(
        self,
        name: str,
        comp_name: str,
        properties: list[str],
        helper: CatalogSchemaHelper,
    ) -> str:
        """Maps React-like event names (onclick, onSubmitAction) back to catalog properties (action, submitAction)."""
        h = helper
        if name in properties:
            return name

        for p in properties:
            if p.lower() == name.lower():
                return p

        action_props = []
        for p in properties:
            p_schema = h.get_property_schema(comp_name, p)
            if p_schema and _is_action_property(p_schema):
                action_props.append(p)

        if name.lower() == "onclick":
            if "onclick" in properties:
                return "onclick"
            if not action_props:
                raise ValueError(
                    f"Component '{comp_name}' does not accept any action properties, "
                    "but 'onclick' was specified."
                )
            return action_props[0]

        if name.startswith("on") and len(name) > 2:
            if name in properties:
                return name
            camel_action = name[2].lower() + name[3:]
            if camel_action in properties:
                return camel_action
            for p in properties:
                if p.lower() == camel_action.lower():
                    return p
        return name

    def compile(
        self,
        html_text: str,
        surface_id: str = "default_surface",
    ) -> list[AgentToRendererMessage]:
        """Compiles A2UI Elemental HTML into A2UI message models.

        Args:
            html_text: The Elemental markup of one block.
            surface_id: The surface ID to use when `<body>` has no `id`.

        Returns:
            The compiled messages. A `<body>` compiles to a `createSurface`, or,
            with the `update` attribute, to `updateComponents` and
            `updateDataModel` messages for an existing surface.

        Raises:
            ValueError: If the markup is invalid, names an unknown catalog,
                component or function, has a `<link rel="catalog">` while
                there are several catalogs, writes without a catalog a name
                that several catalogs define, or does not match the catalog
                schemas.
        """
        escaped_html = _escape_nested_script_tags(html_text)
        # Wrap in a virtual <root> container to handle multiple top-level
        # siblings gracefully (such as `<link rel="catalog">` and `<body>`). The
        # HTML parser expects a single root element; wrapping them here ensures
        # they are parsed inside a single DOM tree. This tag is a parser-only
        # helper and is not expected to be generated by the model or seen in the
        # output.
        wrapped_html = f"<root>{escaped_html}</root>"

        builder = DomBuilder(self.container_tags_by_catalog)
        builder.feed(wrapped_html)
        virtual_root = builder.root

        if not virtual_root or not virtual_root.children:
            raise ValueError("A2UI Elemental document is empty.")

        # Find the actual active root element inside the virtual root
        root = None
        for child in virtual_root.children:
            if child.tag in [
                "body",
                f"{TAG_PREFIX}delete-surface",
                f"{TAG_PREFIX}call-function",
            ]:
                root = child
                break

        if not root:
            raise ValueError(
                "A2UI Elemental document must have a <body>,"
                f" <{TAG_PREFIX}delete-surface>, or <{TAG_PREFIX}call-function> root"
                " element."
            )

        link_nodes = [c for c in virtual_root.children if _is_catalog_link(c)]
        if root.tag == "body":
            link_nodes.extend(c for c in root.children if _is_catalog_link(c))
            # If there is a standalone operation inside body, treat it as the root
            standalone = next(
                (
                    c
                    for c in root.children
                    if c.tag
                    in (f"{TAG_PREFIX}delete-surface", f"{TAG_PREFIX}call-function")
                ),
                None,
            )
            if standalone:
                root = standalone
        self._check_catalog_links(link_nodes)

        if root.tag == f"{TAG_PREFIX}delete-surface":
            surf_id = root.attrs.get("surface-id", "")
            return to_message_models(
                [self._envelope({SurfaceOperation.DELETE: {"surfaceId": surf_id}})]
            )

        if root.tag == f"{TAG_PREFIX}call-function":
            return to_message_models([self._compile_call_function(root)])

        return to_message_models(self._compile_body(root, virtual_root, surface_id))

    def _check_catalog_links(self, link_nodes: Sequence[Node]) -> None:
        """Checks the document's `<link rel="catalog">` elements.

        A link names the surface catalog, which exists only with a single
        catalog, so it may only name that catalog.

        Raises:
            ValueError: If there are links and several catalogs, a link has no
                href, or a link names a catalog other than the single one.
        """
        if not link_nodes:
            return
        if self._multi:
            raise ValueError(
                '<link rel="catalog"> names a surface catalog, which only a single'
                f" catalog allows. With several catalogs ({list(self.helpers)}),"
                " the surface has no default catalog: components and functions"
                " are found by name, and a name that several catalogs define"
                " needs a `catalog-id` attribute or `catalogId` argument."
            )
        for node in link_nodes:
            href = node.attrs.get("href")
            if not href:
                raise ValueError('A <link rel="catalog"> element must have an href.')
            self._resolve_helper(href)

    def _compile_call_function(self, root: Node) -> dict[str, Any]:
        """Compiles a `<ui-call-function>` element into a callRendererFunction.

        The function's catalog is the element's `catalog-id`, or else the
        single catalog, or, with several catalogs, the one catalog that
        defines the function. The compiled call always names its catalog.

        Raises:
            ValueError: If the catalogs target a protocol version before v1.0,
                which has no `callRendererFunction`, the function is unknown or
                defined in several catalogs without a `catalog-id`, or an
                argument is not declared by a function whose arguments schema
                disallows extra properties.
        """
        call_name = root.attrs.get("name", "")
        if not self.supports_catalog_overrides:
            raise ValueError(
                f"<{TAG_PREFIX}call-function> requires protocol v1.0; the catalogs"
                f" target {self.version.value}."
            )
        func_call_id = root.attrs.get("id", "")
        fn_helper, _ = self._resolve_function(call_name, _attr_catalog_id(root.attrs))
        if call_name not in fn_helper.functions:
            raise ValueError(
                f"Unknown function '{call_name}' in catalog"
                f" '{self._catalog_id_of(fn_helper)}'."
            )

        args: dict[str, Any] = {}
        for attr_name, attr_val in root.attrs.items():
            if attr_name in ("id", "name", *_CATALOG_ID_ATTRS):
                continue
            args[_kebab_to_camel(attr_name)] = self._compile_value(
                self.expr_parser.parse(attr_val or "")
            )

        # Literal JSON arguments: `<script type="application/json" slot="args">`
        # holds an object of arguments, and any other slot holds one argument.
        for child in root.children:
            if not _is_json_script(child) or not child.attrs.get("slot"):
                continue
            slot_name = child.attrs["slot"]
            value = self._load_slot_json(
                child.text, f"script slot '{slot_name}' of function '{call_name}'"
            )
            if slot_name == "args":
                if not isinstance(value, dict):
                    raise ValueError(
                        f"The 'args' script slot of function '{call_name}' must"
                        " hold a JSON object."
                    )
                args.update(value)
            else:
                args[_kebab_to_camel(slot_name)] = value

        self._check_function_args(fn_helper, call_name, args)

        return self._envelope({
            "callRendererFunction": {
                "functionCallId": func_call_id or "call_1",
                "callFunction": {
                    "catalogId": self._catalog_id_of(fn_helper),
                    self._call_key: call_name,
                    "args": args,
                },
            },
        })

    def _check_function_args(
        self, helper: CatalogSchemaHelper, fn_name: str, args: Mapping[str, Any]
    ) -> None:
        """Rejects arguments that a function's closed arguments schema lacks.

        Raises:
            ValueError: If the function's arguments schema disallows extra
                properties and `args` has a key it does not declare.
        """
        if _function_allows_extra_args(helper.functions.get(fn_name)):
            return
        declared = helper.get_function_properties(fn_name)
        unknown = [name for name in args if name not in declared]
        if unknown:
            raise ValueError(
                f"Function '{fn_name}' in catalog '{self._catalog_id_of(helper)}'"
                f" does not accept the argument(s) {unknown}. Valid arguments:"
                f" {declared}."
            )

    def _envelope(self, body: dict[str, Any]) -> dict[str, Any]:
        """Adds the catalogs' protocol version to a message body."""
        return {"version": self.version.value, **body}

    @staticmethod
    def _load_json(text: str, what: str) -> Any:
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in {what}: {e}") from e

    def _compile_body(
        self,
        root: Node,
        virtual_root: Node,
        surface_id: str,
    ) -> list[dict[str, Any]]:
        """Compiles a `<body>` element into surface messages."""
        surface_id = root.attrs.get("id") or surface_id
        is_update = _is_flag_set(root.attrs, UPDATE_ATTR)

        # Data scripts: one without a `path` holds the whole data model; one
        # with a `path` holds the value for that path.
        root_data: Any = None
        path_updates: list[tuple[str, Any]] = []
        for child in [*virtual_root.children, *root.children]:
            if not _is_json_script(child) or "slot" in child.attrs:
                continue
            path = child.attrs.get("path")
            if path:
                if not child.text.strip():
                    raise ValueError(f"The data script for path '{path}' is empty.")
                path_updates.append(
                    (path, self._load_json(child.text, f"data script '{path}'"))
                )
            else:
                text = child.text.strip()
                root_data = self._load_json(text, "dataModel script") if text else {}

        remaining_children = [
            c
            for c in root.children
            if not _is_catalog_link(c)
            and not (_is_json_script(c) and "slot" not in c.attrs)
        ]
        for child in remaining_children:
            if not child.tag.startswith(TAG_PREFIX):
                raise ValueError(
                    f"Invalid element tag '{child.tag}' under <body>. Only"
                    f" '{TAG_PREFIX}*' components are supported inside A2UI surfaces."
                )

        ctx = _CompileContext()
        for child in remaining_children:
            self._compile_node(child, ctx)

        data_messages: list[dict[str, Any]] = []
        if root_data is not None and (is_update or not ctx.components):
            if root_data or is_update:
                data_messages.append(
                    self._update_data_message(surface_id, "/", root_data)
                )
        data_messages.extend(
            self._update_data_message(surface_id, path, value)
            for path, value in path_updates
        )

        if is_update:
            messages: list[dict[str, Any]] = []
            if ctx.components:
                messages.append(self._update_components_message(surface_id, ctx))
            messages.extend(data_messages)
            if not messages:
                raise ValueError(
                    f"The update of surface '{surface_id}' has no components or"
                    " data scripts."
                )
            return messages

        # A body with only data scripts updates the data model of the surface.
        if not ctx.components and data_messages:
            return data_messages

        create: dict[str, Any] = {"surfaceId": surface_id}
        # With several catalogs, `createSurface` names none: the surface has no
        # default catalog, and every component and call names its own.
        create_catalog_id = surface_catalog_id(self._catalogs)
        if create_catalog_id is not None:
            create["catalogId"] = create_catalog_id
        if self.version == ProtocolVersion.V1_0:
            create["components"] = ctx.components
            if root_data:
                create["dataModel"] = root_data
            return [
                self._envelope({SurfaceOperation.CREATE: create}),
                *data_messages,
            ]

        # Before v1.0, `createSurface` carries neither components nor a data
        # model; they follow in `updateComponents` and `updateDataModel`.
        messages = [
            self._envelope({SurfaceOperation.CREATE: create}),
            self._update_components_message(surface_id, ctx),
        ]
        if root_data:
            messages.append(self._update_data_message(surface_id, "/", root_data))
        messages.extend(data_messages)
        return messages

    def _update_components_message(
        self, surface_id: str, ctx: _CompileContext
    ) -> dict[str, Any]:
        return self._envelope({
            SurfaceOperation.UPDATE_COMPONENTS: {
                "surfaceId": surface_id,
                "components": ctx.components,
            },
        })

    def _update_data_message(
        self, surface_id: str, path: str, value: Any
    ) -> dict[str, Any]:
        return self._envelope({
            SurfaceOperation.UPDATE_DATA: {
                "surfaceId": surface_id,
                "path": path,
                "value": value,
            },
        })

    def _compile_value(self, val: Any, is_action: bool = False) -> Any:
        """Recursively post-processes parsed expressions to match A2UI JSON structures.

        Args:
            val: The parsed expression.
            is_action: Whether the value is an Action property.
        """
        if isinstance(val, dict):
            if "path" in val or self._path_key in val:
                if set(val) == {"path"}:
                    return {self._path_key: val["path"]}
                return val
            if "call" in val:
                return self._compile_call(val, is_action)

            return {k: self._compile_value(v, is_action) for k, v in val.items()}

        if isinstance(val, list):
            return [self._compile_value(item, is_action) for item in val]

        return val

    def _compile_call(self, val: dict[str, Any], is_action: bool) -> Any:
        """Compiles a parsed function call (or `Event(...)`) expression.

        The call's catalog is its `catalogId` argument, or else the single
        catalog, or, with several catalogs, the one catalog that defines the
        function, which the compiled call then names.

        Raises:
            ValueError: If the call names an unknown catalog, its catalog does
                not define it, or, with several catalogs, no catalog or several
                catalogs define a call without a `catalogId`.
        """
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

        explicit_fn_catalog_id: str | None = val.get("catalogId")
        # A `catalogId` argument names the call's catalog unless a function of
        # that name declares an argument called `catalogId`.
        candidates = (
            [
                self.helpers[c]
                for c in catalogs_defining(self.helpers, "function", fn_name)
            ]
            if self._multi
            else [self._sole_helper()]
        )
        declares_catalog_id_arg = any(
            "catalogId" in h.get_function_properties(fn_name) for h in candidates
        )
        if (
            isinstance(fn_args, dict)
            and "catalogId" in fn_args
            and not declares_catalog_id_arg
            and isinstance(fn_args.get("catalogId"), str)
        ):
            explicit_fn_catalog_id = fn_args["catalogId"]
            fn_args = {k: v for k, v in fn_args.items() if k != "catalogId"}
        elif (
            isinstance(fn_args, list)
            and fn_args
            and isinstance(fn_args[-1], dict)
            and set(fn_args[-1].keys()) == {"catalogId"}
            and isinstance(fn_args[-1].get("catalogId"), str)
            and not declares_catalog_id_arg
        ):
            explicit_fn_catalog_id = fn_args[-1]["catalogId"]
            fn_args = fn_args[:-1]

        fn_helper, write_catalog_id = self._resolve_function(
            fn_name, explicit_fn_catalog_id
        )

        call_dict: dict[str, Any] = {self._call_key: fn_name}
        if fn_name in fn_helper.functions:
            fn_props = fn_helper.get_function_properties(fn_name)
            compiled_args = {}
            if isinstance(fn_args, dict):
                for k, v in fn_args.items():
                    compiled_args[k] = self._compile_value(v, is_action)
            elif isinstance(fn_args, list):
                for idx, v in enumerate(fn_args):
                    if idx < len(fn_props):
                        compiled_args[fn_props[idx]] = self._compile_value(v, is_action)
            call_dict["args"] = compiled_args
        else:
            call_dict["args"] = self._compile_value(fn_args, is_action)
        if write_catalog_id:
            call_dict["catalogId"] = write_catalog_id

        if is_action:
            return {"functionCall": call_dict}
        return call_dict

    def _compile_node(self, node: Node, ctx: _CompileContext) -> str | None:
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
        comp_helper, comp_catalog_id = self._resolve_component(
            comp_name, node.tag, _attr_catalog_id(node.attrs)
        )
        properties = comp_helper.get_component_properties(comp_name)
        comp_id = node.attrs.get("id") or ctx.next_auto_id()

        comp_dict: dict[str, Any] = {"id": comp_id, "component": comp_name}
        if comp_catalog_id:
            comp_dict["catalogId"] = comp_catalog_id

        # Track sibling value path for implicit validation injection
        sibling_value_path = None

        # Check for template child
        template_node = next((c for c in node.children if c.tag == "template"), None)

        # 1. Map attributes to properties
        for attr_name, attr_val in node.attrs.items():
            if attr_name in ["id", "slot", "catalog-id", "catalogid"]:
                continue
            if attr_name == "path" and template_node:
                continue

            # Map kebab-case attribute names to camelCase property names
            prop_parts = attr_name.split("-")
            prop_name = prop_parts[0] + "".join(p.capitalize() for p in prop_parts[1:])

            # Map TS/HTML action names back to catalog properties
            prop_name = self._resolve_action_property_name(
                prop_name, comp_name, properties, helper=comp_helper
            )

            if comp_name in comp_helper.components and prop_name not in properties:
                continue

            # Parse value
            if attr_val is None or attr_val == "":
                # HTML boolean attribute shorthand (e.g., <ui-button disabled>)
                prop_schema = comp_helper.get_property_schema(comp_name, prop_name)
                if prop_schema and prop_schema.get("type") == "boolean":
                    parsed_val: Any = True
                else:
                    parsed_val = ""
            else:
                parsed_val = self.expr_parser.parse(attr_val)

            # Retrieve property schema for type coercion/coaxing
            prop_schema = comp_helper.get_property_schema(comp_name, prop_name)

            if isinstance(parsed_val, str) and prop_schema:
                prop_type = _get_primitive_property_type(prop_schema)
                # 1. Coerce boolean values
                if prop_type == "boolean":
                    if parsed_val.lower() == "true":
                        parsed_val = True
                    elif parsed_val.lower() == "false":
                        parsed_val = False
                # 2. Coerce number/integer values
                elif prop_type in ["number", "integer"]:
                    try:
                        if prop_type == "integer":
                            parsed_val = int(parsed_val)
                        else:
                            parsed_val = float(parsed_val)
                    except ValueError:
                        pass
                # 3. Parse string arrays/objects fallback as expression if they start with [ or {
                elif prop_type in ["array", "object"] or (
                    parsed_val.startswith("[") or parsed_val.startswith("{")
                ):
                    try:
                        # Wrap in braces virtually to compile using expression parser if not already wrapped
                        stripped_val = parsed_val.strip()
                        expr_str = (
                            stripped_val
                            if stripped_val.startswith("{")
                            and stripped_val.endswith("}")
                            else f"{{{stripped_val}}}"
                        )
                        parsed_val = self.expr_parser.parse(expr_str)
                    except Exception:
                        pass

            # Post-process expression value (events, functions, etc.). A
            # function call resolves on its own, not against this component's
            # catalog.
            parsed_val = self._compile_value(
                parsed_val,
                is_action=(
                    prop_name in ["action", "submitAction"]
                    or _is_action_property(prop_schema)
                ),
            )

            # Handle option auto-expansion
            prop_schema = comp_helper.get_property_schema(comp_name, prop_name)
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
                and self._path_key in parsed_val
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
                            slot_name, comp_name, properties, helper=comp_helper
                        )
                        comp_dict[slot_name] = self._load_slot_json(
                            child.text,
                            f"script slot '{slot_name}' of component '{comp_id}'",
                        )
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
                            slot_name, comp_name, properties, helper=comp_helper
                        )
                        comp_dict[slot_name] = self._load_slot_json(
                            child.text,
                            f"script slot '{slot_name}' of component '{comp_id}'",
                        )
                else:
                    child_id = self._compile_node(child, ctx)
                    if not child_id:
                        continue
                    slot_name = child.attrs.get("slot")
                    if slot_name:
                        slot_name = self._resolve_action_property_name(
                            slot_name, comp_name, properties, helper=comp_helper
                        )
                        if slot_name in properties:
                            slot_schema = comp_helper.get_property_schema(
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
                if isinstance(check, dict) and self._call_key in check:
                    fn_name = check[self._call_key]
                    fn_args = check.get("args", {})
                    check_helper, _ = self._resolve_function(
                        fn_name, check.get("catalogId")
                    )
                    fn_props = check_helper.get_function_properties(fn_name)

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
                    if isinstance(cond, dict) and self._call_key in cond:
                        fn_name = cond[self._call_key]
                        fn_args = cond.get("args", {})
                        check_helper, _ = self._resolve_function(
                            fn_name, cond.get("catalogId")
                        )
                        fn_props = check_helper.get_function_properties(fn_name)

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
        required_props = comp_helper.get_component_required(comp_name)
        for prop_name in required_props:
            if prop_name not in comp_dict:
                p_schema = comp_helper.get_property_schema(comp_name, prop_name)
                if p_schema and _is_action_property(p_schema):
                    comp_dict[prop_name] = {
                        "event": {
                            "name": f"{comp_id}_clicked",
                            "context": {"component": comp_name, "property": prop_name},
                        }
                    }

        ctx.components.append(comp_dict)
        return comp_id
