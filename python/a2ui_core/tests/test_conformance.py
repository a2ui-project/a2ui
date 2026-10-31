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

from collections.abc import Callable, Mapping
import contextlib
import glob
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

from pydantic import TypeAdapter
import pytest
import yaml

from a2ui.core.basic_catalog import v0_8, v0_9, v1_0
from a2ui.core.catalog import Catalog, CatalogApi
from a2ui.core.common import to_canonical_version
from a2ui.core.exceptions import (
    A2uiCatalogError,
    A2uiDataError,
    A2uiError,
    A2uiExpressionError,
    A2uiIntegrityError,
    A2uiParseError,
    A2uiRecursionError,
    A2uiStateError,
    A2uiValidationError,
)
from a2ui.core.processing import (
    CapabilitiesOptions,
    MessageProcessor,
    MessageProcessorOptions,
)
from a2ui.core.resolution import DataContext
from a2ui.core.schema import ProtocolVersion
from a2ui.core.schema.v0_9 import ClientToServerMessage
from a2ui.core.schema.v1_0 import RendererToAgentMessage
from a2ui.core.state import DataModel, SurfaceModel
from a2ui.core.validation import (
    RELAXED_VALIDATION,
    STRICT_VALIDATION,
    PayloadValidator,
    ValidationConfig,
)

try:
    from .node_resolution_runner import run_node_resolution_case
except ImportError:
    import importlib.util as _importlib_util

    _nr_spec = _importlib_util.spec_from_file_location(
        "node_resolution_runner",
        os.path.join(os.path.dirname(__file__), "node_resolution_runner.py"),
    )
    assert _nr_spec and _nr_spec.loader
    _nr_mod = _importlib_util.module_from_spec(_nr_spec)
    _nr_spec.loader.exec_module(_nr_mod)
    run_node_resolution_case = _nr_mod.run_node_resolution_case

CATEGORY_TO_EXCEPTION = {
    "ParseError": (A2uiParseError, A2uiExpressionError),
    "ValidationError": (A2uiValidationError,),
    "CatalogError": (A2uiCatalogError,),
    "IntegrityError": (A2uiIntegrityError, A2uiRecursionError),
    "RecursionError": (A2uiRecursionError,),
    "DataError": (A2uiDataError,),
    "StateError": (A2uiStateError,),
    "ExpressionError": (A2uiExpressionError,),
}

SUPPORTED_PROTOCOL_VERSIONS = {
    "v0.8",
    "v0.9",
    "v0.9.1",
    "v1.0",
    "0.8",
    "0.9",
    "0.9.1",
    "1.0",
}

# Suites the core library cannot meaningfully execute, with the reason for each.
UNRUNNABLE_SUITES: dict[str, str] = {
    "core/accessibility.yaml": (
        "Accessibility attributes are applied by the UI framework renderers"
        " (Lit, React, Angular, Flutter, SwiftUI), which the core library does"
        " not have access to. Pending v1.0 catalogs for those renderers."
    ),
    "core/adapter_conformance.yaml": "UI framework adapter suite",
}

# Individual `<suite>#<case>` entries that use an optional feature or key the
# Python core SDK does not implement. Checked before `_assert_known_keys` and
# recorded as `skipped` with their reason.
UNSUPPORTED: dict[str, str] = {
    "core/message_processor_v1_0.yaml#test_v10_call_validation_config_relaxes_strict_processor": (
        "Per-call validationConfig on process_messages is an optional"
        " renderer-app feature not implemented by the Python core SDK."
    ),
    "core/message_processor_v1_0.yaml#test_v10_call_validation_config_tightens_permissive_processor": (
        "Per-call validationConfig on process_messages is an optional"
        " renderer-app feature not implemented by the Python core SDK."
    ),
    "core/message_processor_v1_0.yaml#test_v10_call_validation_config_leaves_out_rules_as_strict": (
        "Per-call validationConfig on process_messages is an optional"
        " renderer-app feature not implemented by the Python core SDK."
    ),
}

# Individual `<suite>#<case>` entries that exercise a real behavioural gap in
# the Python core SDK. Executed strictly and recorded as `xfailed`.
EXPECTED_FAILURES: dict[str, str] = {
    "core/validator_v0_8.yaml#test_v08_topology_plain_string_property_not_treated_as_child_ref": (
        "Python core v0.8 topology checks read a string property as a child"
        " reference when it names a component on the surface."
    ),
    "core/validator_v0_8.yaml#test_v08_topology_plain_string_property_does_not_close_cycle": (
        "Python core v0.8 topology checks read a string property as a child"
        " reference when it names a component on the surface."
    ),
    "core/rpc_functions.yaml#test_rpc_ui_binding_triggers_call_agent_function_async_resolution": (
        "Python DataContext does not route undeclared component binding"
        " function calls through MessageProcessor.call_agent_function."
    ),
    "core/rpc_functions.yaml#test_rpc_ui_action_missing_local_function_fallback_to_agent": (
        "Python DataContext.resolve_action does not fall back to"
        " MessageProcessor.call_agent_function when a function is not"
        " registered locally."
    ),
}

_CASE_METADATA_KEYS: frozenset[str] = frozenset({
    "name",
    "description",
    "features",
})

_CURRENT_CASE_KEY: str = ""


def _assert_known_keys(
    obj: Mapping[str, Any],
    allowed: frozenset[str],
    where: str,
    case_key: str | None = None,
) -> None:
    target = case_key or _CURRENT_CASE_KEY or str(obj.get("name", "<unknown>"))
    for key in obj:
        if key not in allowed:
            pytest.fail(f"Unknown {where} '{key}' in {target}")


# Actions that time an operation rather than check what it returns. Their cases
# run in `test_conformance_timing`, which is marked `performance` and so runs
# only under `uv run pytest -m performance` (see timing_harness.py).
TIMING_ACTIONS = {"measure_growth", "measure_overhead"}

# Root core conformance directory resolution
CONFORMANCE_ROOT = os.environ.get(
    "CONFORMANCE_ROOT",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../conformance")),
)
SPEC_ROOT = os.environ.get(
    "SPEC_ROOT",
    os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../specification")),
)
CORE_DIR = os.path.join(CONFORMANCE_ROOT, "core")


def _version_dir(ver: str) -> str:
    v = ver.lower().replace(".", "_")
    return v if v.startswith("v") else f"v{v}"


basic_catalog = v0_9.BasicCatalog()
v08_catalog = v0_8.BasicCatalog()
v09_catalog = v0_9.BasicCatalog()
v10_catalog = v1_0.BasicCatalog()
ALL_CATALOGS = [basic_catalog, v08_catalog, v09_catalog, v10_catalog]


def find_yaml_files(dir_path: str) -> list[str]:
    results = []
    if not os.path.exists(dir_path):
        return results
    for root, _, files in os.walk(dir_path):
        for file in files:
            if file.endswith(".yaml") or file.endswith(".yml"):
                results.append(os.path.join(root, file))
    return sorted(results)


def _protocol_version_from_catalogs_list(catalogs: Any) -> str | None:
    if not isinstance(catalogs, list):
        return None
    for cat in catalogs:
        if isinstance(cat, dict) and cat.get("protocolVersion"):
            return str(cat["protocolVersion"])
    return None


def _protocol_version_from_catalog_id(cat_id: str) -> str:
    if "v08" in cat_id or "v0_8" in cat_id:
        return "v0.8"
    if "v09" in cat_id or "v0_9" in cat_id:
        return "v0.9"
    if "v10" in cat_id or "v1_0" in cat_id or "v1.0" in cat_id:
        return "1.0"
    return "v0.9"


def resolve_protocol_version(case: dict[str, Any]) -> str | None:
    if case.get("protocolVersion"):
        return str(case["protocolVersion"])
    cat_spec = case.get("catalog") if isinstance(case.get("catalog"), dict) else {}
    if cat_spec.get("protocolVersion"):
        return str(cat_spec["protocolVersion"])
    c_schema = (
        case.get("catalogSchema") if isinstance(case.get("catalogSchema"), dict) else {}
    )
    if c_schema.get("protocolVersion"):
        return str(c_schema["protocolVersion"])
    from_list = _protocol_version_from_catalogs_list(case.get("catalogs"))
    if from_list:
        return from_list
    cat_id = str(
        case.get("catalogId")
        or cat_spec.get("catalogId")
        or c_schema.get("catalogId")
        or ""
    )
    return _protocol_version_from_catalog_id(cat_id)


def resolve_catalog_id(case: dict[str, Any]) -> str | None:
    cat_spec = case.get("catalog") if isinstance(case.get("catalog"), dict) else {}
    c_schema = (
        cat_spec.get("catalogSchema")
        if isinstance(cat_spec.get("catalogSchema"), dict)
        else {}
    )
    return (
        case.get("catalogId") or cat_spec.get("catalogId") or c_schema.get("catalogId")
    )


SUITE_LOAD_ERRORS: list[str] = []
"""Problems encountered while loading suites, reported by `test_all_suites_load`.

Collected rather than raised so that a single malformed suite does not abort
collection of every other case.
"""


def load_conformance_cases() -> list[tuple[str, str, dict[str, Any]]]:
    cases = []
    yaml_files = find_yaml_files(CORE_DIR)
    if not yaml_files:
        SUITE_LOAD_ERRORS.append(f"No conformance suites found under {CORE_DIR}")
    for file_path in yaml_files:
        rel_path = os.path.relpath(file_path, CONFORMANCE_ROOT).replace(os.sep, "/")
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except Exception as err:
            SUITE_LOAD_ERRORS.append(f"{rel_path}: failed to parse: {err}")
            continue

        if not isinstance(data, list):
            SUITE_LOAD_ERRORS.append(
                f"{rel_path}: expected a list of test cases, got {type(data).__name__}"
            )
            continue

        for index, case in enumerate(data):
            if not isinstance(case, dict):
                SUITE_LOAD_ERRORS.append(f"{rel_path}: entry {index} is not a mapping")
                continue
            name = case.get("name")
            if not name:
                SUITE_LOAD_ERRORS.append(f"{rel_path}: entry {index} has no 'name'")
                continue

            test_id = f"{rel_path}::{name}"
            cases.append((test_id, rel_path, case))
    return cases


def _build_inline_catalog(
    spec: dict[str, Any],
    c_id: str,
    p_ver: str,
    action: str | None,
    forbid_unlisted_functions: bool = False,
) -> Any:
    c_comps = spec.get("components")
    c_theme = spec.get("theme")
    c_funcs = spec.get("functions")
    if c_comps or c_theme or c_funcs:
        c_schema: dict[str, Any] = {"catalogId": c_id}
        if forbid_unlisted_functions and not c_funcs:
            c_schema["$defs"] = {"anyFunction": {"not": {}}}
        if c_comps:
            c_schema["components"] = c_comps
        if c_theme:
            c_schema["theme"] = c_theme
        if c_funcs:
            c_schema["functions"] = c_funcs
        return Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)
    is_cap = action in ("get_client_capabilities", "get_renderer_capabilities")
    default_comps = [] if is_cap else list(basic_catalog.components.values())
    return Catalog(catalog_id=c_id, protocol_version=p_ver, components=default_comps)


def _load_single_catalog_spec(
    case: dict[str, Any],
    catalogs_map: dict[str, Any],
    specified_catalogs: list[Any],
) -> None:
    cat_spec = case.get("catalog")
    if not isinstance(cat_spec, dict):
        return
    p_ver = resolve_protocol_version(case) or "v0.9"
    if "catalogSchema" in cat_spec:
        c_id = resolve_catalog_id(case) or f"catalog-{case.get('name')}"
        if c_id:
            cat = Catalog.from_json(
                cat_spec["catalogSchema"], catalog_id=c_id, protocol_version=p_ver
            )
            catalogs_map[c_id] = cat
            specified_catalogs.append(cat)
    elif "components" in cat_spec or "catalogId" in cat_spec:
        c_id = (
            cat_spec.get("catalogId")
            or resolve_catalog_id(case)
            or f"catalog-{case.get('name')}"
        )
        cat = _build_inline_catalog(
            cat_spec,
            c_id,
            p_ver,
            case.get("action"),
            forbid_unlisted_functions=True,
        )
        catalogs_map[c_id] = cat
        specified_catalogs.append(cat)


def _load_catalogs_list_spec(
    case: dict[str, Any],
    version: str,
    catalogs_map: dict[str, Any],
    specified_catalogs: list[Any],
) -> None:
    catalogs_list = case.get("catalogs")
    if not isinstance(catalogs_list, list):
        return
    for item in catalogs_list:
        if not isinstance(item, dict):
            continue
        if "catalogSchema" in item:
            c_schema = item["catalogSchema"]
            c_id = c_schema.get("catalogId") or item.get("catalogId")
            p_ver = (
                item.get("protocolVersion") or c_schema.get("protocolVersion") or "v0.9"
            )
            if c_id:
                cat = Catalog.from_json(
                    c_schema, catalog_id=c_id, protocol_version=p_ver
                )
                catalogs_map[c_id] = cat
                specified_catalogs.append(cat)
        elif "catalogId" in item:
            c_id = item["catalogId"]
            p_ver = item.get("protocolVersion") or version
            cat = _build_inline_catalog(item, c_id, p_ver, case.get("action"))
            catalogs_map[c_id] = cat
            specified_catalogs.append(cat)


def _basic_catalog_for_version(p_ver: str) -> Any:
    if "1.0" in p_ver:
        return v10_catalog
    if "0.8" in p_ver:
        return v08_catalog
    return v09_catalog


def _load_catalog_paths_spec(
    case: dict[str, Any],
    catalogs_map: dict[str, Any],
    specified_catalogs: list[Any],
) -> None:
    paths = case.get("catalogPaths")
    if not isinstance(paths, list):
        return
    basic_ids = {
        v10_catalog.catalog_id,
        v09_catalog.catalog_id,
        v08_catalog.catalog_id,
    }
    p_ver = resolve_protocol_version(case) or "v0.9"
    for p in paths:
        full_p = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", p))
        if not os.path.exists(full_p):
            raise FileNotFoundError(
                f"catalogPaths entry '{p}' does not exist (resolved to {full_p})"
            )
        with open(full_p, "r", encoding="utf-8") as f:
            c_json = json.load(f)
        c_id = c_json.get("catalogId") or c_json.get("id") or "test-catalog"
        if c_id in basic_ids or "basic/catalog.json" in p:
            matching_basic = _basic_catalog_for_version(p_ver)
            specified_catalogs.append(matching_basic)
            catalogs_map[c_id] = matching_basic
            continue
        cat = Catalog.from_json(c_json, catalog_id=c_id, protocol_version=p_ver)
        specified_catalogs.append(cat)
        if c_id != "test-catalog":
            test_cat = Catalog.from_json(
                c_json, catalog_id="test-catalog", protocol_version=p_ver
            )
            catalogs_map["test-catalog"] = test_cat
            specified_catalogs.append(test_cat)


def _collect_case_messages(case: dict[str, Any]) -> list[Any]:
    raw_msgs = case.get("messages") or ([case["payload"]] if "payload" in case else [])
    messages: list[Any] = list(raw_msgs) if isinstance(raw_msgs, list) else [raw_msgs]
    for step in case.get("steps") or []:
        msgs = step.get("messages") or step.get("payload")
        if isinstance(msgs, list):
            messages.extend(msgs)
        elif isinstance(msgs, dict):
            messages.append(msgs)
    return messages


def _record_message_catalog_ids(
    item: dict[str, Any],
    scan_version: str | None,
    add_catalog_id: Callable[[str, str | None], None],
) -> None:
    for key in ("createSurface", "beginRendering"):
        sub = item.get(key)
        if isinstance(sub, dict) and "catalogId" in sub:
            add_catalog_id(sub["catalogId"], scan_version)


def _scan_messages_for_catalog_ids(
    messages: list[Any],
    is_catalog_error_case: bool,
    add_catalog_id: Callable[[str, str | None], None],
) -> None:
    scan_version: str | None = None
    stack: list[Any] = list(reversed(messages))
    while stack:
        item = stack.pop()
        if isinstance(item, list):
            stack.extend(reversed(item))
            continue
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("version"), str):
            scan_version = item["version"]
        if "messages" in item:
            stack.append(item["messages"])
        if not is_catalog_error_case:
            _record_message_catalog_ids(item, scan_version, add_catalog_id)


def _base_catalogs_map(version: str) -> dict[str, Any]:
    catalogs_map: dict[str, Any] = {
        cat.catalog_id: cat for cat in ALL_CATALOGS if hasattr(cat, "catalog_id")
    }
    catalogs_map["basic"] = basic_catalog
    catalogs_map["standard"] = Catalog(
        catalog_id="standard",
        protocol_version="v0.9",
        components=list(basic_catalog.components.values()),
    )
    catalogs_map["v0.8:basic"] = v08_catalog
    catalogs_map["v0.9:basic"] = v09_catalog
    catalogs_map["v1.0:basic"] = v10_catalog
    if version in ("1.0", "v1.0"):
        catalogs_map["basic"] = Catalog(
            catalog_id="basic",
            protocol_version="1.0",
            components=list(v10_catalog.components.values()),
            functions=list(v10_catalog.functions.values()),
        )
    return catalogs_map


def get_catalogs_for_test_case(case: dict[str, Any]) -> list[Any]:
    version = resolve_protocol_version(case) or "v0.9"
    cur_basic = _basic_catalog_for_version(version)
    catalogs_map = _base_catalogs_map(version)

    def add_catalog_id(cat_id: str, ver: str | None = None) -> None:
        has_exact_id = any(
            getattr(c, "catalog_id", None) == cat_id for c in catalogs_map.values()
        )
        if not cat_id or has_exact_id:
            return
        catalogs_map[cat_id] = Catalog(
            catalog_id=cat_id,
            protocol_version=ver or version,
            components=list(cur_basic.components.values()),
        )

    specified_catalogs: list[Any] = []
    _load_single_catalog_spec(case, catalogs_map, specified_catalogs)
    _load_catalogs_list_spec(case, version, catalogs_map, specified_catalogs)
    _load_catalog_paths_spec(case, catalogs_map, specified_catalogs)

    expect_err = case.get("expectError")
    is_cat_err = isinstance(expect_err, dict) and expect_err.get("category") in (
        "CatalogError",
        "A2uiCatalogError",
    )
    _scan_messages_for_catalog_ids(
        _collect_case_messages(case), is_cat_err, add_catalog_id
    )
    if (
        case.get("action") in ("get_client_capabilities", "get_renderer_capabilities")
        and specified_catalogs
    ):
        return specified_catalogs
    extra = [
        c
        for c in catalogs_map.values()
        if c not in specified_catalogs and c != cur_basic
    ]
    return specified_catalogs + [cur_basic] + extra


def _error_message_matches(expected: str, actual: str) -> bool:
    """Whether an expected error message matches an emitted one.

    The suites state a message in one SDK's wording; the alternations below
    reconcile the phrasing the other SDKs use for the same condition.
    """
    exp_m = expected.lower().replace('"', "'").replace("','", "', '")
    act_m = actual.lower().replace('"', "'").replace("','", "', '")
    if exp_m in act_m:
        return True
    return (
        (
            "not of type" in exp_m
            and any(t in act_m for t in ("input should be", "type_mismatch", "must be"))
        )
        or (
            "is a required property" in exp_m
            and any(t in act_m for t in ("field required", "missing"))
        )
        or ("non-dict" in exp_m and ("primitive" in act_m or "non-dict" in act_m))
        or ("orphan" in exp_m and ("orphan" in act_m or "not reachable" in act_m))
        or ("circular" in exp_m and ("circular" in act_m or "self-reference" in act_m))
    )


def _assert_renderer_error_message(
    exp_re: dict[str, Any], err_obj: dict[str, Any]
) -> None:
    if "message" not in exp_re or not exp_re["message"]:
        return
    assert _error_message_matches(
        str(exp_re["message"]), str(err_obj.get("message") or "")
    ), (
        f"rendererError.message expected '{exp_re['message']}' in"
        f" '{err_obj.get('message')}'"
    )


def _renderer_error_path_matches(
    expected: str, actual: Any, err_details: list[Any]
) -> bool:
    """Whether an emitted `rendererError.error.path` matches the expected one.

    A missing required field is reported at the field in Python and at the
    component in the other SDKs, so the parent pointer of a `missing_field`
    detail is accepted as well.
    """
    if actual == expected:
        return True
    if not isinstance(actual, str):
        return False
    for d in err_details:
        if getattr(d, "code", None) != "missing_field":
            continue
        m = re.match(r"^'([^']+)' is a required property", getattr(d, "message", ""))
        if m and actual == f"{expected}/{m.group(1)}":
            return True
    return False


_EXPECT_ERROR_KEYS: frozenset[str] = frozenset({
    "category",
    "code",
    "details",
    "functionCallId",
    "message",
    "path",
    "rendererError",
    "surfaceId",
})
_EXPECT_ERROR_DETAIL_KEYS: frozenset[str] = frozenset({
    "code",
    "message",
    "path",
    "surfaceId",
})
_RENDERER_ERROR_ENVELOPE_KEYS: frozenset[str] = frozenset({
    "version",
    "error",
})
_RENDERER_ERROR_BODY_KEYS: frozenset[str] = frozenset({
    "code",
    "functionCallId",
    "message",
    "path",
    "surfaceId",
})


def _assert_renderer_error(
    exp_re: dict[str, Any],
    captured_renderer_errors: list[dict[str, Any]] | None,
    err_details: list[Any] | None = None,
) -> None:
    if "error" in exp_re:
        _assert_known_keys(exp_re, _RENDERER_ERROR_ENVELOPE_KEYS, "rendererError key")
        _assert_known_keys(
            exp_re["error"], _RENDERER_ERROR_BODY_KEYS, "rendererError.error key"
        )
    else:
        _assert_known_keys(exp_re, _RENDERER_ERROR_BODY_KEYS, "rendererError key")
    assert (
        captured_renderer_errors
    ), f"Expected rendererError {exp_re!r} to be emitted, but none was captured."
    msg = captured_renderer_errors[-1]
    ver = str(msg.get("version") or "v0.9")
    schema_cls = RendererToAgentMessage if "1.0" in ver else ClientToServerMessage
    TypeAdapter(schema_cls).validate_python(msg)
    if "version" in exp_re:
        assert msg.get("version") == exp_re["version"], (
            f"rendererError.version expected {exp_re['version']!r},"
            f" got {msg.get('version')!r}"
        )
    # The expectation is an envelope (`version` + `error`); older cases state
    # the error fields at the top level.
    exp_err = exp_re.get("error", exp_re)
    err_obj = msg.get("error") or {}
    for key in ("code", "surfaceId", "functionCallId"):
        if key in exp_err:
            assert err_obj.get(key) == exp_err[key], (
                f"rendererError.{key} expected {exp_err[key]!r}, got"
                f" {err_obj.get(key)!r}"
            )
    if "path" in exp_err:
        assert _renderer_error_path_matches(
            exp_err["path"], err_obj.get("path"), err_details or []
        ), (
            f"rendererError.path expected {exp_err['path']!r}, got"
            f" {err_obj.get('path')!r}"
        )
    if "functionCallId" in exp_err and "surfaceId" not in exp_err:
        assert err_obj.get("surfaceId") is None, (
            "rendererError.surfaceId expected to be absent for a function call"
            f" error, got {err_obj.get('surfaceId')!r}"
        )
    _assert_renderer_error_message(exp_err, err_obj)


def _candidate_detail_paths(d: Any) -> list[str]:
    paths = [d.path]
    if getattr(d, "code", None) == "missing_field":
        m = re.match(r"^'([^']+)' is a required property", getattr(d, "message", ""))
        if m:
            paths.append(f"{d.path}.{m.group(1)}" if d.path else m.group(1))
    return paths


def _detail_path_matches(d: Any, exp_path_val: str | None) -> bool:
    from a2ui.core.processing.format_pydantic_error import to_json_pointer

    if exp_path_val is None:
        return True
    for actual_path in _candidate_detail_paths(d):
        if actual_path == exp_path_val or to_json_pointer(
            actual_path
        ) == to_json_pointer(exp_path_val):
            return True
        if actual_path.startswith("components."):
            rel = ".".join(actual_path.split(".")[2:])
            if rel == exp_path_val or to_json_pointer(rel) == exp_path_val:
                return True
    return False


def _detail_matches_expected(d: Any, exp_d: dict[str, Any]) -> bool:
    if not _detail_path_matches(d, exp_d.get("path")):
        return False
    exp_code = exp_d.get("code")
    code_ok = (
        exp_code is None
        or d.code == exp_code
        or (
            exp_code == "invalid_value"
            and d.code in ("type_mismatch", "unrecognized_component")
        )
    )
    if not code_ok:
        return False
    exp_msg = exp_d.get("message")
    return exp_msg is None or exp_msg.lower() in d.message.lower()


def _assert_error_details_list(
    expected_details: list[Any], err_details: list[Any]
) -> None:
    for exp_d in expected_details:
        if isinstance(exp_d, dict):
            _assert_known_keys(
                exp_d, _EXPECT_ERROR_DETAIL_KEYS, "expectError.details[] key"
            )
            assert any(
                _detail_matches_expected(d, exp_d) for d in err_details
            ), f"Expected detail {exp_d!r} not found in {err_details!r}"


def _assert_error_scalar_fields(
    expect_error: dict[str, Any], exc_val: Any, err_details: list[Any]
) -> None:
    if expect_error.get("code"):
        expected_code = expect_error["code"]
        detail_codes = [d.code for d in err_details]
        exc_code = getattr(exc_val, "code", None)
        assert (
            expected_code in detail_codes
            or expected_code == exc_code
            or expected_code in str(exc_val)
        ), f"Expected error code '{expected_code}' not found"
    if expect_error.get("path") is not None:
        exp_path = expect_error["path"]
        exc_path = getattr(exc_val, "path", None)
        detail_paths = [d.path for d in err_details]
        assert exc_path == exp_path or exp_path in detail_paths, (
            f"Expected error path {exp_path!r}, got path={exc_path!r},"
            f" details={detail_paths!r}"
        )


def _assert_error_dict_expectations(
    expect_error: dict[str, Any],
    exc_val: Any,
    captured_renderer_errors: list[dict[str, Any]] | None,
) -> None:
    err_details = getattr(exc_val, "details", []) or []
    _assert_error_scalar_fields(expect_error, exc_val, err_details)
    if expect_error.get("surfaceId") is not None:
        exp_sid = expect_error["surfaceId"]
        exc_sid = getattr(exc_val, "surface_id", None)
        detail_sids = [getattr(d, "surface_id", None) for d in err_details]
        assert (
            exc_sid == exp_sid or exp_sid in detail_sids
        ), f"Expected error surfaceId {exp_sid!r}, got surface_id={exc_sid!r}"
    if expect_error.get("functionCallId") is not None:
        assert (
            getattr(exc_val, "function_call_id", None) == expect_error["functionCallId"]
        )
    if isinstance(expect_error.get("details"), list):
        _assert_error_details_list(expect_error["details"], err_details)
    if isinstance(expect_error.get("rendererError"), dict):
        _assert_renderer_error(
            expect_error["rendererError"], captured_renderer_errors, err_details
        )


def _assert_exception_code(exc: Any, expected_code: str) -> None:
    err_details = getattr(exc, "details", [])
    err_code = getattr(exc, "code", None)
    in_details = bool(err_details) and any(
        getattr(d, "code", None) == expected_code for d in err_details
    )
    assert (
        err_code == expected_code or expected_code in str(exc) or in_details
    ), f"Expected error code '{expected_code}' not found in exception '{exc}'"


def _exception_matches_expected_message(exc: Any, message: str) -> bool:
    msg_norm = message.lower()
    err_details = getattr(exc, "details", [])
    detail_msgs = (
        " ".join(d.message for d in err_details).lower() if err_details else ""
    )
    err_str = f"{str(exc).lower()} {detail_msgs}"
    if _error_message_matches(message, err_str):
        return True
    if err_details and any(message in d.message for d in err_details):
        return True
    if re.search(message, str(exc)):
        return True
    return _fuzzy_error_message_matches(msg_norm, err_str)


def _fuzzy_error_message_matches(msg_norm: str, err_str: str) -> bool:
    if "additional properties are not allowed" in msg_norm:
        return "extra" in err_str
    if "was unexpected" in msg_norm:
        return "unrecognized" in err_str or "unexpected" in err_str
    if "cannot contain child" in msg_norm:
        return "cannot contain child" in err_str
    if "cannot be placed under parent" in msg_norm:
        return "cannot be placed under parent" in err_str
    if "protocol version mismatch" in msg_norm or "mismatched protocol" in msg_norm:
        return (
            "mismatched protocol" in err_str or "protocol version mismatch" in err_str
        )
    return False


@contextlib.contextmanager
def assert_raises(
    expect_error: Any,
    captured_renderer_errors: list[dict[str, Any]] | None = None,
):
    if isinstance(expect_error, dict):
        _assert_known_keys(expect_error, _EXPECT_ERROR_KEYS, "expectError key")
        category = expect_error.get("category")
        message = expect_error.get("message", "")
        expected_class = CATEGORY_TO_EXCEPTION.get(category, (A2uiError, ValueError))
    else:
        expected_class = (A2uiError, ValueError)
        message = str(expect_error)

    with pytest.raises(expected_class) as excinfo:
        yield

    if isinstance(expect_error, dict) and expect_error.get("code"):
        _assert_exception_code(excinfo.value, expect_error["code"])

    if message:
        assert _exception_matches_expected_message(
            excinfo.value, message
        ), f"Expected error '{message}' not found in exception '{excinfo.value}'"

    if isinstance(expect_error, dict):
        _assert_error_dict_expectations(
            expect_error, excinfo.value, captured_renderer_errors
        )


ALL_CONFORMANCE_CASES = load_conformance_cases()
CONFORMANCE_CASES = [
    c for c in ALL_CONFORMANCE_CASES if c[2].get("action") not in TIMING_ACTIONS
]
TIMING_CASES = [
    c for c in ALL_CONFORMANCE_CASES if c[2].get("action") in TIMING_ACTIONS
]


def test_all_suites_load() -> None:
    """Every conformance suite parses into a list of named test cases."""
    assert not SUITE_LOAD_ERRORS, "Conformance suites failed to load:\n" + "\n".join(
        SUITE_LOAD_ERRORS
    )


def test_unsupported_and_expected_failures_are_used() -> None:
    """Every UNRUNNABLE_SUITES, UNSUPPORTED, and EXPECTED_FAILURES entry must match a loaded case."""
    loaded_suites = {rel_path for _, rel_path, _ in ALL_CONFORMANCE_CASES}
    loaded_keys = {
        f"{rel_path}#{case.get('name')}" for _, rel_path, case in ALL_CONFORMANCE_CASES
    }
    unused_suites = sorted(set(UNRUNNABLE_SUITES) - loaded_suites)
    assert not unused_suites, f"Unused UNRUNNABLE_SUITES entries: {unused_suites}"
    unused_unsupported = sorted(set(UNSUPPORTED) - loaded_keys)
    assert not unused_unsupported, f"Unused UNSUPPORTED entries: {unused_unsupported}"
    unused_xfails = sorted(set(EXPECTED_FAILURES) - loaded_keys)
    assert not unused_xfails, f"Unused EXPECTED_FAILURES entries: {unused_xfails}"


def _validate_resolve_nodes_case(case: dict[str, Any]) -> None:
    run_node_resolution_case(case, Path(CONFORMANCE_ROOT))


def _dispatch_conformance_action(
    rel_path: str, action: str, case: dict[str, Any]
) -> None:
    if action == "resolve_nodes":
        assert (
            rel_path == "core/node_resolution.yaml"
        ), "resolve_nodes is only supported in core/node_resolution.yaml"
    handler = _ACTION_HANDLERS.get(action)
    if handler is None:
        pytest.fail(
            f"Action '{action}' has no handler in the core Python harness."
            " Add one, or add the suite to UNRUNNABLE_SUITES with a reason."
        )
    handler(case)


@pytest.mark.parametrize(
    "test_id, rel_path, case",
    CONFORMANCE_CASES,
    ids=[c[0] for c in CONFORMANCE_CASES],
)
def test_conformance_suite(test_id: str, rel_path: str, case: dict[str, Any]) -> None:
    global _CURRENT_CASE_KEY
    case_key = f"{rel_path}#{case.get('name', '')}"
    _CURRENT_CASE_KEY = case_key

    ver = resolve_protocol_version(case)
    if ver and ver not in SUPPORTED_PROTOCOL_VERSIONS:
        pytest.fail(
            f"Test case '{test_id}' specifies unsupported protocol version '{ver}'."
        )

    if rel_path in UNRUNNABLE_SUITES:
        pytest.skip(UNRUNNABLE_SUITES[rel_path])

    if case_key in UNSUPPORTED:
        pytest.skip(UNSUPPORTED[case_key])

    action = case.get("action")
    if not action or not isinstance(action, str):
        pytest.fail(f"Test case '{test_id}' missing required 'action' field.")

    if case_key in EXPECTED_FAILURES:
        try:
            _dispatch_conformance_action(rel_path, action, case)
        except (Exception, pytest.fail.Exception):
            pytest.xfail(EXPECTED_FAILURES[case_key])
        pytest.fail(f"Expected failure '{case_key}' passed unexpectedly.")
    else:
        _dispatch_conformance_action(rel_path, action, case)


_MEASURE_GROWTH_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalogPaths",
    "max_ratio",
    "operation",
    "payload",
    "protocolVersion",
    "sizes",
})
_TIMING_ARGS_KEYS: frozenset[str] = frozenset({
    "validation_config",
})


def _timed_processing(
    case: dict[str, Any],
) -> Callable[[str], Callable[[], object]]:
    """Returns how a `process_messages` timing case prepares a timed run.

    The catalogs are built and the payload decoded before the timing starts.
    Each timed run creates a processor and hands it every message in one
    `process_messages` call.
    """
    _assert_known_keys(case, _MEASURE_GROWTH_CASE_KEYS, "case key")
    _assert_known_keys(case["args"], _TIMING_ARGS_KEYS, "args key")
    catalogs = [_load_catalog_path(p) for p in case["catalogPaths"]]
    config = {"none": None, "relaxed": RELAXED_VALIDATION}[
        case["args"]["validation_config"]
    ]
    options = MessageProcessorOptions(validation_config=config)

    def prepare(payload: str) -> Callable[[], object]:
        messages = json.loads(payload)
        return lambda: MessageProcessor(catalogs, options=options).process_messages(
            messages
        )

    return prepare


def test_timing_cases_have_handlers() -> None:
    """Every timing case is one `test_conformance_timing` can run.

    The timing cases run only under `-m performance`, so this check runs with
    the other tests to catch a case the harness cannot run.
    """
    assert TIMING_CASES, "No timing cases found under conformance/core."
    for test_id, _, case in TIMING_CASES:
        assert (case.get("action"), case.get("operation")) == (
            "measure_growth",
            "process_messages",
        ), f"{test_id}: the core harness has no handler for this timing case."
        _timed_processing(case)


@pytest.mark.performance
@pytest.mark.parametrize(
    "test_id, rel_path, case",
    TIMING_CASES,
    ids=[c[0] for c in TIMING_CASES],
)
def test_conformance_timing(
    test_id: str, rel_path: str, case: dict[str, Any], timing: Any
) -> None:
    """Runs a `measure_growth` case of `core/message_processor_scaling.yaml`."""
    global _CURRENT_CASE_KEY
    _CURRENT_CASE_KEY = f"{rel_path}#{case.get('name', '')}"
    assert case["action"] == "measure_growth", test_id
    assert case["operation"] == "process_messages", test_id
    timing.measure_growth(case, _timed_processing(case))


def test_resolve_nodes_outside_its_suite_is_unsupported() -> None:
    case = {"name": "stray", "action": "resolve_nodes"}
    with pytest.raises((pytest.fail.Exception, AssertionError)):
        test_conformance_suite(
            "core/data_model.yaml::stray", "core/data_model.yaml", case
        )


def test_catalog_conformance_covers_published_catalogs() -> None:
    """Every published catalog has a from_json selfContained case in catalog.yaml."""
    repo_root = os.path.abspath(os.path.join(CONFORMANCE_ROOT, ".."))
    published = sorted(
        os.path.relpath(path, repo_root).replace(os.sep, "/")
        for pattern in (
            "specification/*/catalogs/*/catalog.json",
            "catalogs/*/v*/catalog.json",
        )
        for path in glob.glob(os.path.join(repo_root, pattern))
    )
    assert published, f"No published catalogs found under {repo_root}"
    with open(os.path.join(CORE_DIR, "catalog.yaml"), "r", encoding="utf-8") as f:
        cases = yaml.safe_load(f)
    covered = {
        case["catalogPath"]
        for case in cases
        if case.get("action") == "from_json"
        and "catalogPath" in case
        and (case.get("expect") or {}).get("selfContained") is True
    }
    missing = [path for path in published if path not in covered]
    assert not missing, (
        "Published catalogs without a from_json selfContained case in"
        f" conformance/core/catalog.yaml: {missing}"
    )


def _normalize_prop_value(raw_val: Any) -> Any:
    if isinstance(raw_val, list):
        return [
            item.component_id if hasattr(item, "component_id") else item
            for item in raw_val
        ]
    if hasattr(raw_val, "component_id"):
        return raw_val.component_id
    return raw_val


def _assert_surface_validation_fields(
    s_id: str, s_exp: dict[str, Any], surface: Any
) -> None:
    for val_field in (
        "validationResult",
        "validationResults",
        "isValid",
        "validationErrors",
    ):
        if val_field in s_exp:
            resolved_nodes = _resolve_surface_components(surface)
            field_exp = s_exp[val_field]
            for c_id, exp_v in field_exp.items():
                node_info = resolved_nodes.get(c_id)
                assert (
                    node_info is not None
                ), f"Component node '{c_id}' missing from surface '{s_id}'"
                actual_v = node_info["props"].get(val_field)
                assert actual_v == exp_v, (
                    f"{val_field} mismatch for '{c_id}': got {actual_v!r},"
                    f" expected {exp_v!r}"
                )


def _indexed_suffix_for_path(data_path: str) -> str | None:
    parts = [p for p in data_path.strip("/").split("/") if p]
    return parts[-1] if parts and parts[-1].isdigit() else None


def _extract_template_binding(p_val: Any) -> tuple[str, str] | None:
    if not isinstance(p_val, dict) or "componentId" not in p_val:
        return None
    raw_tpl_path = p_val.get("@path") or p_val.get("path")
    if not isinstance(raw_tpl_path, str):
        return None
    return p_val["componentId"], raw_tpl_path


def _resolve_template_children(
    surface: Any,
    ctx: Any,
    props: dict[str, Any],
    resolve_one: Callable[[str, str, str], None],
) -> None:
    for p_val in list(props.values()):
        tpl_info = _extract_template_binding(p_val)
        if tpl_info is None:
            continue
        tpl_comp_id, raw_tpl_path = tpl_info
        tpl_path = ctx.data_context.resolve_path(raw_tpl_path)
        arr = surface.data_model.get(tpl_path)
        if not isinstance(arr, list):
            continue
        base_tpl_path = tpl_path.rstrip("/")
        for i in range(len(arr)):
            scoped_path = f"{base_tpl_path}/{i}"
            resolve_one(tpl_comp_id, scoped_path, f"{tpl_comp_id}_{i}")
            resolve_one(tpl_comp_id, scoped_path, f"{tpl_comp_id}-[{scoped_path}]")


def _resolve_surface_components(surface: Any) -> dict[str, dict[str, Any]]:
    from a2ui.core.resolution import ComponentContext, GenericBinder

    resolved: dict[str, dict[str, Any]] = {}

    def _resolve_one(comp_id: str, data_path: str, instance_key: str) -> None:
        if instance_key in resolved:
            return
        comp = surface.components_model.get(comp_id)
        if not comp:
            return
        ctx = ComponentContext.from_surface(
            surface, comp_id, data_model_base_path=data_path
        )
        binder = GenericBinder(ctx)
        props = dict(binder.current_props)
        binder.dispose()

        _resolve_template_children(surface, ctx, props, _resolve_one)

        idx_suffix = _indexed_suffix_for_path(data_path)
        if idx_suffix:
            for child_id, _ in comp.get_child_references(
                set(surface.components_model.keys)
            ):
                _resolve_one(child_id, data_path, f"{child_id}_{idx_suffix}")
                _resolve_one(child_id, data_path, f"{child_id}-[{data_path}]")

        resolved[instance_key] = {
            "type": comp.type,
            "props": props,
        }

    for comp_id, _ in list(surface.components_model.entries):
        _resolve_one(comp_id, "/", comp_id)

    return resolved


_SURFACE_STATE_EXPECT_KEYS: frozenset[str] = frozenset({
    "surfaces",
})
_SURFACE_EXPECT_KEYS: frozenset[str] = frozenset({
    "components",
    "dataModel",
    "exists",
    "isValid",
    "metadata",
    "sendDataModel",
    "theme",
    "validationErrors",
    "validationResult",
    "validationResults",
})


def _expected_component_items(comps_expected: Any) -> list[tuple[Any, Any]]:
    if isinstance(comps_expected, dict):
        return list(comps_expected.items())
    if isinstance(comps_expected, list):
        return [(c.get("id"), c) for c in comps_expected if isinstance(c, dict)]
    return []


def _prop_value_matches(norm_val: Any, p_val: Any) -> bool:
    if norm_val == p_val:
        return True
    return (
        isinstance(norm_val, int)
        and not isinstance(norm_val, bool)
        and isinstance(p_val, str)
        and str(norm_val) == p_val
    )


def _assert_single_component_state(
    s_id: str,
    c_id: Any,
    c_exp: Any,
    surface: Any,
    resolved_nodes: dict[str, dict[str, Any]],
) -> None:
    comp = surface.components_model.get(c_id)
    node_info = resolved_nodes.get(c_id)
    assert (
        comp is not None or node_info is not None
    ), f"Component '{c_id}' missing from surface '{s_id}'"
    if not isinstance(c_exp, dict):
        return
    c_type = comp.type if comp else (node_info["type"] if node_info else "")
    if "component" in c_exp:
        assert c_type == c_exp["component"]
    if "metadata" in c_exp:
        assert comp is not None
        assert comp.metadata == c_exp["metadata"]
    if not node_info:
        return
    node_props = node_info["props"]
    for p_key, p_val in c_exp.items():
        if p_key in ("id", "component", "metadata"):
            continue
        norm_val = _normalize_prop_value(node_props.get(p_key))
        assert _prop_value_matches(norm_val, p_val), (
            f"Property '{p_key}' mismatch on component '{c_id}':"
            f" got {norm_val!r}, expected {p_val!r}"
        )


def _assert_surface_components_state(
    s_id: str, comps_expected: Any, surface: Any
) -> None:
    comp_items = _expected_component_items(comps_expected)
    resolved_nodes = _resolve_surface_components(surface)
    for c_id, c_exp in comp_items:
        _assert_single_component_state(s_id, c_id, c_exp, surface, resolved_nodes)
    if isinstance(comps_expected, list) and all(
        surface.components_model.get(c_id) is not None for c_id, _ in comp_items
    ):
        assert len(surface.components_model.keys) == len(comp_items), (
            f"Surface '{s_id}' component count mismatch: expected"
            f" {len(comp_items)}, got {len(surface.components_model.keys)}"
        )


def _assert_single_surface_state(
    processor: MessageProcessor, s_id: str, s_exp: dict[str, Any]
) -> None:
    _assert_known_keys(s_exp, _SURFACE_EXPECT_KEYS, f"expect.surfaces.{s_id} key")
    surface = processor.model.get_surface(s_id)
    if s_exp.get("exists") is False:
        assert surface is None
        return
    assert surface is not None
    if "theme" in s_exp:
        assert surface.theme == s_exp["theme"]
    if "metadata" in s_exp:
        assert surface.metadata == s_exp["metadata"]
    if "sendDataModel" in s_exp:
        assert surface.send_data_model == s_exp["sendDataModel"]
    if "dataModel" in s_exp:
        assert surface.data_model.get("/") == s_exp["dataModel"]
    if "components" in s_exp:
        _assert_surface_components_state(s_id, s_exp["components"], surface)
    _assert_surface_validation_fields(s_id, s_exp, surface)


def _assert_expected_surface_state(
    processor: MessageProcessor, expected: dict[str, Any]
) -> None:
    _assert_known_keys(expected, _SURFACE_STATE_EXPECT_KEYS, "expect key")
    for s_id, s_exp in (expected.get("surfaces") or {}).items():
        _assert_single_surface_state(processor, s_id, s_exp)


def _run_pure_validation_step_with_error(
    processor: MessageProcessor, messages: Any
) -> None:
    errors: list[dict[str, Any]] = []
    for s in processor.model.surfaces.values():
        s.on_error.subscribe(lambda err: errors.append(err))
    processor.process_messages(messages)
    for s in processor.model.surfaces.values():
        s.on_error.subscribe(lambda err: errors.append(err))
        _resolve_surface_components(s)
    if errors:
        err = errors[0]
        raise A2uiValidationError(
            err.get("message", "Expression error"),
            code=err.get("code"),
            path=err.get("path"),
            surface_id=err.get("surfaceId"),
        )


_VALIDATE_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "catalog",
    "catalogPaths",
    "catalogs",
    "expect",
    "expect_error",
    "expectError",
    "messages",
    "payload",
    "protocolVersion",
    "steps",
    "strictMode",
})
_VALIDATE_STEP_KEYS: frozenset[str] = frozenset({
    "expect",
    "expect_error",
    "expectError",
    "message",
    "messages",
    "payload",
})


def _step_messages(step: dict[str, Any], idx: int) -> Any:
    messages = step.get("messages") or step.get("payload")
    if not messages and "message" in step:
        messages = [step["message"]]
    assert messages, f"Step {idx} has no messages or payload"
    return messages


def _step_expect_error(
    step: dict[str, Any], case: dict[str, Any], is_last: bool
) -> Any:
    err = step.get("expectError") or step.get("expect_error")
    if err or not is_last:
        return err
    return case.get("expectError") or case.get("expect_error")


def validate_pure_validation_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _VALIDATE_CASE_KEYS, "case key")
    catalogs = get_catalogs_for_test_case(case)
    val_config = (
        RELAXED_VALIDATION if case.get("strictMode") is False else STRICT_VALIDATION
    )
    processor = MessageProcessor(
        catalogs, options=MessageProcessorOptions(validation_config=val_config)
    )
    captured_renderer_errors: list[dict[str, Any]] = []
    processor.model.on_error.subscribe(lambda msg: captured_renderer_errors.append(msg))

    has_steps = "steps" in case
    steps = case["steps"] if has_steps else [case]
    assert steps, "validate case must have at least one step"

    for idx, step in enumerate(steps):
        if has_steps:
            _assert_known_keys(step, _VALIDATE_STEP_KEYS, f"steps[{idx}] key")
        messages = _step_messages(step, idx)
        is_last = idx == len(steps) - 1
        expect_error = _step_expect_error(step, case, is_last)
        if expect_error:
            captured_renderer_errors.clear()
            with assert_raises(expect_error, captured_renderer_errors):
                _run_pure_validation_step_with_error(processor, messages)
        else:
            processor.process_messages(messages)
            expected = step.get("expect") or (case.get("expect") if is_last else None)
            if expected:
                _assert_expected_surface_state(processor, expected)


# The flags a case's `validationConfig` may set (`validationConfig` in
# conformance/conformance_schema.json), with the ValidationConfig field each
# sets. A flag the case leaves out is False.
_CASE_VALIDATION_FLAGS = {
    "allowOrphanComponents": "allow_orphan_components",
    "allowDanglingReferences": "allow_dangling_references",
    "allowMissingRoot": "allow_missing_root",
    "allowUnknownElements": "allow_unknown_elements",
}


def _case_validation_config(flags: dict[str, bool]) -> ValidationConfig:
    """Builds the ValidationConfig a case's `validationConfig` flags describe."""
    _assert_known_keys(flags, frozenset(_CASE_VALIDATION_FLAGS), "validationConfig key")
    return ValidationConfig(
        **{_CASE_VALIDATION_FLAGS[name]: value for name, value in flags.items()}
    )


_PROCESS_MESSAGES_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "catalog",
    "catalogPaths",
    "catalogs",
    "expect",
    "expectError",
    "messages",
    "options",
    "payload",
    "protocolVersion",
    "steps",
    "strict_mode",
    "strictMode",
    "validationConfig",
})
_PROCESS_MESSAGES_STEP_KEYS: frozenset[str] = frozenset({
    "expect",
    "expectError",
    "message",
    "messages",
    "payload",
})


def _process_messages_validation_config(
    case: dict[str, Any],
) -> ValidationConfig | None:
    if "validationConfig" in case:
        # The case sets its checks, so they don't depend on this harness.
        return _case_validation_config(case["validationConfig"])
    is_strict = bool(
        case.get("strictMode")
        or case.get("strict_mode")
        or case.get("options", {}).get("strict_mode")
    )
    return STRICT_VALIDATION if is_strict else None


def _run_process_messages_step(
    processor: MessageProcessor,
    messages: Any,
    expect_error: Any,
    expected: dict[str, Any],
    captured_renderer_errors: list[dict[str, Any]],
) -> None:
    if expect_error:
        captured_renderer_errors.clear()
        with assert_raises(expect_error, captured_renderer_errors):
            processor.process_messages(messages)
    else:
        processor.process_messages(messages)
        _assert_expected_surface_state(processor, expected)


def validate_process_messages_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _PROCESS_MESSAGES_CASE_KEYS, "case key")
    catalogs = get_catalogs_for_test_case(case)
    val_config = _process_messages_validation_config(case)
    processor = MessageProcessor(
        catalogs, options=MessageProcessorOptions(validation_config=val_config)
    )
    captured_renderer_errors: list[dict[str, Any]] = []
    processor.model.on_error.subscribe(lambda msg: captured_renderer_errors.append(msg))

    messages = case.get("messages") or (
        [case["payload"]] if "payload" in case else None
    )
    if messages:
        _run_process_messages_step(
            processor,
            messages,
            case.get("expectError"),
            case.get("expect", {}),
            captured_renderer_errors,
        )
        return

    steps = case.get("steps", [])
    assert steps, "process_messages case must have messages, payload, or steps"
    for idx, step in enumerate(steps):
        _assert_known_keys(step, _PROCESS_MESSAGES_STEP_KEYS, f"steps[{idx}] key")
        step_msgs = _step_messages(step, idx)
        is_last = step is steps[-1]
        expect_error = step.get("expectError") or (
            case.get("expectError") if is_last else None
        )
        expected = step.get("expect") or (case.get("expect", {}) if is_last else {})
        _run_process_messages_step(
            processor,
            step_msgs,
            expect_error,
            expected,
            captured_renderer_errors,
        )


_CAPABILITIES_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalog",
    "catalogs",
    "expect",
    "protocolVersion",
})
_CAPABILITIES_ARGS_KEYS: frozenset[str] = frozenset({
    "componentEnvelopeRef",
    "includeInlineCatalogs",
    "version",
    "versions",
})


def validate_capabilities_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _CAPABILITIES_CASE_KEYS, "case key")
    assert "expect" in case, "capabilities case requires 'expect'"
    catalogs = get_catalogs_for_test_case(case)
    processor = MessageProcessor(catalogs)
    args = case.get("args") or {}
    _assert_known_keys(args, _CAPABILITIES_ARGS_KEYS, "args key")
    raw_versions = args.get("versions") or (
        [args["version"]]
        if "version" in args
        else [resolve_protocol_version(case) or "v0.9"]
    )
    p_versions = [
        ProtocolVersion(v) if v in ProtocolVersion._value2member_map_ else v
        for v in raw_versions
    ]
    opts = CapabilitiesOptions(
        versions=p_versions,
        include_inline_catalogs=bool(args.get("includeInlineCatalogs", False)),
        component_envelope_ref=args.get(
            "componentEnvelopeRef", "common_types.json#/$defs/ComponentCommon"
        ),
    )
    caps = processor.get_renderer_capabilities(opts)
    expected = case.get("expect", {})
    assert caps == expected


def _collect_refs(node: Any) -> list[str]:
    """Every `$ref` value in a schema, in document order."""
    if isinstance(node, dict):
        refs = [node["$ref"]] if isinstance(node.get("$ref"), str) else []
        for value in node.values():
            refs.extend(_collect_refs(value))
        return refs
    if isinstance(node, list):
        return [ref for item in node for ref in _collect_refs(item)]
    return []


def _assert_self_contained(schema: dict[str, Any]) -> None:
    """Asserts that every `$ref` in the schema resolves within the schema."""
    refs = _collect_refs(schema)
    assert refs, "Catalog schema contains no references at all."
    for ref in refs:
        assert ref.startswith("#"), f"Reference '{ref}' leaves the catalog document."
        target: Any = schema
        for token in ref[1:].split("/")[1:]:
            token = token.replace("~1", "/").replace("~0", "~")
            assert (
                isinstance(target, dict) and token in target
            ), f"Reference '{ref}' does not resolve within the catalog document."
            target = target[token]


# The `expect` keys a from_json case may use (FromJsonExpect in
# conformance/conformance_schema.json). An unknown key fails the case rather
# than being silently ignored.
_FROM_JSON_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "catalog",
    "catalogFile",
    "catalogId",
    "catalogPath",
    "catalogSchema",
    "expect",
    "expectError",
    "protocolVersion",
    "schema",
})
_FROM_JSON_EXPECT_KEYS = frozenset({
    "catalogId",
    "componentMetadata",
    "components",
    "functions",
    "invalidComponents",
    "matchesBuiltinCatalog",
    "protocolVersion",
    "selfContained",
    "theme",
    "validComponents",
})

# Component fields every component carries, which `matchesBuiltinCatalog`
# ignores when it compares component shapes.
_COMPONENT_ENVELOPE_FIELDS = frozenset({"id", "component"})


def _resolve_local_ref(document: dict[str, Any], ref: str) -> Any:
    """The node a local `#/...` reference points to within `document`."""
    target: Any = document
    for token in ref[1:].split("/")[1:]:
        target = target[token.replace("~1", "/").replace("~0", "~")]
    return target


def _schema_shape(
    document: dict[str, Any], schema: Any, seen: frozenset[str] = frozenset()
) -> tuple[set[str], set[str]]:
    """The property and required names a component schema declares.

    Merges the members of an `allOf` and follows local references, so a
    schema that composes the component envelope with its own properties
    yields the same names as one that lists them all directly.
    """
    properties: set[str] = set()
    required: set[str] = set()
    if not isinstance(schema, dict):
        return properties, required
    properties |= set(schema.get("properties") or {})
    required |= set(schema.get("required") or [])
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#") and ref not in seen:
        props, req = _schema_shape(
            document, _resolve_local_ref(document, ref), seen | {ref}
        )
        properties |= props
        required |= req
    for member in schema.get("allOf") or []:
        props, req = _schema_shape(document, member, seen)
        properties |= props
        required |= req
    return properties, required


def _component_shapes(catalog: CatalogApi) -> dict[str, dict[str, list[str]]]:
    """Each component's property and required names, without the envelope."""
    document = catalog.validation_schema
    shapes = {}
    for name, schema in (document.get("components") or {}).items():
        properties, required = _schema_shape(document, schema)
        shapes[name] = {
            "properties": sorted(properties - _COMPONENT_ENVELOPE_FIELDS),
            "required": sorted(required - _COMPONENT_ENVELOPE_FIELDS),
        }
    return shapes


def _function_signatures(catalog: CatalogApi) -> dict[str, dict[str, Any]]:
    """Each catalog function's returnType, allowedCallers and activation.

    Protocol system functions such as `@index`, which a built-in catalog
    registers for evaluation but which are not catalog functions, are left out.
    """
    return {
        name: {
            "returnType": fn.return_type,
            "allowedCallers": fn.allowed_callers,
            "requiresUserActivation": fn.requires_user_activation,
        }
        for name, fn in catalog.functions.items()
        if not name.startswith("@")
    }


def _assert_matches_builtin_catalog(loaded: CatalogApi) -> None:
    """Asserts that a loaded catalog is equivalent to the SDK's own one.

    Implements `matchesBuiltinCatalog` (FromJsonExpect in
    conformance/conformance_schema.json) and skips the case when the SDK has
    no implementation of a catalog with the loaded catalogId.
    """
    builtin = sdk_catalog(loaded.catalog_id)
    if builtin is None:
        pytest.skip(f"The SDK has no built-in catalog {loaded.catalog_id!r}.")
    assert loaded.catalog_id == builtin.catalog_id
    assert to_canonical_version(str(loaded.protocol_version)) == to_canonical_version(
        str(builtin.protocol_version)
    ), "protocolVersion mismatch"
    assert _component_shapes(loaded) == _component_shapes(builtin), "Component mismatch"
    assert _function_signatures(loaded) == _function_signatures(
        builtin
    ), "Function mismatch"


def _assert_from_json_expectations(cat: CatalogApi, expected: dict[str, Any]) -> None:
    _assert_known_keys(expected, _FROM_JSON_EXPECT_KEYS, "expect key")
    if "catalogId" in expected:
        assert cat.catalog_id == expected["catalogId"]
    if "protocolVersion" in expected:
        assert cat.protocol_version == expected["protocolVersion"]
    if isinstance(expected.get("components"), (list, dict)):
        for comp_name in expected["components"]:
            assert cat.get_component(comp_name) is not None
    if isinstance(expected.get("functions"), list):
        for fn_name in expected["functions"]:
            assert cat.get_function(fn_name) is not None
    if isinstance(expected.get("componentMetadata"), dict):
        for comp_name, exp_meta in expected["componentMetadata"].items():
            comp_api = cat.get_component(comp_name)
            assert comp_api is not None
            assert comp_api.metadata == exp_meta
    if expected.get("selfContained"):
        _assert_self_contained(cat.validation_schema)
    if expected.get("matchesBuiltinCatalog"):
        _assert_matches_builtin_catalog(cat)
    _assert_from_json_component_samples(cat, expected)


def _assert_from_json_component_samples(
    cat: CatalogApi, expected: dict[str, Any]
) -> None:
    if "validComponents" not in expected and "invalidComponents" not in expected:
        return
    validator = PayloadValidator(cat)
    for component in expected.get("validComponents", []):
        validator.validate_component(component)
    for component in expected.get("invalidComponents", []):
        with pytest.raises(A2uiValidationError):
            validator.validate_component(component)


def validate_from_json_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _FROM_JSON_CASE_KEYS, "case key")
    c_path = case.get("catalogPath")
    if c_path:
        full_p = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", c_path))
        with open(full_p, "r", encoding="utf-8") as f:
            c_schema = json.load(f)
    else:
        c_schema = (
            case.get("catalogSchema")
            or case.get("catalog")
            or case.get("schema")
            or case
        )
    c_id = resolve_catalog_id(case) or (c_schema.get("catalogId") if c_path else None)
    p_ver = resolve_protocol_version(case)
    expect_err = case.get("expectError")

    if expect_err:
        with assert_raises(expect_err):
            Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)
    else:
        cat = Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)
        _assert_from_json_expectations(cat, case.get("expect", {}))


# The `expect` keys a `derive` case may use (`DeriveExpect` in
# conformance_schema.json).
_DERIVE_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalog",
    "catalogFile",
    "catalogId",
    "catalogPath",
    "catalogSchema",
    "expect",
    "expectError",
    "protocolVersion",
    "schema",
})
_DERIVE_ARGS_KEYS: frozenset[str] = frozenset({
    "catalogId",
    "components",
    "functions",
    "instructions",
})
_DERIVE_EXPECT_KEYS = frozenset({
    "absentKeys",
    "catalogId",
    "components",
    "functions",
    "instructions",
    "protocolVersion",
    "theme",
})


def _derive_entries(
    args: dict[str, Any], document: dict[str, Any], kind: str
) -> list[Any] | None:
    # A map with one key is a new entry, built by loading it into a
    # catalog of the source's version.
    listed = args.get(kind)
    if listed is None:
        return None
    picked: list[Any] = []
    for item in listed:
        if isinstance(item, str):
            picked.append(item)
            continue
        [(name, definition)] = item.items()
        holder = Catalog.from_json({
            "catalogId": "conformance:derive-entries",
            "protocolVersion": document.get("protocolVersion"),
            kind: {name: definition},
        })
        picked.append(getattr(holder, kind)[name])
    return picked


def _assert_derived_catalog(derived: CatalogApi, expected: dict[str, Any]) -> None:
    _assert_known_keys(expected, _DERIVE_EXPECT_KEYS, "expect key")
    out = derived.to_json()
    if "catalogId" in expected:
        assert derived.catalog_id == expected["catalogId"]
    if "protocolVersion" in expected:
        assert to_canonical_version(derived.protocol_version) == to_canonical_version(
            expected["protocolVersion"]
        )
    for kind in ("components", "functions"):
        if kind not in expected:
            continue
        listed = expected[kind]
        assert sorted(getattr(derived, kind)) == sorted(listed), f"{kind} mismatch"
        if isinstance(listed, dict):
            for name, definition in listed.items():
                assert normalize_set_keywords(
                    out[kind][name]
                ) == normalize_set_keywords(definition), f"{kind} '{name}' differs"
    if "theme" in expected:
        assert normalize_set_keywords(out.get("theme")) == normalize_set_keywords(
            expected["theme"]
        )
    if "instructions" in expected:
        assert out.get("instructions") == expected["instructions"]
    for key in expected.get("absentKeys", []):
        assert key not in out, f"Expected to_json() to carry no '{key}'"


def validate_derive_case(case: dict[str, Any]) -> None:
    """Runs a `derive` case.

    Loads the source catalog with `from_json`, derives a catalog from it, and
    checks the derived catalog and its `to_json()` document.
    """
    _assert_known_keys(case, _DERIVE_CASE_KEYS, "case key")
    assert (
        "expect" in case or "expectError" in case
    ), "derive case requires 'expect' or 'expectError'"
    document, _ = _load_case_catalog(case)
    source = Catalog.from_json(document)
    args = case["args"]
    _assert_known_keys(args, _DERIVE_ARGS_KEYS, "args key")

    def derive() -> CatalogApi:
        return source.derive(
            catalog_id=args["catalogId"],
            components=_derive_entries(args, document, "components"),
            functions=_derive_entries(args, document, "functions"),
            instructions=args.get("instructions"),
        )

    if "expectError" in case:
        with assert_raises(case["expectError"]):
            derive()
        return

    _assert_derived_catalog(derive(), case["expect"])


def normalize_set_keywords(node: Any) -> Any:
    """Sorts the values of keywords whose order has no meaning.

    `enum` values and `required` names form sets. The generated models may
    emit them in another order, for example because `typing` caches `Literal`
    unions regardless of their values' order.
    """
    if isinstance(node, list):
        return [normalize_set_keywords(item) for item in node]
    if not isinstance(node, dict):
        return node
    normalized = {key: normalize_set_keywords(value) for key, value in node.items()}
    for keyword in ("enum", "required"):
        # Inside `properties`, a property with this name holds a schema object.
        values = normalized.get(keyword)
        if isinstance(values, list):
            normalized[keyword] = sorted(values, key=json.dumps)
    return normalized


def sdk_catalog(catalog_id: Any) -> CatalogApi | None:
    """Returns the SDK's own implementation of a published catalog, if any.

    The SDK implements the basic catalog of each protocol version with
    generated models. A catalog with any other id has no such implementation.
    """
    from a2ui.core.basic_catalog import v0_8, v0_9, v1_0

    for module in (v0_8, v0_9, v1_0):
        catalog = module.BasicCatalog()
        if catalog.catalog_id == catalog_id:
            return catalog
    return None


def _load_case_catalog(case: dict[str, Any]) -> tuple[Any, str | None]:
    """Returns the catalog document of a case and the path it was read from."""
    c_path = case.get("catalogPath") or case.get("catalogFile")
    if c_path:
        full_p = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", c_path))
        with open(full_p, "r", encoding="utf-8") as f:
            return json.load(f), c_path
    return (
        case.get("catalogSchema") or case.get("catalog") or case.get("schema") or case
    ), None


_VALIDATION_SCHEMA_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "catalog",
    "catalogFile",
    "catalogId",
    "catalogPath",
    "catalogSchema",
    "expectError",
    "expectFile",
    "protocolVersion",
    "schema",
})


def validate_validation_schema_case(case: dict[str, Any]) -> None:
    """Runs a `validation_schema` case against its golden artifact.

    `catalog.validation_schema` must equal the JSON file that `expectFile`
    names, ignoring object key order, which Python dicts ignore already, and
    the order of `enum` values and `required` names.
    """
    _assert_known_keys(case, _VALIDATION_SCHEMA_CASE_KEYS, "case key")
    p_ver = resolve_protocol_version(case)
    c_schema, _ = _load_case_catalog(case)
    c_id = (
        resolve_catalog_id(case)
        or (c_schema.get("catalogId") if isinstance(c_schema, dict) else None)
        or "https://a2ui.org/catalogs/basic"
    )
    # The catalog is always loaded with `from_json`, a `catalogPath` too, even
    # when the SDK implements that catalog itself.
    expect_err = case.get("expectError")
    if expect_err:
        with assert_raises(expect_err):
            Catalog.from_json(
                c_schema, catalog_id=c_id, protocol_version=p_ver
            ).validation_schema
        return
    cat = Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)

    expect_file = case.get("expectFile")
    assert expect_file, "validation_schema cases require expectFile or expectError"
    golden_path = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", expect_file))
    with open(golden_path, "r", encoding="utf-8") as f:
        expected = json.load(f)
    assert normalize_set_keywords(cat.validation_schema) == normalize_set_keywords(
        expected
    ), f"validation_schema differs from {expect_file}"


_ROUND_TRIP_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "catalog",
    "catalogFile",
    "catalogId",
    "catalogPath",
    "catalogSchema",
    "protocolVersion",
    "schema",
})


def validate_round_trip_case(case: dict[str, Any]) -> None:
    """Runs a `round_trip` case: `from_json(c).to_json()` equals `c`.

    The document is always loaded with `from_json`, even when the SDK
    implements the catalog itself. A case-level `catalogId` overrides a
    document that declares none, and must not appear in the output. The
    comparison ignores key order, which Python dicts ignore already, and the
    order of `enum` and `required`.
    """
    _assert_known_keys(case, _ROUND_TRIP_CASE_KEYS, "case key")
    document, _ = _load_case_catalog(case)
    p_ver = resolve_protocol_version(case)
    c_id = resolve_catalog_id(case)

    out = Catalog.from_json(document, catalog_id=c_id, protocol_version=p_ver).to_json()
    assert normalize_set_keywords(out) == normalize_set_keywords(document)

    again = Catalog.from_json(out, catalog_id=c_id, protocol_version=p_ver).to_json()
    assert normalize_set_keywords(again) == normalize_set_keywords(out)


def builtin_catalog(name: str, protocol_version: str | None) -> CatalogApi | None:
    """Returns the SDK's own implementation of a named catalog, if any.

    The SDK implements the basic catalog of v0.8, v0.9 and v1.0.
    """
    if name != "basic" or protocol_version is None:
        return None
    modules = {"0.8": v0_8, "0.9": v0_9, "1.0": v1_0}
    module = modules.get(to_canonical_version(protocol_version))
    return module.BasicCatalog() if module is not None else None


_TO_JSON_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "builtinCatalog",
    "catalog",
    "catalogFile",
    "catalogId",
    "catalogPath",
    "catalogSchema",
    "expectFile",
    "protocolVersion",
    "schema",
})


def validate_to_json_case(case: dict[str, Any]) -> None:
    """Runs a `to_json` case: `catalog.to_json()` equals `expectFile`.

    A `builtinCatalog` case serializes the SDK's own implementation for the
    case's protocol version, and is skipped if the SDK has none. Other cases
    load `catalogPath` or `catalog` with `from_json`. The comparison ignores
    key order and the order of `enum` and `required`.
    """
    _assert_known_keys(case, _TO_JSON_CASE_KEYS, "case key")
    p_ver = resolve_protocol_version(case)
    builtin_name = case.get("builtinCatalog")
    if builtin_name:
        cat = builtin_catalog(builtin_name, p_ver)
        if cat is None:
            pytest.skip(f"The SDK has no built-in {builtin_name} catalog for {p_ver}.")
    else:
        document, _ = _load_case_catalog(case)
        cat = Catalog.from_json(
            document, catalog_id=resolve_catalog_id(case), protocol_version=p_ver
        )

    expect_file = case["expectFile"]
    with open(
        os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", expect_file)),
        "r",
        encoding="utf-8",
    ) as f:
        expected = json.load(f)
    assert normalize_set_keywords(cat.to_json()) == normalize_set_keywords(
        expected
    ), f"to_json differs from {expect_file}"


_SCHEMA_EXPORT_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "expectFile",
    "protocolVersion",
})


def validate_common_types_schema_case(case: dict[str, Any]) -> None:
    from a2ui.core.catalog import get_common_types_schema_json
    from a2ui.core.common import to_protocol_version

    _assert_known_keys(case, _SCHEMA_EXPORT_CASE_KEYS, "case key")
    generated = json.loads(
        get_common_types_schema_json(
            to_protocol_version(resolve_protocol_version(case) or "")
        )
    )
    exp_path = os.path.join(CONFORMANCE_ROOT, "..", case["expectFile"])
    with open(exp_path, "r", encoding="utf-8") as f:
        expected = json.load(f)
    assert json.dumps(generated, indent=2, sort_keys=True) == json.dumps(
        expected, indent=2, sort_keys=True
    )


def validate_agent_to_renderer_schema_case(case: dict[str, Any]) -> None:
    from a2ui.core.common import to_protocol_version
    from a2ui.core.schema import get_agent_to_renderer_schema_json

    _assert_known_keys(case, _SCHEMA_EXPORT_CASE_KEYS, "case key")
    generated = json.loads(
        get_agent_to_renderer_schema_json(
            to_protocol_version(resolve_protocol_version(case) or "")
        )
    )
    exp_path = os.path.join(CONFORMANCE_ROOT, "..", case["expectFile"])
    with open(exp_path, "r", encoding="utf-8") as f:
        expected = json.load(f)
    assert json.dumps(generated, indent=2, sort_keys=True) == json.dumps(
        expected, indent=2, sort_keys=True
    )


_VALIDATE_COMMON_TYPE_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "definition",
    "protocolVersion",
    "steps",
})
_VALIDATE_COMMON_TYPE_STEP_KEYS: frozenset[str] = frozenset({
    "expectError",
    "value",
})


def validate_common_type_case(case: dict[str, Any]) -> None:
    from pydantic import TypeAdapter, ValidationError

    from a2ui.core.schema import v0_9 as schema_v0_9, v1_0 as schema_v1_0

    _assert_known_keys(case, _VALIDATE_COMMON_TYPE_CASE_KEYS, "case key")
    schema_packages = {
        "v0.9": schema_v0_9,
        "v0.9.1": schema_v0_9,
        "1.0": schema_v1_0,
        "v1.0": schema_v1_0,
    }
    p_ver = resolve_protocol_version(case)
    assert (
        p_ver in schema_packages
    ), f"validate_common_type does not support protocolVersion {p_ver!r}"
    schema_pkg = schema_packages[p_ver]
    definition = case["definition"]
    assert (
        definition in schema_pkg.COMMON_TYPES_DEFS
    ), f"'{definition}' is not a common types definition in {p_ver}"
    adapter: TypeAdapter[Any] = TypeAdapter(schema_pkg.COMMON_TYPES_DEFS[definition])

    assert case.get("steps"), "validate_common_type case requires non-empty 'steps'"
    for idx, step in enumerate(case["steps"]):
        _assert_known_keys(step, _VALIDATE_COMMON_TYPE_STEP_KEYS, f"steps[{idx}] key")
        value = step["value"]
        expect_error = step.get("expectError")
        if expect_error:
            with assert_raises(expect_error):
                try:
                    adapter.validate_python(value)
                except ValidationError as exc:
                    raise A2uiValidationError(str(exc)) from exc
            continue
        validated = adapter.validate_python(value)
        # A valid value serializes back to the same JSON.
        assert (
            adapter.dump_python(
                validated, mode="json", by_alias=True, exclude_unset=True
            )
            == value
        )


_RESOLVE_PATH_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalog",
    "expect",
})
_RESOLVE_PATH_ARGS_KEYS: frozenset[str] = frozenset({
    "context_path",
    "contextPath",
    "path",
})


def validate_resolve_path_case(case: dict[str, Any]) -> None:
    from a2ui.core.resolution.data_context import DataContext
    from a2ui.core.state.surface_model import SurfaceModel

    _assert_known_keys(case, _RESOLVE_PATH_CASE_KEYS, "case key")
    assert "expect" in case, "resolve_path case requires 'expect'"
    args = case.get("args", {})
    _assert_known_keys(args, _RESOLVE_PATH_ARGS_KEYS, "args key")
    path = args.get("path", "")
    context_path = args.get("contextPath") or args.get("context_path")
    surface = SurfaceModel(surface_id="dummy", default_catalog=basic_catalog)
    ctx = DataContext(surface=surface, path=context_path or "/")
    res = ctx.resolve_path(path)
    expected = case.get("expect")
    if isinstance(expected, dict) and "result" in expected:
        assert res == expected["result"]
    elif expected is not None:
        assert res == expected


_DATA_MODEL_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "catalog",
    "expect",
    "initial",
    "steps",
    "watch",
})
_DATA_MODEL_STEP_KEYS_BY_OP: dict[str, frozenset[str]] = {
    "get": frozenset({
        "op",
        "path",
        "expect",
        "expect_absent",
        "expect_type",
        "expect_error",
        "expectError",
        "expect_notified",
        "expect_values",
    }),
    "set": frozenset({
        "op",
        "path",
        "value",
        "expect_error",
        "expectError",
        "expect_notified",
        "expect_values",
    }),
    "delete": frozenset({
        "op",
        "path",
        "expect_error",
        "expectError",
        "expect_notified",
        "expect_values",
    }),
    "dispose": frozenset({
        "op",
        "expect_error",
        "expectError",
        "expect_notified",
        "expect_values",
    }),
}


def _assert_data_model_observer_expectations(
    idx: int, step: dict[str, Any], observers: list[Any]
) -> None:
    if "expect_notified" in step:
        expected_notified = step["expect_notified"]
        actual_notified = [
            obs.path for obs in observers for _ in range(obs.change_count)
        ]
        assert sorted(actual_notified) == sorted(expected_notified), (
            f"Step {idx} ({step.get('op')}) expect_notified mismatch:"
            f" got {actual_notified}, expected {expected_notified}"
        )

    if "expect_values" in step:
        for v_path, exp_val in step["expect_values"].items():
            obs = next((o for o in observers if o.path == v_path), None)
            assert obs is not None, f"Path '{v_path}' in expect_values is not watched"
            assert obs.current_value == exp_val, (
                f"Step {idx} ({step.get('op')}) expect_values mismatch for"
                f" '{v_path}': got {obs.current_value}, expected {exp_val}"
            )


def validate_data_model_case(case: dict[str, Any]) -> None:
    from a2ui.core.state.data_model import DataModel

    _assert_known_keys(case, _DATA_MODEL_CASE_KEYS, "case key")
    model = DataModel(initial_data=case.get("initial"))

    class _Observer:

        def __init__(self, path: str):
            self.path = path
            self.change_count = 0
            self.current_value = model.get(path)

        def on_change(self, val: Any) -> None:
            self.change_count += 1
            self.current_value = val

    observers: list[_Observer] = []
    for p in case.get("watch") or []:
        obs = _Observer(p)
        model.subscribe(p, obs.on_change)
        observers.append(obs)

    steps = case.get("steps") or []
    assert steps or "expect" in case, "data_model case requires 'steps' or 'expect'"
    for idx, step in enumerate(steps):
        op = step.get("op")
        allowed_step_keys = _DATA_MODEL_STEP_KEYS_BY_OP.get(str(op))
        if allowed_step_keys is None:
            pytest.fail(f"Unknown data_model op '{op}' in {_CURRENT_CASE_KEY}")
        _assert_known_keys(step, allowed_step_keys, f"steps[{idx}] ({op}) key")
        for obs in observers:
            obs.change_count = 0

        expect_err = step.get("expect_error") or step.get("expectError")
        if expect_err:
            with assert_raises(expect_err):
                _apply_data_model_op(model, step)
            continue

        _apply_data_model_op(model, step)
        _assert_data_model_observer_expectations(idx, step, observers)

    if "expect" in case:
        assert model.get("/") == case["expect"]


_DATA_MODEL_GET_EXPECT_KEYS = (
    "expect",
    "expect_absent",
    "expect_type",
    "expect_notified",
    "expect_values",
    "expect_error",
)


def _apply_data_model_get(model: Any, step: dict[str, Any]) -> None:
    step_path = step.get("path", "")
    assert any(
        k in step for k in _DATA_MODEL_GET_EXPECT_KEYS
    ), "data_model 'get' step requires an expectation"
    actual = model.get(step_path)
    if step.get("expect_absent") is True:
        assert actual is None, f"Expected path '{step_path}' to be absent, got {actual}"
    if "expect_type" in step:
        exp_type = step["expect_type"]
        expected_cls = (
            list if exp_type == "list" else (dict if exp_type == "object" else None)
        )
        if expected_cls is None:
            pytest.fail(f"Unknown expect_type '{exp_type}' in {_CURRENT_CASE_KEY}")
        assert isinstance(actual, expected_cls), (
            f"Expected path '{step_path}' to be {expected_cls.__name__},"
            f" got {type(actual)}"
        )
    if "expect" in step:
        assert actual == step["expect"], (
            f"Get at path '{step_path}' mismatch: got {actual}, expected"
            f" {step['expect']}"
        )


def _apply_data_model_op(model: Any, step: dict[str, Any]) -> None:
    op = step.get("op")
    step_path = step.get("path", "")
    if op == "get":
        _apply_data_model_get(model, step)
    elif op == "set":
        model.set(step_path, step.get("value"))
    elif op == "delete":
        model.set(step_path, None)
    elif op == "dispose":
        model.dispose()
    else:
        raise ValueError(f"Unknown data_model op: {op}")


_GET_DATA_MODEL_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalogPaths",
    "expect",
    "messages",
    "payload",
    "protocolVersion",
    "steps",
})
_GET_DATA_MODEL_ARGS_KEYS: frozenset[str] = frozenset({
    "version",
})
_GET_DATA_MODEL_STEP_KEYS: frozenset[str] = frozenset({
    "messages",
    "payload",
})


def _feed_renderer_data_model_messages(
    processor: MessageProcessor, case: dict[str, Any]
) -> None:
    steps = case.get("steps")
    if steps:
        for idx, step in enumerate(steps):
            _assert_known_keys(step, _GET_DATA_MODEL_STEP_KEYS, f"steps[{idx}] key")
            msgs = step.get("messages") or step.get("payload")
            assert msgs, f"Step {idx} has no messages or payload"
            processor.process_messages(msgs)
        return
    msgs = case.get("messages") or ([case["payload"]] if "payload" in case else [])
    assert msgs, "get_renderer_data_model case has no messages or payload"
    processor.process_messages(msgs)


def validate_get_renderer_data_model_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _GET_DATA_MODEL_CASE_KEYS, "case key")
    assert "expect" in case, "get_renderer_data_model case requires 'expect'"
    processor = MessageProcessor(get_catalogs_for_test_case(case))
    _feed_renderer_data_model_messages(processor, case)
    args = case.get("args") or {}
    _assert_known_keys(args, _GET_DATA_MODEL_ARGS_KEYS, "args key")
    ver = args.get("version") or resolve_protocol_version(case)
    res = processor.get_renderer_data_model(ver)
    expected = case.get("expect")
    if expected is None:
        assert res is None
    elif isinstance(expected, dict):
        assert res == (expected["data"] if "data" in expected else expected)
    else:
        pytest.fail(f"Unexpected expect value {expected!r} in {_CURRENT_CASE_KEY}")


_HANDLE_RPC_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalog",
    "expect",
    "expectError",
    "protocolVersion",
})
_HANDLE_RPC_ARGS_KEYS: frozenset[str] = frozenset({
    "catalogId",
    "catalogVersion",
    "dataModel",
    "disposeBeforeResponse",
    "functionMetadata",
    "inboundResponse",
    "message",
    "outboundCall",
    "secondOutboundCall",
    "surfaceId",
    "uiActionFallbackScenario",
    "uiBindingScenario",
    "userActivationPresent",
})
_HANDLE_RPC_EXPECT_KEYS: frozenset[str] = frozenset({
    "correlatedCallId",
    "error",
    "initialValue",
    "outboundCall",
    "resolvedValue",
    "response",
    "result",
})
_UI_BINDING_SCENARIO_KEYS: frozenset[str] = frozenset({
    "catalogId",
    "component",
    "inboundResponseValue",
    "surfaceId",
})
_UI_ACTION_FALLBACK_SCENARIO_KEYS: frozenset[str] = frozenset({
    "actionPayload",
    "catalogId",
    "inboundResponseValue",
    "surfaceId",
})


def _make_mock_rpc_executor(name: str) -> Callable[..., Any]:
    def execute(fn_args: dict[str, Any], *_args: Any, **_kwargs: Any) -> Any:
        if name == "playMedia":
            return {"playing": True, "timestamp": 0}
        if name == "openExternalUrl":
            return {"opened": True}
        if name == "syncState":
            return None
        if name == "failingFunction":
            raise RuntimeError("An error occurred during function execution.")
        if name == "calculateTax":
            amount = (fn_args or {}).get("amount", 0)
            return amount * 0.1
        if name == "echoArgs":
            return dict(fn_args or {})
        return None

    return execute


def _build_rpc_mock_functions(fn_metadata: dict[str, Any]) -> list[Any]:
    from a2ui.core.catalog import FunctionImplementation

    funcs: list[FunctionImplementation] = []
    for fn_name, meta in fn_metadata.items():
        allowed = meta.get("allowedCallers", "rendererOrAgent")
        requires_activation = meta.get("requiresUserActivation", False)
        fn_schema = meta.get("schema") or meta.get("parameters") or {"type": "object"}
        funcs.append(
            FunctionImplementation(
                name=fn_name,
                return_type=meta.get("returnType", "any"),
                schema=fn_schema,
                execute=_make_mock_rpc_executor(fn_name),
                allowed_callers=allowed,
                requires_user_activation=requires_activation,
            )
        )
    return funcs


def _start_rpc_outbound_call(processor: MessageProcessor, spec: dict[str, Any]) -> Any:
    from a2ui.core.rpc import CallOptions
    from a2ui.core.schema.v1_0.common_types import FunctionCall

    call_fn = spec["callFunction"]
    call_name = call_fn.get("@call") or call_fn.get("call")
    return processor.call_agent_function(
        surface_id=spec["surfaceId"],
        call=FunctionCall(
            call=call_name,
            catalogId=call_fn.get("catalogId")
            or "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
            args=call_fn.get("args"),
        ),
        options=CallOptions(
            function_call_id=spec["functionCallId"],
            version="1.0",
            timeout_ms=spec.get("timeoutMs"),
        ),
    )


def _run_rpc_outbound_success(
    outbound_call: dict[str, Any],
    inbound_response: dict[str, Any],
    expect_dict: dict[str, Any],
    processor: MessageProcessor,
) -> None:
    correlated_id = expect_dict.get("correlatedCallId")
    if correlated_id is not None:
        assert (
            inbound_response["agentFunctionResponse"]["functionCallId"] == correlated_id
        )
    fut = _start_rpc_outbound_call(processor, outbound_call)
    processor.process_messages(inbound_response)
    assert fut.done()
    assert fut.result() == expect_dict.get("result")


def _run_rpc_outbound_error(
    args: dict[str, Any],
    outbound_call: dict[str, Any],
    inbound_response: Any,
    expected_err: dict[str, Any],
    processor: MessageProcessor,
) -> None:
    import asyncio

    from a2ui.core.exceptions import A2uiRpcError

    if "secondOutboundCall" in args:

        async def _expect_duplicate() -> None:
            pending = _start_rpc_outbound_call(processor, outbound_call)
            with pytest.raises(A2uiRpcError) as exc_info:
                _start_rpc_outbound_call(processor, args["secondOutboundCall"])
            assert exc_info.value.code == expected_err.get("code", "DUPLICATE")
            pending.cancel()

        asyncio.run(_expect_duplicate())
    elif inbound_response:

        async def _expect_inbound_error() -> None:
            pending = _start_rpc_outbound_call(processor, outbound_call)
            processor.process_messages(inbound_response)
            with pytest.raises(A2uiRpcError) as exc_info:
                await pending
            if "code" in expected_err:
                assert exc_info.value.code == expected_err["code"]
            if "message" in expected_err:
                assert expected_err["message"] in str(exc_info.value)

        asyncio.run(_expect_inbound_error())
    elif args.get("disposeBeforeResponse"):

        async def _expect_cancelled() -> None:
            pending = _start_rpc_outbound_call(processor, outbound_call)
            processor.rpc.dispose()
            with pytest.raises((A2uiRpcError, asyncio.CancelledError)) as exc_info:
                await pending
            if isinstance(exc_info.value, A2uiRpcError) and "code" in expected_err:
                assert exc_info.value.code == expected_err["code"]

        asyncio.run(_expect_cancelled())
    elif "timeoutMs" in outbound_call:

        async def _expect_timeout() -> None:
            with pytest.raises(A2uiRpcError) as exc_info:
                await _start_rpc_outbound_call(processor, outbound_call)
            assert exc_info.value.code == expected_err.get("code", "TIMEOUT")

        asyncio.run(_expect_timeout())
    else:
        pytest.fail(f"Unhandled outboundCall error scenario in {_CURRENT_CASE_KEY}")


def _assert_outbound_call_agent_message(
    outbound_messages: list[dict[str, Any]], expected_outbound: dict[str, Any]
) -> str:
    call_msgs = [m for m in outbound_messages if "callAgentFunction" in m]
    assert (
        len(call_msgs) == 1
    ), f"Expected 1 outbound callAgentFunction message, got {call_msgs}"
    outbound = call_msgs[0]
    assert outbound.get("version") == expected_outbound.get("version")
    actual_call = outbound["callAgentFunction"]
    expected_call = expected_outbound["callAgentFunction"]
    assert actual_call.get("surfaceId") == expected_call.get("surfaceId")
    assert actual_call.get("callFunction") == expected_call.get("callFunction")
    call_id = actual_call.get("functionCallId")
    assert isinstance(call_id, str) and call_id
    return call_id


def _run_ui_binding_scenario(
    scenario: dict[str, Any],
    expected: dict[str, Any],
    processor: MessageProcessor,
    outbound_messages: list[dict[str, Any]],
) -> None:
    from a2ui.core.resolution import NodeResolver, ResolvedBinding
    from a2ui.core.state import ComponentModel

    _assert_known_keys(
        scenario, _UI_BINDING_SCENARIO_KEYS, "args.uiBindingScenario key"
    )
    surface_id = scenario["surfaceId"]
    scenario_cat_id = scenario["catalogId"]
    scenario_cat = Catalog(
        catalog_id=scenario_cat_id,
        protocol_version="1.0",
        components=list(v10_catalog.components.values()),
        functions=[],
    )
    surface = SurfaceModel(
        surface_id=surface_id,
        default_catalog=scenario_cat,
        available_catalogs={scenario_cat_id: scenario_cat},
        protocol_version="1.0",
    )
    processor.model.add_surface(surface)
    comp = dict(scenario["component"])
    comp_id = comp.pop("id")
    comp_type = comp.pop("component")
    surface.components_model.add_component(
        ComponentModel(comp_id, comp_type, scenario_cat, comp)
    )
    resolver = NodeResolver(surface, scenario_cat)
    try:
        root = resolver.root
        assert root is not None, "Expected root ComponentNode to be mounted"
        initial_binding = root.props.get("text")
        initial_val = (
            initial_binding.value
            if isinstance(initial_binding, ResolvedBinding)
            else initial_binding
        )
        assert initial_val == expected.get("initialValue")

        call_id = _assert_outbound_call_agent_message(
            outbound_messages, expected["outboundCall"]
        )
        processor.process_messages({
            "version": "1.0",
            "agentFunctionResponse": {
                "functionCallId": call_id,
                "value": scenario["inboundResponseValue"],
            },
        })
        resolved_binding = root.props.get("text")
        resolved_val = (
            resolved_binding.value
            if isinstance(resolved_binding, ResolvedBinding)
            else resolved_binding
        )
        assert resolved_val == expected.get("resolvedValue")
    finally:
        resolver.dispose()
        surface.dispose()


def _run_ui_action_fallback_scenario(
    scenario: dict[str, Any],
    expected: dict[str, Any],
    processor: MessageProcessor,
    outbound_messages: list[dict[str, Any]],
) -> None:
    import asyncio
    import inspect

    _assert_known_keys(
        scenario,
        _UI_ACTION_FALLBACK_SCENARIO_KEYS,
        "args.uiActionFallbackScenario key",
    )
    surface_id = scenario["surfaceId"]
    scenario_cat_id = scenario["catalogId"]
    scenario_cat = Catalog(
        catalog_id=scenario_cat_id,
        protocol_version="1.0",
        components=[],
        functions=[],
    )
    surface = SurfaceModel(
        surface_id=surface_id,
        default_catalog=scenario_cat,
        available_catalogs={scenario_cat_id: scenario_cat},
        protocol_version="1.0",
    )
    processor.model.add_surface(surface)
    context = DataContext(surface=surface, path="/")

    async def _run() -> None:
        action_res = context.resolve_action(scenario["actionPayload"])
        call_id = _assert_outbound_call_agent_message(
            outbound_messages, expected["outboundCall"]
        )
        processor.process_messages({
            "version": "1.0",
            "agentFunctionResponse": {
                "functionCallId": call_id,
                "value": scenario["inboundResponseValue"],
            },
        })
        result = await action_res if inspect.isawaitable(action_res) else action_res
        assert result == expected.get("result")

    try:
        asyncio.run(_run())
    finally:
        surface.dispose()


def validate_handle_rpc_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _HANDLE_RPC_CASE_KEYS, "case key")
    args = case.get("args", {})
    _assert_known_keys(args, _HANDLE_RPC_ARGS_KEYS, "args key")
    expect_dict = case.get("expect") or {}
    _assert_known_keys(expect_dict, _HANDLE_RPC_EXPECT_KEYS, "expect key")

    message = args.get("message")
    outbound_call = args.get("outboundCall")
    inbound_response = args.get("inboundResponse")
    fn_metadata = args.get("functionMetadata", {})
    user_activation = bool(args.get("userActivationPresent", False))

    funcs = _build_rpc_mock_functions(fn_metadata)
    cat_id, cat_version = _resolve_rpc_catalog_info(args, message, outbound_call, case)
    catalogs = _build_rpc_catalogs(cat_id, cat_version, funcs)
    outbound_messages: list[dict[str, Any]] = []
    captured_renderer_errors: list[dict[str, Any]] = []
    processor = MessageProcessor(
        catalogs=catalogs,
        options=MessageProcessorOptions(
            outbound_listener=lambda msg: outbound_messages.append(msg),
            error_handler=lambda msg: captured_renderer_errors.append(msg),
        ),
    )
    _setup_rpc_surface_if_needed(args, catalogs[0], catalogs, cat_version, processor)

    handled = False
    if message:
        _verify_rpc_inbound_message(
            message, case, processor, user_activation, captured_renderer_errors
        )
        handled = True

    has_err = bool(case.get("expectError") or expect_dict.get("error"))
    if outbound_call and inbound_response and not has_err:
        _run_rpc_outbound_success(
            outbound_call, inbound_response, expect_dict, processor
        )
        handled = True
    elif outbound_call and has_err:
        expected_err = case.get("expectError") or expect_dict.get("error") or {}
        _run_rpc_outbound_error(
            args, outbound_call, inbound_response, expected_err, processor
        )
        handled = True

    if "uiBindingScenario" in args:
        _run_ui_binding_scenario(
            args["uiBindingScenario"], expect_dict, processor, outbound_messages
        )
        handled = True

    if "uiActionFallbackScenario" in args:
        _run_ui_action_fallback_scenario(
            args["uiActionFallbackScenario"],
            expect_dict,
            processor,
            outbound_messages,
        )
        handled = True

    if not handled:
        pytest.fail(f"No handle_rpc scenario branch matched in {_CURRENT_CASE_KEY}")


def validate_accessibility_check_case(case: dict[str, Any]) -> None:
    del case
    pytest.skip(UNRUNNABLE_SUITES["core/accessibility.yaml"])


_SELECT_CATALOG_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalog",
    "expectError",
    "expectSelected",
})
_SELECT_CATALOG_ARGS_KEYS: frozenset[str] = frozenset({
    "catalogs",
    "components",
    "functionCall",
    "surface",
})
_SELECT_CATALOG_SURFACE_KEYS: frozenset[str] = frozenset({
    "defaultCatalogId",
    "id",
    "supportedCatalogIds",
})
_SELECT_CATALOG_FUNCTION_CALL_KEYS: frozenset[str] = frozenset({
    "@call",
    "args",
    "call",
    "catalogId",
})


def _build_select_catalog_surface(
    args: dict[str, Any], surface_args: dict[str, Any]
) -> tuple[str, CatalogApi, dict[str, CatalogApi], SurfaceModel]:
    s_id = surface_args.get("id", "main_surface")
    default_cat_id = surface_args.get("defaultCatalogId", "basic")

    catalogs_dict: dict[str, CatalogApi] = {}
    if "catalogs" in args and isinstance(args["catalogs"], dict):
        for cat_id, cat_def in args["catalogs"].items():
            p_ver = cat_def.get("protocolVersion", "1.0")
            catalogs_dict[cat_id] = Catalog(
                catalog_id=cat_id,
                protocol_version=p_ver,
            )
    else:
        for cat_id in surface_args.get("supportedCatalogIds", [default_cat_id]):
            catalogs_dict[cat_id] = Catalog(
                catalog_id=cat_id,
                protocol_version="1.0",
            )

    default_cat = catalogs_dict.get(
        default_cat_id,
        Catalog(catalog_id=default_cat_id, protocol_version="1.0"),
    )
    surface = SurfaceModel(
        surface_id=s_id,
        default_catalog=default_cat,
        available_catalogs=catalogs_dict,
    )
    return s_id, default_cat, catalogs_dict, surface


def _select_catalog_for_components(
    components: dict[str, Any],
    s_id: str,
    default_cat: CatalogApi,
    catalogs_dict: dict[str, CatalogApi],
    surface: SurfaceModel,
    check_version_mismatch: bool,
) -> str | None:
    from a2ui.core.state import ComponentModel

    last_selected: str | None = None
    for c_id, c_data in components.items():
        comp_cat_id = c_data.get("catalogId")
        if comp_cat_id:
            if comp_cat_id not in catalogs_dict:
                raise A2uiCatalogError(
                    f"Catalog '{comp_cat_id}' is not supported by surface '{s_id}'."
                )
            comp_cat = catalogs_dict[comp_cat_id]
            if check_version_mismatch:
                def_ver = getattr(default_cat, "protocol_version", None)
                cat_ver = getattr(comp_cat, "protocol_version", None)
                if def_ver and cat_ver and def_ver != cat_ver:
                    raise A2uiCatalogError(
                        f"Component '{c_id}' catalog protocol version {cat_ver}"
                        f" mismatches default catalog protocol version {def_ver}."
                    )
        else:
            comp_cat = default_cat
        last_selected = comp_cat.catalog_id
        comp_model = ComponentModel(
            c_id, c_data.get("component", "Box"), catalog=comp_cat
        )
        surface.components_model.add_component(comp_model)
    return last_selected


def _run_select_catalog_error_case(
    args: dict[str, Any],
    s_id: str,
    default_cat: Any,
    catalogs_dict: dict[str, Any],
    surface: SurfaceModel,
) -> None:
    def_ver = getattr(default_cat, "protocol_version", None)
    for cat_id, cat in catalogs_dict.items():
        cat_ver = getattr(cat, "protocol_version", None)
        if def_ver and cat_ver and def_ver != cat_ver:
            raise A2uiCatalogError(
                f"Protocol version mismatch: cannot mix catalog '{cat_id}'"
                f" ({cat_ver}) with surface version {def_ver}."
            )

    if "components" in args:
        _select_catalog_for_components(
            args["components"],
            s_id,
            default_cat,
            catalogs_dict,
            surface,
            check_version_mismatch=True,
        )
    elif "functionCall" in args:
        fn_call = args["functionCall"]
        ctx = DataContext(surface=surface, path="/")
        ctx._execute_function(
            fn_call.get("@call") or fn_call["call"],
            fn_call.get("args", {}),
            catalog_id=fn_call.get("catalogId"),
        )


def validate_select_catalog_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _SELECT_CATALOG_CASE_KEYS, "case key")
    assert (
        "expectError" in case or "expectSelected" in case
    ), "select_catalog case requires 'expectError' or 'expectSelected'"
    args = case.get("args", {})
    _assert_known_keys(args, _SELECT_CATALOG_ARGS_KEYS, "args key")
    surface_args = args.get("surface", {})
    _assert_known_keys(surface_args, _SELECT_CATALOG_SURFACE_KEYS, "args.surface key")
    if isinstance(args.get("functionCall"), dict):
        _assert_known_keys(
            args["functionCall"],
            _SELECT_CATALOG_FUNCTION_CALL_KEYS,
            "args.functionCall key",
        )

    s_id, default_cat, catalogs_dict, surface = _build_select_catalog_surface(
        args, surface_args
    )
    expect_err = case.get("expectError")

    if expect_err:
        with assert_raises(expect_err):
            _run_select_catalog_error_case(
                args, s_id, default_cat, catalogs_dict, surface
            )
    elif "components" in args:
        last_selected = _select_catalog_for_components(
            args["components"],
            s_id,
            default_cat,
            catalogs_dict,
            surface,
            check_version_mismatch=False,
        )
        assert last_selected == case["expectSelected"]
    elif "functionCall" in args:
        fn_cat_id = args["functionCall"].get("catalogId")
        if fn_cat_id:
            if fn_cat_id not in catalogs_dict:
                raise A2uiCatalogError(f"Catalog not found: {fn_cat_id}")
            selected = catalogs_dict[fn_cat_id].catalog_id
        else:
            assert surface.default_catalog is not None
            selected = surface.default_catalog.catalog_id
        assert selected == case["expectSelected"]
    else:
        pytest.fail(
            "select_catalog case requires 'components' or 'functionCall' in"
            f" {_CURRENT_CASE_KEY}"
        )


_PARSE_EXPRESSION_TEMPLATE_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "expect",
    "expect_error",
    "expectError",
    "input",
})


def validate_parse_expression_template_case(case: dict[str, Any]) -> None:
    from a2ui.core.expressions.expression_parser import ExpressionParser

    _assert_known_keys(case, _PARSE_EXPRESSION_TEMPLATE_CASE_KEYS, "case key")
    assert (
        "expect" in case or "expect_error" in case or "expectError" in case
    ), "parse_expression_template case requires 'expect' or 'expect_error'"
    input_str = case.get("input", "")
    expect_error = case.get("expect_error") or case.get("expectError")
    parser = ExpressionParser()

    if expect_error:
        _assert_known_keys(expect_error, _EXPECT_ERROR_KEYS, "expect_error key")
        cat = expect_error.get("category", "ParseError")
        msg = expect_error.get("message")
        expected_types = CATEGORY_TO_EXCEPTION.get(cat, (A2uiError, ValueError))
        with pytest.raises(expected_types) as exc_info:
            parser.parse(input_str)
        if msg:
            assert re.search(
                msg, str(exc_info.value)
            ), f"Expected message matching '{msg}', got '{exc_info.value}'"
        return

    result = parser.parse(input_str)

    # Join adjacent literal strings
    joined: list[Any] = []
    for part in result:
        if isinstance(part, str) and joined and isinstance(joined[-1], str):
            joined[-1] += part
        else:
            joined.append(part)
    joined = [p for p in joined if p != ""]

    expected = case.get("expect", [])
    assert joined == expected


def _resolve_rpc_catalog_info(
    args: dict[str, Any],
    message: Any,
    outbound_call: Any,
    case: dict[str, Any],
) -> tuple[str, str]:
    cat_id = args.get("catalogId")
    if not cat_id and isinstance(message, dict) and "callRendererFunction" in message:
        msg_cat_id = (
            message.get("callRendererFunction", {})
            .get("callFunction", {})
            .get("catalogId")
        )
        expect_err_msg = (
            case.get("expect", {})
            .get("response", {})
            .get("rendererFunctionResponse", {})
            .get("error", {})
            .get("message", "")
        )
        if "Catalog not found" not in expect_err_msg:
            cat_id = msg_cat_id
    if not cat_id and isinstance(outbound_call, dict):
        cat_id = outbound_call.get("callFunction", {}).get("catalogId")
    cat_spec = case.get("catalog") if isinstance(case.get("catalog"), dict) else {}
    cat_version = (
        args.get("catalogVersion")
        or cat_spec.get("protocolVersion")
        or case.get("protocolVersion")
        or "1.0"
    )
    return cat_id or "basic", cat_version


def _build_rpc_catalogs(
    cat_id: str, cat_version: str, funcs: list[Any]
) -> list[Catalog]:
    fn_names = {f.name for f in funcs}
    if cat_id == "basic":
        for bf in v10_catalog.functions.values():
            if bf.name not in fn_names:
                funcs.append(bf)
    cat = Catalog(
        catalog_id=cat_id,
        protocol_version=cat_version,
        components=[],
        functions=funcs,
    )
    if cat_id == "basic":
        return [cat]
    return [
        cat,
        Catalog(
            catalog_id="basic",
            protocol_version=cat_version,
            components=[],
            functions=list(v10_catalog.functions.values()),
        ),
    ]


def _setup_rpc_surface_if_needed(
    args: dict[str, Any],
    cat: Catalog,
    catalogs: list[Catalog],
    cat_version: str,
    processor: MessageProcessor,
) -> None:
    setup_sid = args.get("surfaceId")
    if not setup_sid or not isinstance(setup_sid, str):
        return
    setup_surface = SurfaceModel(
        surface_id=setup_sid,
        default_catalog=cat,
        available_catalogs={c.catalog_id: c for c in catalogs},
        protocol_version=cat_version,
    )
    if isinstance(args.get("dataModel"), dict):
        setup_surface.data_model.set("/", args["dataModel"])
    processor.model.add_surface(setup_surface)


def _assert_rpc_response_payload(
    responses: list[Any], expect_resp: dict[str, Any] | None
) -> None:
    if expect_resp is None:
        assert len(responses) == 0
        return
    assert len(responses) == 1
    actual = responses[0]
    assert actual.get("version") == expect_resp.get("version")
    actual_rf = actual.get("rendererFunctionResponse", {})
    expected_rf = expect_resp.get("rendererFunctionResponse", {})
    assert actual_rf.get("functionCallId") == expected_rf.get("functionCallId")
    if "value" in expected_rf:
        assert actual_rf.get("value") == expected_rf.get("value")
    if "error" in expected_rf:
        actual_err = actual_rf.get("error", {})
        assert actual_err.get("code") == expected_rf["error"].get("code")
        if "message" in expected_rf["error"]:
            assert expected_rf["error"]["message"] in actual_err.get("message", "")


def _verify_rpc_inbound_message(
    message: Any,
    case: dict[str, Any],
    processor: MessageProcessor,
    user_activation: bool,
    captured_renderer_errors: list[dict[str, Any]],
) -> None:
    import asyncio
    from a2ui.core.processing import ExecutionContext

    expect_dict = case.get("expect") or {}
    expect_err = case.get("expectError") or expect_dict.get("error")
    if expect_err:
        with assert_raises(expect_err, captured_renderer_errors):
            processor.process_messages(message)
    elif "response" in expect_dict:
        responses = asyncio.run(
            processor.process_messages_async(
                message,
                context=ExecutionContext(is_user_activated=user_activation),
            )
        )
        _assert_rpc_response_payload(responses, expect_dict["response"])
    else:
        pytest.fail(
            "Inbound handle_rpc case requires expectError, expect.error, or"
            f" expect.response in {_CURRENT_CASE_KEY}"
        )


_DISPATCH_ACTION_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "actionPayload",
    "catalog",
    "catalogPaths",
    "catalogs",
    "dataModel",
    "expectDataModel",
    "expectDispatched",
    "expectError",
    "metadata",
    "protocolVersion",
    "scope",
    "sourceComponentId",
    "surfaceId",
    "useBasicCatalog",
    "userActivation",
})
_EXPECT_DISPATCHED_KEYS: frozenset[str] = frozenset({
    "catalogId",
    "context",
    "hasTimestamp",
    "metadata",
    "name",
    "sourceComponentId",
    "surfaceId",
    "timestampIso8601",
    "userMessage",
})


def _assert_dispatched_action_event(
    case: dict[str, Any],
    expect_dispatched: dict[str, Any] | None,
    dispatched: list[dict[str, Any]],
) -> None:
    if "expectDispatched" in case and expect_dispatched is None:
        assert len(dispatched) == 0, f"Expected no dispatched event, got {dispatched}"
        return
    if expect_dispatched is None:
        return
    _assert_known_keys(
        expect_dispatched, _EXPECT_DISPATCHED_KEYS, "expectDispatched key"
    )
    assert len(dispatched) >= 1, "Expected action to be dispatched, but none was"
    actual = dispatched[0]
    for key in (
        "name",
        "context",
        "userMessage",
        "surfaceId",
        "sourceComponentId",
        "metadata",
    ):
        if key in expect_dispatched:
            assert actual.get(key) == expect_dispatched[key]
    if expect_dispatched.get("hasTimestamp") or expect_dispatched.get(
        "timestampIso8601"
    ):
        assert isinstance(actual.get("timestamp"), str) and bool(
            actual.get("timestamp")
        )


def _build_dispatch_action_catalog(case: dict[str, Any]) -> Any:
    import copy
    from a2ui.core.catalog import FunctionImplementation

    catalogs = get_catalogs_for_test_case(case)
    base_cat = catalogs[0] if catalogs else v09_catalog

    def _inc_counter(args: dict[str, Any], ctx: Any = None, _sig: Any = None) -> None:
        target_path = args.get("path", "/count")
        step = args.get("step", 1)
        curr = ctx.data_model.get(target_path) or 0
        ctx.data_model.set(target_path, curr + step)

    def _fail_action(_args: dict[str, Any], _ctx: Any = None, _sig: Any = None) -> None:
        raise RuntimeError("Action execution failed")

    default_cat = copy.copy(base_cat)
    default_cat.functions = dict(getattr(base_cat, "functions", {}) or {})
    default_cat.functions["incrementCounter"] = FunctionImplementation(
        name="incrementCounter",
        return_type="void",
        schema={
            "type": "object",
            "properties": {"path": {"type": "string"}, "step": {"type": "number"}},
        },
        execute=_inc_counter,
    )
    default_cat.functions["failingAction"] = FunctionImplementation(
        name="failingAction",
        return_type="void",
        schema={"type": "object", "properties": {}},
        execute=_fail_action,
    )
    return default_cat


def validate_dispatch_action_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _DISPATCH_ACTION_CASE_KEYS, "case key")
    assert (
        "expectError" in case or "expectDispatched" in case or "expectDataModel" in case
    ), "dispatch_action case requires an expectation"
    action_payload = case["actionPayload"]
    surface_id = case.get("surfaceId", "main")
    source_comp_id = case.get("sourceComponentId", "test_comp")
    user_activation = bool(case.get("userActivation", True))
    expect_error = case.get("expectError")

    default_cat = _build_dispatch_action_catalog(case)
    data_model = DataModel(case.get("dataModel") or {})
    surface = SurfaceModel(
        surface_id=surface_id,
        default_catalog=default_cat,
        data_model=data_model,
        protocol_version=default_cat.protocol_version,
    )
    dispatched: list[dict[str, Any]] = []
    surface_errors: list[dict[str, Any]] = []
    captured_renderer_errors: list[dict[str, Any]] = []
    surface.on_action.subscribe(lambda evt: dispatched.append(evt))

    raw_ver = str(getattr(default_cat, "protocol_version", "v0.9") or "v0.9")
    ver = raw_ver if raw_ver.startswith("v") else f"v{raw_ver}"

    def _on_surf_err(err: dict[str, Any]) -> None:
        surface_errors.append(err)
        captured_renderer_errors.append({"version": ver, "error": dict(err)})

    surface.on_error.subscribe(_on_surf_err)
    context = DataContext(surface=surface, path=case.get("scope") or "/")

    if expect_error:
        with assert_raises(expect_error, captured_renderer_errors):
            resolved = context.resolve_action(
                action_payload, is_user_activated=user_activation
            )
            if isinstance(resolved, dict):
                surface.dispatch_action(
                    resolved,
                    source_component_id=source_comp_id,
                    metadata=case.get("metadata"),
                )
            if surface_errors:
                err = surface_errors[-1]
                raise A2uiValidationError(
                    err.get("message", "Invalid action"),
                    code=err.get("code"),
                    surface_id=err.get("surfaceId"),
                )
    else:
        resolved = context.resolve_action(
            action_payload, is_user_activated=user_activation
        )
        if isinstance(resolved, dict):
            surface.dispatch_action(
                resolved,
                source_component_id=source_comp_id,
                metadata=case.get("metadata"),
            )
        _assert_dispatched_action_event(case, case.get("expectDispatched"), dispatched)
        if case.get("expectDataModel") is not None:
            assert data_model.get("/") == case["expectDataModel"]


def _normalize_version(version: Any) -> str:
    text = str(getattr(version, "value", version) or "")
    return text[1:] if text.startswith("v") else text


def _load_catalog_path(path: str) -> CatalogApi:
    """Loads a catalogPaths entry as the catalog built for its own protocol version.

    The published basic catalogs map to the SDK's basic catalogs, which carry
    the function implementations. Any other file is built from its JSON, for
    the protocol version it declares.
    """
    full_p = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", path))
    with open(full_p, "r", encoding="utf-8") as f:
        c_json = json.load(f)
    c_id = c_json.get("catalogId")
    for sdk_cat in (v08_catalog, v09_catalog, v10_catalog):
        if c_id == sdk_cat.catalog_id:
            return sdk_cat
    return Catalog.from_json(
        c_json,
        catalog_id=c_id,
        protocol_version=f"v{_normalize_version(c_json.get('protocolVersion'))}",
    )


class _RaisingSurfaceModel(SurfaceModel):
    """A surface that raises evaluation errors rather than dispatching them.

    A surface reports a failed function call as an error payload, which drops
    the exception class. Re-raising the exception being handled lets a case
    check the error category.
    """

    def dispatch_error(self, error: dict[str, Any]) -> None:
        exc = sys.exc_info()[1]
        if exc is None:
            super().dispatch_error(error)
            return
        raise exc


_EVALUATE_FUNCTION_CASE_KEYS: frozenset[str] = _CASE_METADATA_KEYS | frozenset({
    "action",
    "args",
    "catalogId",
    "catalogPaths",
    "dataModel",
    "expect",
    "expect_error",
    "expectError",
    "function",
    "locale",
    "protocolVersion",
    "surface",
    "useBasicCatalog",
})
_EVALUATE_FUNCTION_SURFACE_KEYS: frozenset[str] = frozenset({
    "catalogId",
})


def _evaluate_function_on_surface(case: dict[str, Any]) -> Any:
    """Evaluates the case's function as a call on a surface (the `surface` block).

    The surface is built for the case's protocolVersion. Its available catalogs
    are the catalogPaths entries built for that version, and its default
    catalog is the one `surface.catalogId` names, if any. The call goes through
    the SDK's catalog resolution, naming the case's call-level `catalogId`.
    """
    _assert_known_keys(case["surface"], _EVALUATE_FUNCTION_SURFACE_KEYS, "surface key")
    version = case["protocolVersion"]
    available = {
        cat.catalog_id: cat
        for cat in (_load_catalog_path(p) for p in case["catalogPaths"])
        if _normalize_version(cat.protocol_version) == _normalize_version(version)
    }
    default_id = case["surface"].get("catalogId")
    default_cat = available[default_id] if default_id else None
    surface = _RaisingSurfaceModel(
        surface_id="main",
        default_catalog=default_cat,
        available_catalogs=available,
        data_model=DataModel(case.get("dataModel") or {}),
        protocol_version=version,
    )
    surface.locale = case.get("locale", "en-US")
    context = DataContext(surface=surface, path="/")
    call_key = "@call" if context.at_least_v10 else "call"
    call: dict[str, Any] = {call_key: case["function"], "args": case["args"]}
    if "catalogId" in case:
        call["catalogId"] = case["catalogId"]
    return context.resolve_dynamic_value(call)


def _evaluate_function_standalone(case: dict[str, Any]) -> Any:
    func_name = case["function"]
    args = case["args"]
    catalogs = get_catalogs_for_test_case(case)
    default_cat = catalogs[0] if catalogs else v09_catalog
    surface = SurfaceModel(
        surface_id="main",
        default_catalog=default_cat,
        data_model=DataModel(case.get("dataModel") or {}),
    )
    surface.locale = case.get("locale", "en-US")
    context = DataContext(surface=surface, path="/")
    functions = getattr(default_cat, "functions", None)
    if functions and func_name in functions:
        fn = functions[func_name]
        if getattr(fn, "execute_func", None) is not None:
            return fn.execute_func(args, context)
        return fn.execute(args, context)
    return context.resolve_dynamic_value({"call": func_name, "args": args})


def validate_evaluate_function_case(case: dict[str, Any]) -> None:
    _assert_known_keys(case, _EVALUATE_FUNCTION_CASE_KEYS, "case key")
    assert (
        "expect" in case or "expectError" in case or "expect_error" in case
    ), "evaluate_function case requires 'expect' or 'expectError'"
    expect_error = case.get("expectError") or case.get("expect_error")
    runner = (
        _evaluate_function_on_surface
        if "surface" in case
        else _evaluate_function_standalone
    )
    if expect_error:
        with assert_raises(expect_error):
            runner(case)
    else:
        assert runner(case) == case.get("expect")


_ACTION_HANDLERS: dict[str, Callable[[dict[str, Any]], None]] = {
    "accessibility_check": validate_accessibility_check_case,
    "agent_to_renderer_schema": validate_agent_to_renderer_schema_case,
    "common_types_schema": validate_common_types_schema_case,
    "data_model": validate_data_model_case,
    "derive": validate_derive_case,
    "dispatch_action": validate_dispatch_action_case,
    "evaluate_function": validate_evaluate_function_case,
    "from_json": validate_from_json_case,
    "get_client_capabilities": validate_capabilities_case,
    "get_client_data_model": validate_get_renderer_data_model_case,
    "get_renderer_capabilities": validate_capabilities_case,
    "get_renderer_data_model": validate_get_renderer_data_model_case,
    "handle_rpc": validate_handle_rpc_case,
    "parse_expression_template": validate_parse_expression_template_case,
    "process_messages": validate_process_messages_case,
    "resolve_nodes": _validate_resolve_nodes_case,
    "resolve_path": validate_resolve_path_case,
    "round_trip": validate_round_trip_case,
    "select_catalog": validate_select_catalog_case,
    "to_json": validate_to_json_case,
    "validate": validate_pure_validation_case,
    "validate_common_type": validate_common_type_case,
    "validation_schema": validate_validation_schema_case,
}
