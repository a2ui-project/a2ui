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

"""Prompt generator for the A2UI Vertical inference format.

Compiles component catalog schemas into concise, non-nested component signatures,
automatically omitting container components that require child components or
cannot sit directly on a surface root.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import json
import logging
import re
from typing import Any, Literal

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import A2uiError, CatalogApi
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_mixed_catalogs,
    normalize_prompt_example_messages,
    surface_catalog_id,
    to_message_dicts,
)
from a2ui.prompt import PromptGenerator
from a2ui.utils import agent_callable_functions, validate_payload

from .compiler import (
    is_child_slot,
    normalize_wire_version,
    ordered_component_properties,
    schema_allows_databinding,
)
from .decompiler import VerticalDecompiler

_logger = logging.getLogger(__name__)

_VERTICAL_HEADER = (
    "# A2UI Vertical Output Contract\n\nYou must output user interfaces using A2UI"
    " Vertical notation.\nYou MUST surround the UI block with sentinel tags"
    f" `{A2UI_INFERENCE_OPEN_TAG}` and `{A2UI_INFERENCE_CLOSE_TAG}`.\n\n## Grammar"
    " Rules"
)

_RULE_COMPONENTS = (
    "Instantiate one or more standalone components directly:\n  "
    ' ComponentName(param1="value1", param2=42)\n   If outputting multiple components,'
    " write each component on a new line. Each component renders on its own surface in"
    " a vertical sequence."
)

_RULE_SYNTAX = (
    'Syntax:\n   - Use `param="value"` or `param: "value"` for named parameters.\n  '
    " - Positional parameters matching catalog signatures are also supported (e.g."
    ' `Text("Hello")`).\n   - Strings: Double or single quoted (e.g. "Hello").\n   -'
    " Numbers: Integers or decimals (e.g. 42, 3.14).\n   - Booleans: true or false.\n  "
    ' - Null: null.\n   - Lists: [item1, item2].\n   - Maps: {"key": "value"} or {key:'
    ' "value"}.\n   - Validation checks (on checkable inputs with `value=$/path`):'
    ' `?required` or `?regex("^[0-9]+$", "Digits only")` (checks require the'
    " component's `value` property to be bound to a `$/path`)."
)

_EVENT_RULE_PRE_V1_0 = (
    'Actions & Events:\n   - Server-side actions: `Event("action_name",'
    ' param="val")` or `action="action_name"`.\n   - Function actions:'
    ' `openUrl("https://example.com")`.'
)

_EVENT_RULE_V1_0 = (
    'Actions & Events:\n   - Server-side actions: `Event("action_name", param="val",'
    ' userMessage="Optional user text")`.\n     Pass `userMessage=` (a string, `$path`'
    " binding, or function call) to set the message shown on the user's behalf.\n   -"
    ' Function actions: `openUrl("https://example.com")`.'
)

_RULE_BINDINGS = (
    "Data Bindings:\n"
    "   - Prefix data model paths with `$/` (e.g. `$/user/name`).\n"
    "   - Arguments marked `(static)` MUST use literal values, never `$` data bindings."
)

_RULE_NO_CONTAINERS = (
    "Do NOT specify surface IDs, component IDs, variable assignments, or container"
    " nesting. The runtime automatically manages surfaces and IDs."
)

_JSON_BLOCK_RE = re.compile(r"(?:Example[^\n]*\n)?```json\s*\n(.*?)\n```", re.DOTALL)


def _get_schema_enum(prop_schema: Any) -> list[str] | None:
    """Recursively extracts enum definitions from a JSON schema."""
    if not isinstance(prop_schema, Mapping):
        return None
    if isinstance(prop_schema.get("enum"), list):
        return [str(x) for x in prop_schema["enum"]]
    for key in ("oneOf", "anyOf", "allOf"):
        subs = prop_schema.get(key)
        if isinstance(subs, list):
            for sub in subs:
                res = _get_schema_enum(sub)
                if res:
                    return res
    return None


def _multi_catalog_rules(helpers: Mapping[str, CatalogSchemaHelper]) -> str:
    catalog_ids = list(helpers)
    example_id = catalog_ids[-1]
    listing = "\n".join(f"- `{cat_id}`" for cat_id in catalog_ids)
    lines = [
        "## Multiple Catalogs",
        "",
        "Several component catalogs are active:",
        listing,
        "",
        (
            "Each component and function call resolves by name in whichever catalog"
            " defines it."
        ),
        (
            "When several catalogs define the same name, disambiguate with"
            f' `catalogId="{example_id}"`.'
        ),
    ]
    shared: list[str] = []
    kinds: tuple[tuple[Literal["component", "function"], str], ...] = (
        ("component", "Component"),
        ("function", "Function"),
    )
    for kind, label in kinds:
        names = {
            name
            for h in helpers.values()
            for name in (h.components if kind == "component" else h.functions)
        }
        for name in sorted(names):
            defining = catalogs_defining(helpers, kind, name)
            if len(defining) > 1:
                ids = ", ".join(f"`{cid}`" for cid in defining)
                shared.append(f"- {label} `{name}`: {ids}")
    if shared:
        lines.extend([
            "",
            "Names defined in several catalogs requiring `catalogId`:",
            *shared,
        ])
    return "\n".join(lines)


class VerticalPromptGenerator(PromptGenerator):
    """Generates system prompts guiding models to produce A2UI Vertical format."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        surface_id: str = "main",
        version: str | None = None,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self._examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self.surface_id = surface_id
        target_version = (
            normalize_wire_version(version)
            if version is not None
            else catalogs_protocol_version(self._catalogs)
        )
        self.version = target_version
        self._v1 = is_at_least_version(target_version, ProtocolVersion.V1_0)
        self.helpers = build_catalog_helpers(self._catalogs, target_version)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """The catalogs the generator describes, in order."""
        return list(self._catalogs)

    def component_requires_children(
        self, comp_name: str, helper: CatalogSchemaHelper | None = None
    ) -> bool:
        """Returns True if `comp_name` requires children or cannot be a surface root."""
        target_helper = helper or next(iter(self.helpers.values()))
        comp_schema = target_helper.components.get(comp_name)
        if isinstance(comp_schema, Mapping):
            allowed_parents = comp_schema.get("allowedParents")
            if (
                isinstance(allowed_parents, list)
                and allowed_parents
                and "Surface" not in allowed_parents
            ):
                return True

        reqs = set(target_helper.get_component_required(comp_name))
        for prop in target_helper.get_component_properties(comp_name):
            if prop in reqs and is_child_slot(target_helper, comp_name, prop):
                return True
        return False

    def _rewrite_catalog_instructions(
        self, raw_instructions: str, helper: CatalogSchemaHelper
    ) -> str:
        """Rewrites standalone JSON examples in catalog instructions to Vertical, omitting nested examples."""
        decompiler = VerticalDecompiler(self._catalogs, version=self.version)

        def _replace_json(match: re.Match[str]) -> str:
            try:
                parsed = json.loads(match.group(1).strip())
            except json.JSONDecodeError as exc:
                _logger.warning(
                    "Skipping malformed JSON example in catalog instructions for"
                    " '%s': %s",
                    helper.catalog_model.catalog_id,
                    exc,
                )
                return match.group(0)

            msgs = [parsed] if isinstance(parsed, dict) else parsed
            if not isinstance(msgs, list) or not msgs:
                return ""
            comps: list[Mapping[str, Any]] = []
            for m in msgs:
                if not isinstance(m, Mapping):
                    return ""
                for op_k in ("createSurface", "updateComponents"):
                    body = m.get(op_k)
                    if isinstance(body, Mapping) and isinstance(
                        body.get("components"), list
                    ):
                        comps.extend(
                            c for c in body["components"] if isinstance(c, Mapping)
                        )
            if len(comps) > 1 or any(
                self.component_requires_children(str(c.get("component", "")), helper)
                for c in comps
            ):
                return ""
            try:
                normalized = normalize_prompt_example_messages(
                    msgs,
                    version=self.version,
                    default_catalog_id=helper.catalog_model.catalog_id,
                    default_surface_id=self.surface_id,
                )
                dsl = decompiler.decompile(normalized)
            except (A2uiError, ValueError) as exc:
                _logger.warning(
                    "Skipping non-decompilable example in catalog instructions for"
                    " '%s': %s",
                    helper.catalog_model.catalog_id,
                    exc,
                )
                return ""
            if not dsl.strip():
                return ""
            return f"```\n{decompiler.wrap_decompiled_blocks([dsl])}\n```"

        rewritten = _JSON_BLOCK_RE.sub(_replace_json, raw_instructions)
        rewritten = re.sub(r"\n*## Examples\s*\Z", "", rewritten.strip())
        return rewritten.strip()

    def generate_component_signatures(
        self,
        allowed_components: Sequence[str] | None = None,
        *,
        helper: CatalogSchemaHelper | None = None,
    ) -> str:
        """Compiles non-container component definitions into concise signatures."""
        target_helper = helper or next(iter(self.helpers.values()))
        allowed_set = (
            set(allowed_components) if allowed_components is not None else None
        )
        signatures: list[str] = []

        for name in sorted(target_helper.component_properties.keys()):
            if self.component_requires_children(name, target_helper):
                continue
            if allowed_set is not None and name not in allowed_set:
                continue

            props = ordered_component_properties(target_helper, name)
            if target_helper.is_checkable(name):
                props = [*props, "checks"]
            reqs = set(target_helper.get_component_required(name))
            comp_desc = target_helper.get_component_description(name)

            ordered_args: list[str] = []
            prop_details: list[str] = []

            for p in props:
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                p_schema = target_helper.get_property_schema(name, p)

                arg_label = f"{p}{opt_suffix}"
                if p != "checks" and not schema_allows_databinding(p_schema):
                    arg_label += " (static)"
                ordered_args.append(arg_label)

                p_desc = (
                    p_schema.get("description")
                    if isinstance(p_schema, Mapping)
                    else None
                )
                enum_vals = target_helper.get_property_enum(
                    name, p
                ) or _get_schema_enum(p_schema)

                if p_desc or enum_vals:
                    detail_parts: list[str] = []
                    if isinstance(p_desc, str) and p_desc:
                        detail_parts.append(p_desc)
                    if enum_vals:
                        enum_str = ", ".join(f"'{v}'" for v in enum_vals)
                        detail_parts.append(f"Must be one of: {enum_str}")
                    prop_details.append(f"  - {p}: {' '.join(detail_parts)}")

            sig = f"• {name}({', '.join(ordered_args)})"
            if comp_desc:
                desc_indented = comp_desc.replace("\n", "\n    ")
                sig += f"\n  - Description: {desc_indented}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)

        return "\n".join(signatures)

    def generate_function_signatures(
        self, *, helper: CatalogSchemaHelper | None = None
    ) -> str:
        """Compiles catalog function definitions into concise signatures."""
        target_helper = helper or next(iter(self.helpers.values()))
        signatures: list[str] = []

        for name in sorted(target_helper.function_properties.keys()):
            props = target_helper.get_function_properties(name)
            reqs = set(target_helper.get_function_required(name))
            f_desc = target_helper.get_function_description(name)

            ordered_args: list[str] = []
            prop_details: list[str] = []

            for p in props:
                opt_suffix = "" if p in reqs else "?"
                ordered_args.append(f"{p}{opt_suffix}")
                p_schema = target_helper.get_function_property_schema(name, p)
                p_desc = (
                    p_schema.get("description")
                    if isinstance(p_schema, Mapping)
                    else None
                )
                if isinstance(p_desc, str) and p_desc:
                    prop_details.append(f"  - {p}: {p_desc}")

            sig = f"• {name}({', '.join(ordered_args)})"
            if f_desc:
                desc_indented = f_desc.replace("\n", "\n    ")
                sig += f"\n  - Description: {desc_indented}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)

        return "\n".join(signatures)

    def _catalog_block(
        self, helper: CatalogSchemaHelper, *, include_heading: bool
    ) -> str:
        comp_sigs = self.generate_component_signatures(helper=helper)
        func_sigs = self.generate_function_signatures(helper=helper)
        raw_instructions = (
            helper.catalog.get("instructions", "")
            if isinstance(helper.catalog, Mapping)
            else ""
        )
        cat_instructions = (
            self._rewrite_catalog_instructions(raw_instructions, helper)
            if isinstance(raw_instructions, str) and raw_instructions.strip()
            else ""
        )

        parts: list[str] = []
        if include_heading:
            parts.append(f"### Catalog: `{helper.catalog_model.catalog_id}`")
        if comp_sigs:
            parts.append(
                "## Component Signatures\n\n"
                "Instantiate these components directly. Children cannot be nested:\n"
                f"{comp_sigs}"
            )
        if func_sigs:
            parts.append(f"## Function Signatures\n\n{func_sigs}")
        if cat_instructions:
            parts.append(f"## Catalog Instructions\n\n{cat_instructions}")
        return "\n\n".join(parts)

    def generate_base_rules(self) -> str:
        """Returns the core syntax contract and grammar rules for the Vertical format."""
        allowed = (
            set(self._allowed_messages) if self._allowed_messages is not None else None
        )
        allows_components = allowed is None or bool(
            allowed
            & {
                "createSurface",
                "CreateSurfaceMessage",
                "updateComponents",
                "UpdateComponentsMessage",
            }
        )
        allows_renderer_call = allowed is None or bool(
            allowed & {"callRendererFunction", "CallRendererFunctionMessage"}
        )

        numbered_rules: list[str] = []
        if allows_components:
            event_rule = _EVENT_RULE_V1_0 if self._v1 else _EVENT_RULE_PRE_V1_0
            numbered_rules.extend([
                _RULE_COMPONENTS,
                _RULE_SYNTAX,
                event_rule,
                _RULE_BINDINGS,
                _RULE_NO_CONTAINERS,
            ])

        if self._v1 and allows_renderer_call:
            callable_fns = agent_callable_functions(self._catalogs)
            if callable_fns:
                formatted = ", ".join(f"`{fn}`" for fn in callable_fns)
                numbered_rules.append(
                    "Standalone Renderer Function Calls:\n   - Invoke"
                    f" `{callable_fns[0]}(...)` on its own line to have the renderer"
                    " execute a function directly.\n   - Only these functions may be"
                    f" called standalone: {formatted}."
                )

        rule_blocks: list[str] = [_VERTICAL_HEADER]
        for idx, body in enumerate(numbered_rules, start=1):
            rule_blocks.append(f"{idx}. {body}")

        if len(self._catalogs) > 1:
            rule_blocks.append(_multi_catalog_rules(self.helpers))

        return "\n\n".join(rule_blocks)

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: CatalogApi | None = None,
    ) -> str:
        """Returns component and function signatures for one or all active catalogs."""
        if not include_schema:
            return ""
        if catalog is not None:
            helper = self.helpers.get(catalog.catalog_id) or CatalogSchemaHelper(
                catalog, self.version
            )
            return self._catalog_block(helper, include_heading=False)

        multi = len(self._catalogs) > 1
        blocks = [
            self._catalog_block(h, include_heading=multi) for h in self.helpers.values()
        ]
        return "\n\n".join(b for b in blocks if b)

    def generate_examples(
        self,
        catalog: CatalogApi | None = None,
        validate: bool = False,
    ) -> str:
        """Returns formatted Vertical few-shot examples."""
        del catalog
        if not self._examples:
            return ""

        default_cat_id = surface_catalog_id(self._catalogs)
        decompiler = VerticalDecompiler(self._catalogs, version=self.version)
        rendered: list[str] = []

        for turn in self._examples:
            normalized = normalize_prompt_example_messages(
                to_message_dicts(turn),
                version=self.version,
                default_catalog_id=default_cat_id,
                default_surface_id=self.surface_id,
            )
            if validate:
                validate_payload(self._catalogs, normalized)
            dsl = decompiler.decompile(normalized)
            if dsl.strip():
                rendered.append(decompiler.wrap_decompiled_blocks([dsl]))

        return "\n\n".join(rendered)
