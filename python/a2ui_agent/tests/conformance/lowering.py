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

"""Helpers for lowering v1.0 agent conformance cases to v0.9 and lifting results."""

from __future__ import annotations

from collections.abc import Mapping
import copy
import json
import os
import re
from typing import Any

from a2ui.inference_formats import to_message_dicts

from .conformance_helpers import load_conformance_json

SUITE_VERSIONS = ("v1.0", "v0.9-lowered")

_RESERVED_KEYS_TO_V09 = {"@path": "path", "@call": "call"}
_RESERVED_KEYS_TO_V10 = {"path": "@path", "call": "@call"}

_VERSION_FIELD_RE = re.compile(
    r'([\u201c"]version[\u201d"]\s*:\s*[\u201c"])(v?1\.0|v0\.9)([\u201d"])'
)
_RESERVED_KEY_FIELD_RE = re.compile(r'"@(path|call)"(?=\s*:)')
_CREATE_SURFACE_OPEN_RE = re.compile(r'"createSurface"\s*:\s*\{')

_ONE_CATALOG_PER_SURFACE = (
    "v0.9 names one catalog per surface, so the case runs as written in v1.0 only."
)
_RESERVED_PLAIN_KEYS = (
    "v0.9 reserves the plain path and call keys for data bindings and function"
    " calls, so a map literal that uses them runs as written in v1.0 only."
)
_NO_USER_MESSAGE = (
    "The v0.9 Action has no userMessage field, so an event carrying one runs as"
    " written in v1.0 only."
)

V1_ONLY_CASES: dict[str, str] = {
    # Express cases
    "test_compile_express_event_user_message": _NO_USER_MESSAGE,
    "test_compile_express_event_user_message_binding_with_context": _NO_USER_MESSAGE,
    "test_decompile_express_event_action_with_user_message": _NO_USER_MESSAGE,
    "test_compile_express_event_user_message_function_call": _NO_USER_MESSAGE,
    "test_decompile_express_event_action_with_function_call_user_message": (
        _NO_USER_MESSAGE
    ),
    "test_compile_express_surface_targeting_names_a_catalog": _ONE_CATALOG_PER_SURFACE,
    "test_decompile_express_two_surfaces_in_two_catalogs": _ONE_CATALOG_PER_SURFACE,
    "test_decompile_express_event_action_with_nested_context": (
        "A v0.9 DynamicValue holds no map, so a map in an event's context runs as"
        " written in v1.0 only."
    ),
    "test_decompile_express_non_identifier_id_before_v1_0_derives_a_variable": (
        "Already written against a v0.9 catalog to test pre-v1.0 component id"
        " derivation, so it runs as written without lowering."
    ),
    "test_decompile_express_non_identifier_id_from_v1_0_is_a_validation_error": (
        "Before v1.0, component ids that are not UAX 31 identifiers are derived"
        " into variables rather than rejected."
    ),
    "test_compile_express_non_identifier_id_from_v1_0_is_a_validation_error": (
        "Before v1.0, component ids need not be UAX 31 identifiers."
    ),
    "test_compile_express_map_literal_keeps_keys_named_like_express_constructs": (
        _RESERVED_PLAIN_KEYS
    ),
    "test_compile_express_map_literal_keeps_quoted_keys_named_like_constructs": (
        _RESERVED_PLAIN_KEYS
    ),
    "test_compile_express_map_literals_in_function_arguments_keep_their_keys": (
        _RESERVED_PLAIN_KEYS
    ),
    "test_decompile_express_map_with_keys_named_like_express_constructs": (
        _RESERVED_PLAIN_KEYS
    ),
    "test_decompile_express_map_with_plain_call_and_args_keys": _RESERVED_PLAIN_KEYS,
    "test_decompile_express_map_with_a_binding_key_beside_other_keys": (
        "Lowered to v0.9, the @path key becomes the plain path key, which v0.9"
        " reserves for data bindings, so the case runs as written in v1.0 only."
    ),
    "test_compile_express_map_with_call_like_keys_still_rejects_bindings": (
        "Lowered to v0.9, this SDK does not reject a binding nested in a"
        " free-form object property."
    ),
    "test_compile_express_surface_extensions_variable_reference": (
        "Surface extensions are only supported in A2UI v1.0 or later."
    ),
    "test_compile_express_empty_extensions_preserved": (
        "Surface and component extensions require A2UI v1.0 or later."
    ),
    "test_compile_express_standalone_call_renderer_or_agent_function": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_compile_express_standalone_call_agent_only_function": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_compile_express_standalone_call_renderer_only_function_is_validation_error": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_compile_express_standalone_call_user_activation_function_is_validation_error": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_generate_prompt_express_callable_from_filtering": (
        "Protocol v0.9 function schema does not support callableFrom."
    ),
    "test_generate_prompt_express_includes_at_syntax_rule": (
        "Protocol v0.9 uses plain path and call keys rather than @path and @call."
    ),
    # Direct JSON cases
    "test_compile_json_newline_in_create_surface_data_model_preserved": (
        "v0.9 createSurface does not carry inline dataModel."
    ),
    "test_parse_response_call_renderer_function_renderer_or_agent_succeeds": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_parse_response_call_renderer_function_agent_only_succeeds": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_parse_response_call_renderer_function_renderer_only_is_validation_error": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_parse_response_call_renderer_function_user_activation_is_validation_error": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_stream_create_surface_inline_components_v10": (
        "v0.9 createSurface does not carry inline components."
    ),
    "test_stream_create_surface_inline_components_in_small_chunks_v10": (
        "v0.9 createSurface does not carry inline components."
    ),
    "test_stream_multi_catalog_resolution_v10": _ONE_CATALOG_PER_SURFACE,
    "test_stream_component_catalog_id_arrives_late_v10": _ONE_CATALOG_PER_SURFACE,
    "test_stream_catalog_id_split_across_chunks_v10": _ONE_CATALOG_PER_SURFACE,
    "test_stream_second_block_calling_renderer_only_function_fails_v10": (
        "Protocol v0.9 function schema does not support callableFrom."
    ),
    "test_decompile_json_call_renderer_function": (
        "Protocol v0.9 has no callRendererFunction message."
    ),
    "test_decompile_json_catalog_qualified_components": _ONE_CATALOG_PER_SURFACE,
}


def swap_version(version: Any) -> Any:
    """Swaps between v1.0 and v0.9 version strings."""
    if version in ("1.0", "v1.0"):
        return "v0.9"
    if version == "v0.9":
        return "1.0"
    return version


def _is_version_at_least_1_0(version_str: Any) -> bool:
    if not isinstance(version_str, str):
        return False
    normalized = version_str.removeprefix("v")
    return normalized.startswith("1.")


def _replace_child_refs(node: Any) -> Any:
    """Replaces v1.0 Child schema references with v0.9 ComponentId references."""
    if isinstance(node, list):
        return [_replace_child_refs(item) for item in node]
    if isinstance(node, dict):
        result: dict[str, Any] = {}
        for k, v in node.items():
            if k == "$ref" and isinstance(v, str) and v.endswith("#/$defs/Child"):
                result[k] = v[: -len("#/$defs/Child")] + "#/$defs/ComponentId"
            else:
                result[k] = _replace_child_refs(v)
        return result
    return node


def lower_catalog_document(
    document: Mapping[str, Any], default_catalog_id: str | None = None
) -> dict[str, Any]:
    """Lowers a v1.0 catalog document dictionary to v0.9."""
    proto = document.get("protocolVersion")
    if proto is not None and not _is_version_at_least_1_0(proto):
        doc = copy.deepcopy(dict(document))
        if default_catalog_id and "catalogId" not in doc:
            doc["catalogId"] = default_catalog_id
        return doc

    doc = _replace_child_refs(copy.deepcopy(dict(document)))
    doc["protocolVersion"] = "0.9"
    if default_catalog_id and "catalogId" not in doc:
        doc["catalogId"] = default_catalog_id

    functions = doc.get("functions")
    if isinstance(functions, dict):
        lowered_functions: dict[str, Any] = {}
        for fn_name, fn_val in functions.items():
            if isinstance(fn_val, dict):
                fn_copy = dict(fn_val)
                fn_copy.pop("callableFrom", None)
                if fn_copy.get("returnType") == "validationResult":
                    fn_copy["returnType"] = "boolean"
                props = fn_copy.get("properties")
                if isinstance(props, dict):
                    props_copy = dict(props)
                    if "@call" in props_copy:
                        props_copy["call"] = props_copy.pop("@call")
                    ret_prop = props_copy.get("returnType")
                    if (
                        isinstance(ret_prop, dict)
                        and ret_prop.get("const") == "validationResult"
                    ):
                        props_copy["returnType"] = {"const": "boolean"}
                    fn_copy["properties"] = props_copy
                req = fn_copy.get("required")
                if isinstance(req, list):
                    fn_copy["required"] = ["call" if r == "@call" else r for r in req]
                lowered_functions[str(fn_name)] = fn_copy
            else:
                lowered_functions[str(fn_name)] = fn_val
        doc["functions"] = lowered_functions

    defs = doc.get("$defs")
    if isinstance(defs, dict):
        any_fn = defs.get("anyFunction")
        if isinstance(any_fn, dict):
            disc = any_fn.get("discriminator")
            if isinstance(disc, dict) and disc.get("propertyName") == "@call":
                disc["propertyName"] = "call"

    return doc


def _raw_catalog_doc(entry: Any) -> tuple[dict[str, Any], str | None]:
    if isinstance(entry, dict) and "catalog" in entry:
        inner = entry["catalog"]
    else:
        inner = entry
    if isinstance(inner, str):
        doc = load_conformance_json(inner)
        default_id = os.path.basename(inner).removesuffix(".json")
        return doc, default_id
    if isinstance(inner, dict):
        return inner, "inline"
    return {}, None


def case_catalog_version(args: Mapping[str, Any]) -> str | None:
    """Returns the declared protocolVersion of the first catalog in args, or None."""
    entry = args.get("catalog")
    if entry is None:
        catalogs = args.get("catalogs")
        if isinstance(catalogs, list) and catalogs:
            entry = catalogs[0]
    if entry is None:
        return None
    doc, _ = _raw_catalog_doc(entry)
    proto = doc.get("protocolVersion")
    return str(proto) if proto is not None else None


def case_declares_v1(args: Mapping[str, Any]) -> bool:
    """Returns True if any catalog in args declares v1.0 or later."""
    entries: list[Any] = []
    if "catalog" in args:
        entries.append(args["catalog"])
    if isinstance(args.get("catalogs"), list):
        entries.extend(args["catalogs"])
    if not entries:
        return True
    for entry in entries:
        doc, _ = _raw_catalog_doc(entry)
        proto = doc.get("protocolVersion")
        if proto is None or _is_version_at_least_1_0(proto):
            return True
    return False


def first_catalog_id(args: Mapping[str, Any], default_catalog: str) -> str | None:
    """Returns the catalogId of the first catalog configured in args."""
    entry = args.get("catalog")
    if entry is None:
        catalogs = args.get("catalogs")
        if isinstance(catalogs, list) and catalogs:
            entry = catalogs[0]
    if entry is None:
        entry = default_catalog
    doc, default_id = _raw_catalog_doc(entry)
    return str(doc.get("catalogId") or default_id) if (doc or default_id) else None


def injected_catalog_id(
    test_case: Mapping[str, Any], default_catalog: str
) -> str | None:
    """Returns the catalogId to inject into v0.9 createSurface payloads, or None."""
    if "catalogId" in json.dumps(test_case):
        return None
    args = test_case.get("args")
    if not isinstance(args, Mapping):
        return None
    return first_catalog_id(args, default_catalog)


def lower_catalog_entry(entry: Any) -> Any:
    """Lowers a catalog entry (path, inline dict, or wrapper with transformers) to v0.9."""
    if isinstance(entry, dict) and "catalog" in entry:
        result = dict(entry)
        result["catalog"] = lower_catalog_entry(entry["catalog"])
        return result
    if isinstance(entry, str):
        doc = load_conformance_json(entry)
        default_id = os.path.basename(entry).removesuffix(".json")
        return lower_catalog_document(doc, default_catalog_id=default_id)
    if isinstance(entry, Mapping):
        return lower_catalog_document(entry, default_catalog_id="inline")
    return entry


def lower_text(text: str, catalog_id: str | None = None) -> str:
    """Lowers a raw JSON payload string from v1.0 to v0.9."""
    lowered = _VERSION_FIELD_RE.sub(
        lambda m: f"{m.group(1)}{swap_version(m.group(2))}{m.group(3)}", text
    )
    lowered = _RESERVED_KEY_FIELD_RE.sub(r'"\1"', lowered)
    if catalog_id is not None:
        lowered = _CREATE_SURFACE_OPEN_RE.sub(
            f'"createSurface": {{"catalogId": {json.dumps(catalog_id)}, ',
            lowered,
        )
    return lowered


def _rename_keys_in(node: Any, *, lower: bool) -> Any:
    if isinstance(node, list):
        return [_rename_keys_in(item, lower=lower) for item in node]
    if isinstance(node, dict):
        is_template = "componentId" in node
        key_map = _RESERVED_KEYS_TO_V09 if lower else _RESERVED_KEYS_TO_V10
        return {
            (k if is_template else key_map.get(k, k)): _rename_keys_in(v, lower=lower)
            for k, v in node.items()
        }
    return node


def _rename_reserved_keys(message: Mapping[str, Any], *, lower: bool) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for k, v in message.items():
        if isinstance(v, dict):
            body: dict[str, Any] = {}
            for field_k, field_v in v.items():
                if field_k in ("components", "callFunction"):
                    body[field_k] = _rename_keys_in(field_v, lower=lower)
                else:
                    body[field_k] = copy.deepcopy(field_v)
            result[k] = body
        else:
            result[k] = copy.deepcopy(v)
    return result


def lower_messages(
    messages: list[dict[str, Any]], default_catalog_id: str | None = None
) -> list[dict[str, Any]]:
    """Lowers a list of v1.0 message dicts into v0.9 message dicts."""
    lowered: list[dict[str, Any]] = []
    for message in messages:
        msg = _rename_reserved_keys(message, lower=True)
        msg["version"] = swap_version(msg.get("version"))
        if isinstance(msg.get("createSurface"), dict):
            create = dict(msg["createSurface"])
            components = create.pop("components", None)
            data_model = create.pop("dataModel", None)
            if default_catalog_id is not None and "catalogId" not in create:
                create["catalogId"] = default_catalog_id
            surface_id = create.get("surfaceId")
            lowered.append({"version": msg["version"], "createSurface": create})
            if components is not None:
                lowered.append({
                    "version": msg["version"],
                    "updateComponents": {
                        "surfaceId": surface_id,
                        "components": components,
                    },
                })
            if data_model is not None:
                lowered.append({
                    "version": msg["version"],
                    "updateDataModel": {
                        "surfaceId": surface_id,
                        "path": "/",
                        "value": data_model,
                    },
                })
        else:
            lowered.append(msg)
    return lowered


def lift_messages(
    messages: list[Any],
    *,
    join: bool = False,
    injected_catalog_id: str | None = None,
) -> list[dict[str, Any]]:
    """Lifts v0.9 message dicts or models back to the v1.0 conformance shape."""
    raw_dicts = (
        to_message_dicts(messages)
        if messages and hasattr(messages[0], "model_dump")
        else [dict(m) for m in messages]
    )
    lifted: list[dict[str, Any]] = []
    for raw_msg in raw_dicts:
        msg = _rename_reserved_keys(raw_msg, lower=False)
        last_create = (
            lifted[-1].get("createSurface")
            if lifted and isinstance(lifted[-1].get("createSurface"), dict)
            else None
        )
        last_surface_id = last_create.get("surfaceId") if last_create else None

        upd_comp = msg.get("updateComponents")
        if (
            join
            and last_create is not None
            and isinstance(upd_comp, dict)
            and upd_comp.get("surfaceId") == last_surface_id
            and "components" not in last_create
        ):
            last_create["components"] = upd_comp.get("components")
            continue

        upd_dm = msg.get("updateDataModel")
        if (
            join
            and last_create is not None
            and isinstance(upd_dm, dict)
            and upd_dm.get("surfaceId") == last_surface_id
            and upd_dm.get("path") == "/"
            and "dataModel" not in last_create
        ):
            last_create["dataModel"] = upd_dm.get("value")
            continue

        if isinstance(msg.get("createSurface"), dict):
            create = {
                k: v
                for k, v in msg["createSurface"].items()
                if not (k == "sendDataModel" and v is False)
                and not (
                    injected_catalog_id is not None
                    and k == "catalogId"
                    and v == injected_catalog_id
                )
            }
            lifted.append({
                "version": swap_version(msg.get("version")),
                "createSurface": create,
            })
        else:
            lifted_msg = dict(msg)
            lifted_msg["version"] = swap_version(msg.get("version"))
            lifted.append(lifted_msg)
    return lifted


def lift_parts(
    parts: list[dict[str, Any]],
    *,
    join: bool = False,
    injected_catalog_id: str | None = None,
) -> list[dict[str, Any]]:
    """Lifts parsed response parts from v0.9 to v1.0."""
    lifted: list[dict[str, Any]] = []
    for part in parts:
        if "a2ui" in part:
            lifted.append({
                "a2ui": lift_messages(
                    part["a2ui"],
                    join=join,
                    injected_catalog_id=injected_catalog_id,
                )
            })
        else:
            lifted.append(part)
    return lifted


def lower_capabilities(capabilities: Mapping[str, Any]) -> dict[str, Any]:
    """Lowers renderer capabilities keyed by protocol version."""
    return {str(swap_version(k)): copy.deepcopy(v) for k, v in capabilities.items()}


def v09_skip_reason(suite: str, case: Mapping[str, Any]) -> str | None:
    """Returns a skip reason if the case cannot run lowered to v0.9, or None."""
    name = str(case.get("name", ""))
    if name in V1_ONLY_CASES:
        return V1_ONLY_CASES[name]
    if suite == "agent/multi_catalog_formats.yaml":
        return _ONE_CATALOG_PER_SURFACE
    args = case.get("args")
    if isinstance(args, Mapping):
        if isinstance(args.get("catalogs"), list) and len(args["catalogs"]) > 1:
            return _ONE_CATALOG_PER_SURFACE
        fmt = args.get("format")
        if fmt in ("elemental", "atom"):
            return f"Experimental format {fmt} does not target lowered v0.9 suites."
        cat_ver = case_catalog_version(args)
        if cat_ver in ("0.8", "v0.8", "0.9", "v0.9"):
            return f"Case already targets protocol version {cat_ver}."
        if fmt == "direct_json" and case.get("action") == "generate_prompt_snippet":
            return (
                "The Direct JSON snippet embeds the schemas of the catalogs'"
                " version, so the case runs as written in v1.0 only."
            )
    if '"callRendererFunction"' in json.dumps(case):
        return "Protocol v0.9 has no callRendererFunction message."
    return None


def lower_case(
    case: Mapping[str, Any],
    default_catalog: str = "test_data/catalogs/simplified_catalog_v1_0.json",
) -> dict[str, Any]:
    """Lowers a v1.0 conformance case dictionary so its inputs target v0.9."""
    lowered = copy.deepcopy(dict(case))
    args = dict(lowered.get("args", {}))
    fmt = args.get("format")
    action = lowered.get("action")

    inj_id = (
        injected_catalog_id(case, default_catalog) if fmt == "direct_json" else None
    )
    default_cat_id = first_catalog_id(args, default_catalog)

    if "catalog" in args:
        args["catalog"] = lower_catalog_entry(args["catalog"])
    elif "catalogs" in args and isinstance(args["catalogs"], list):
        args["catalogs"] = [lower_catalog_entry(c) for c in args["catalogs"]]
    else:
        args["catalog"] = lower_catalog_entry(default_catalog)

    if isinstance(args.get("renderer_capabilities"), Mapping):
        args["renderer_capabilities"] = lower_capabilities(
            args["renderer_capabilities"]
        )

    lowered["args"] = args

    if fmt == "direct_json":
        if action in ("compile", "parse_response") and isinstance(
            lowered.get("input"), str
        ):
            lowered["input"] = lower_text(lowered["input"], catalog_id=inj_id)
        elif action == "parse_chunk" and isinstance(lowered.get("steps"), list):
            lowered_steps = []
            for step in lowered["steps"]:
                step_copy = dict(step)
                if isinstance(step_copy.get("input"), str):
                    step_copy["input"] = lower_text(
                        step_copy["input"], catalog_id=inj_id
                    )
                lowered_steps.append(step_copy)
            lowered["steps"] = lowered_steps

    if action == "decompile" and isinstance(lowered.get("messages"), list):
        lowered["messages"] = lower_messages(
            lowered["messages"], default_catalog_id=default_cat_id
        )

    return lowered
