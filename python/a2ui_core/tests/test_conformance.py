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

import asyncio
import contextlib
import glob
import json
import os
import re
import sys
from pathlib import Path
from collections.abc import Callable
from typing import Any
from pydantic import TypeAdapter
import pytest
import yaml

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
from a2ui.core.catalog import Catalog, CatalogApi, FunctionApi
from a2ui.core.basic_catalog import v0_8, v0_9, v1_0
from a2ui.core.common import to_canonical_version
from a2ui.core.schema import ProtocolVersion
from a2ui.core.schema.v0_9 import ClientToServerMessage
from a2ui.core.schema.v1_0 import RendererToAgentMessage
from a2ui.core.state import ComponentModel, DataModel, SurfaceModel
from a2ui.core.resolution import ComponentContext, DataContext, GenericBinder
from a2ui.core.processing import (
    CapabilitiesOptions,
    MessageProcessor,
    MessageProcessorOptions,
)
from a2ui.core.validation import (
    RELAXED_VALIDATION,
    STRICT_VALIDATION,
    PayloadValidator,
    ValidationConfig,
)
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

SKIP_TEST_NAMES: set[str] = {
    # A known difference of the Python core: its topology checks read a v0.8
    # string property as a child reference when it names a component the
    # surface holds, which the TypeScript and Kotlin cores do not.
    "test_v08_topology_plain_string_property_not_treated_as_child_ref",
    "test_v08_topology_plain_string_property_does_not_close_cycle",
    # Cases of the optional agent_renderer_app feature
    # (blueprints/features/agent_renderer_app.blueprint.md), which takes the
    # validation rules for one call. This SDK has no renderer, so it does not
    # implement the feature.
    "test_v10_call_validation_config_relaxes_strict_processor",
    "test_v10_call_validation_config_tightens_permissive_processor",
    "test_v10_call_validation_config_leaves_out_rules_as_strict",
}

# Transition skip list containing specific test suite files or basenames to skip entirely.
SKIP_TEST_SUITES: set[str] = set()

# Suites the core library cannot meaningfully execute, with the reason for each.
# The core library has no access to the UI frameworks that apply accessibility
# attributes, so running these here would only exercise mocks. The framework
# renderers will run them once the v1.0 catalogs land for those renderers.
UNRUNNABLE_SUITES: dict[str, str] = {
    "core/accessibility.yaml": (
        "Accessibility attributes are applied by the UI framework renderers"
        " (Lit, React, Angular, Flutter, SwiftUI), which the core library does"
        " not have access to. Pending v1.0 catalogs for those renderers."
    ),
    "core/adapter_conformance.yaml": "UI framework adapter suite",
}

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


def resolve_protocol_version(case: dict[str, Any]) -> str | None:
    if "protocolVersion" in case and case["protocolVersion"]:
        return case["protocolVersion"]
    cat_spec = case.get("catalog") if isinstance(case.get("catalog"), dict) else {}
    if "protocolVersion" in cat_spec and cat_spec["protocolVersion"]:
        return cat_spec["protocolVersion"]
    c_schema = (
        case.get("catalogSchema") if isinstance(case.get("catalogSchema"), dict) else {}
    )
    if "protocolVersion" in c_schema and c_schema["protocolVersion"]:
        return c_schema["protocolVersion"]
    if "catalogs" in case and isinstance(case["catalogs"], list):
        for cat in case["catalogs"]:
            if isinstance(cat, dict) and cat.get("protocolVersion"):
                return cat["protocolVersion"]
    cat_id = str(
        case.get("catalogId")
        or cat_spec.get("catalogId")
        or c_schema.get("catalogId")
        or ""
    )
    if "v08" in cat_id or "v0_8" in cat_id:
        return "v0.8"
    if "v09" in cat_id or "v0_9" in cat_id:
        return "v0.9"
    if "v10" in cat_id or "v1_0" in cat_id or "v1.0" in cat_id:
        return "1.0"
    return "v0.9"


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
        rel_path = os.path.relpath(file_path, CONFORMANCE_ROOT)
        base_name = os.path.basename(file_path)
        if rel_path in SKIP_TEST_SUITES or base_name in SKIP_TEST_SUITES:
            continue
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
            if name in SKIP_TEST_NAMES:
                continue

            test_id = f"{rel_path}::{name}"
            cases.append((test_id, rel_path, case))
    return cases


def get_catalogs_for_test_case(case: dict[str, Any]) -> list[Any]:
    catalogs_map: dict[str, Any] = {}

    for cat in ALL_CATALOGS:
        if hasattr(cat, "catalog_id"):
            catalogs_map[cat.catalog_id] = cat
    standard_catalog = Catalog(
        catalog_id="standard",
        protocol_version="v0.9",
        components=list(basic_catalog.components.values()),
    )
    catalogs_map["basic"] = basic_catalog
    catalogs_map["standard"] = standard_catalog
    catalogs_map["v0.8:basic"] = v08_catalog
    catalogs_map["v0.9:basic"] = v09_catalog
    catalogs_map["v1.0:basic"] = v10_catalog

    version = resolve_protocol_version(case) or "v0.9"
    cur_basic = (
        v10_catalog
        if version in ("1.0", "v1.0")
        else (v08_catalog if version == "v0.8" else v09_catalog)
    )
    v10_basic_alias = Catalog(
        catalog_id="basic",
        protocol_version="1.0",
        components=list(v10_catalog.components.values()),
        functions=list(v10_catalog.functions.values()),
    )

    if version in ("1.0", "v1.0"):
        catalogs_map["basic"] = v10_basic_alias

    def add_catalog_id(cat_id: str, ver: str | None = None):
        if cat_id and (
            cat_id not in catalogs_map
            or not any(
                getattr(c, "catalog_id", None) == cat_id for c in catalogs_map.values()
            )
        ):
            catalogs_map[cat_id] = Catalog(
                catalog_id=cat_id,
                protocol_version=ver or version,
                components=list(cur_basic.components.values()),
            )

    specified_catalogs: list[Any] = []

    if "catalog" in case and isinstance(case["catalog"], dict):
        cat_spec = case["catalog"]
        if "catalogSchema" in cat_spec:
            c_schema = cat_spec["catalogSchema"]
            c_id = resolve_catalog_id(case) or f"catalog-{case.get('name')}"
            p_ver = resolve_protocol_version(case) or "v0.9"
            if c_id:
                cat = Catalog.from_json(
                    c_schema, catalog_id=c_id, protocol_version=p_ver
                )
                catalogs_map[c_id] = cat
                specified_catalogs.append(cat)
        elif "components" in cat_spec or "catalogId" in cat_spec:
            c_id = (
                cat_spec.get("catalogId")
                or resolve_catalog_id(case)
                or f"catalog-{case.get('name')}"
            )
            p_ver = resolve_protocol_version(case) or "v0.9"
            c_comps = cat_spec.get("components")
            c_theme = cat_spec.get("theme")
            c_funcs = cat_spec.get("functions")
            if c_comps or c_theme or c_funcs:
                c_schema = {"catalogId": c_id}
                if not c_funcs:
                    c_schema["$defs"] = {"anyFunction": {"not": {}}}
                if c_comps:
                    c_schema["components"] = c_comps
                if c_theme:
                    c_schema["theme"] = c_theme
                if c_funcs:
                    c_schema["functions"] = c_funcs
                cat = Catalog.from_json(
                    c_schema,
                    catalog_id=c_id,
                    protocol_version=p_ver,
                )
            else:
                default_comps = (
                    []
                    if case.get("action")
                    in ("get_client_capabilities", "get_renderer_capabilities")
                    else list(basic_catalog.components.values())
                )
                cat = Catalog(
                    catalog_id=c_id,
                    protocol_version=p_ver,
                    components=default_comps,
                )
            catalogs_map[c_id] = cat
            specified_catalogs.append(cat)

    if "catalogs" in case and isinstance(case["catalogs"], list):
        for item in case["catalogs"]:
            if isinstance(item, dict):
                if "catalogSchema" in item:
                    c_schema = item["catalogSchema"]
                    c_id = c_schema.get("catalogId") or item.get("catalogId")
                    p_ver = (
                        item.get("protocolVersion")
                        or c_schema.get("protocolVersion")
                        or "v0.9"
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
                    c_comps = item.get("components")
                    c_theme = item.get("theme")
                    c_funcs = item.get("functions")
                    if c_comps or c_theme or c_funcs:
                        c_schema = {"catalogId": c_id}
                        if c_comps:
                            c_schema["components"] = c_comps
                        if c_theme:
                            c_schema["theme"] = c_theme
                        if c_funcs:
                            c_schema["functions"] = c_funcs
                        cat = Catalog.from_json(
                            c_schema, catalog_id=c_id, protocol_version=p_ver
                        )
                    else:
                        default_comps = (
                            []
                            if case.get("action")
                            in ("get_client_capabilities", "get_renderer_capabilities")
                            else list(basic_catalog.components.values())
                        )
                        cat = Catalog(
                            catalog_id=c_id,
                            protocol_version=p_ver,
                            components=default_comps,
                        )
                    catalogs_map[c_id] = cat
                    specified_catalogs.append(cat)
    if "catalogPaths" in case and isinstance(case["catalogPaths"], list):
        for p in case["catalogPaths"]:
            full_p = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", p))
            if not os.path.exists(full_p):
                raise FileNotFoundError(
                    f"catalogPaths entry '{p}' does not exist (resolved to {full_p})"
                )
            if os.path.exists(full_p):
                with open(full_p, "r", encoding="utf-8") as f:
                    c_json = json.load(f)
                    c_id = c_json.get("catalogId") or c_json.get("id") or "test-catalog"
                    p_ver = resolve_protocol_version(case) or "v0.9"
                    if (
                        c_id
                        in (
                            v10_catalog.catalog_id,
                            v09_catalog.catalog_id,
                            v08_catalog.catalog_id,
                        )
                        or "basic/catalog.json" in p
                    ):
                        matching_basic = (
                            v10_catalog
                            if "1.0" in p_ver
                            else (v08_catalog if "0.8" in p_ver else v09_catalog)
                        )
                        specified_catalogs.append(matching_basic)
                        catalogs_map[c_id] = matching_basic
                    else:
                        cat = Catalog.from_json(
                            c_json, catalog_id=c_id, protocol_version=p_ver
                        )
                        specified_catalogs.append(cat)
                        if c_id != "test-catalog":
                            test_cat = Catalog.from_json(
                                c_json,
                                catalog_id="test-catalog",
                                protocol_version=p_ver,
                            )
                            catalogs_map["test-catalog"] = test_cat
                            specified_catalogs.append(test_cat)

    messages: list[Any] = case.get("messages") or (
        [case["payload"]] if "payload" in case else []
    )
    if "steps" in case:
        for step in case["steps"]:
            msgs = step.get("messages") or step.get("payload")
            if msgs:
                if isinstance(msgs, list):
                    messages.extend(msgs)
                elif isinstance(msgs, dict):
                    messages.append(msgs)

    expect_err = case.get("expectError")
    is_catalog_error_case = isinstance(expect_err, dict) and expect_err.get(
        "category"
    ) in ("CatalogError", "A2uiCatalogError")

    scan_version: str | None = None

    def scan(item: Any):
        nonlocal scan_version
        if not item:
            return
        if isinstance(item, list):
            for sub in item:
                scan(sub)
        elif isinstance(item, dict):
            if "version" in item and isinstance(item["version"], str):
                scan_version = item["version"]
            if "messages" in item:
                scan(item["messages"])
            if not is_catalog_error_case:
                if (
                    "createSurface" in item
                    and isinstance(item["createSurface"], dict)
                    and "catalogId" in item["createSurface"]
                ):
                    add_catalog_id(item["createSurface"]["catalogId"], scan_version)
                if (
                    "beginRendering" in item
                    and isinstance(item["beginRendering"], dict)
                    and "catalogId" in item["beginRendering"]
                ):
                    add_catalog_id(item["beginRendering"]["catalogId"], scan_version)

    scan(messages)
    if (
        case.get("action") in ("get_client_capabilities", "get_renderer_capabilities")
        and specified_catalogs
    ):
        return specified_catalogs
    return (
        specified_catalogs
        + [cur_basic]
        + [
            c
            for c in catalogs_map.values()
            if c not in specified_catalogs and c != cur_basic
        ]
    )


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


def _assert_renderer_error(
    exp_re: dict[str, Any],
    captured_renderer_errors: list[dict[str, Any]] | None,
    err_details: list[Any] | None = None,
) -> None:
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


@contextlib.contextmanager
def assert_raises(
    expect_error: Any,
    captured_renderer_errors: list[dict[str, Any]] | None = None,
):
    if isinstance(expect_error, dict):
        category = expect_error.get("category")
        message = expect_error.get("message", "")
        expected_class = CATEGORY_TO_EXCEPTION.get(category, (A2uiError, ValueError))
    else:
        expected_class = (A2uiError, ValueError)
        message = str(expect_error)

    with pytest.raises(expected_class) as excinfo:
        yield

    if isinstance(expect_error, dict) and expect_error.get("code"):
        expected_code = expect_error["code"]
        err_details = getattr(excinfo.value, "details", [])
        err_code = getattr(excinfo.value, "code", None)
        assert (
            err_code == expected_code
            or expected_code in str(excinfo.value)
            or (
                err_details
                and any(getattr(d, "code", None) == expected_code for d in err_details)
            )
        ), (
            f"Expected error code '{expected_code}' not found in exception"
            f" '{excinfo.value}'"
        )

    if message:
        msg_norm = message.lower()
        err_details = getattr(excinfo.value, "details", [])
        detail_msgs = (
            " ".join([d.message for d in err_details]).lower() if err_details else ""
        )
        err_str = f"{str(excinfo.value).lower()} {detail_msgs}"
        match = (
            _error_message_matches(message, err_str)
            or (err_details and any(message in d.message for d in err_details))
            or re.search(message, str(excinfo.value))
            or (
                "additional properties are not allowed" in msg_norm
                and ("extra inputs are not permitted" in err_str or "extra" in err_str)
            )
            or (
                "was unexpected" in msg_norm
                and ("unrecognized" in err_str or "unexpected" in err_str)
            )
            or (
                "cannot contain child" in msg_norm and "cannot contain child" in err_str
            )
            or (
                "cannot be placed under parent" in msg_norm
                and "cannot be placed under parent" in err_str
            )
            or (
                (
                    "protocol version mismatch" in msg_norm
                    or "mismatched protocol" in msg_norm
                )
                and (
                    "mismatched protocol" in err_str
                    or "protocol version mismatch" in err_str
                )
            )
        )
        assert (
            match
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


@pytest.mark.parametrize(
    "test_id, rel_path, case",
    CONFORMANCE_CASES,
    ids=[c[0] for c in CONFORMANCE_CASES],
)
def test_conformance_suite(test_id: str, rel_path: str, case: dict[str, Any]) -> None:
    ver = resolve_protocol_version(case)
    if ver and ver not in SUPPORTED_PROTOCOL_VERSIONS:
        pytest.fail(
            f"Test case '{test_id}' specifies unsupported protocol version '{ver}'."
        )

    if rel_path in UNRUNNABLE_SUITES:
        pytest.skip(UNRUNNABLE_SUITES[rel_path])

    action = case.get("action")
    if not action:
        pytest.fail(f"Test case '{test_id}' missing required 'action' field.")

    if action == "from_json":
        validate_from_json_case(case)
    elif action == "derive":
        validate_derive_case(case)
    elif action == "validation_schema":
        validate_validation_schema_case(case)
    elif action == "round_trip":
        validate_round_trip_case(case)
    elif action == "to_json":
        validate_to_json_case(case)
    elif action == "common_types_schema":
        validate_common_types_schema_case(case)
    elif action == "agent_to_renderer_schema":
        validate_agent_to_renderer_schema_case(case)
    elif action == "validate_common_type":
        validate_common_type_case(case)
    elif action == "validate":
        validate_pure_validation_case(case)
    elif action == "process_messages":
        validate_process_messages_case(case)
    elif action in (
        "get_client_capabilities",
        "get_renderer_capabilities",
    ):
        validate_capabilities_case(case)
    elif action in ("get_renderer_data_model", "get_client_data_model"):
        validate_get_renderer_data_model_case(case)
    elif action == "resolve_path":
        validate_resolve_path_case(case)
    elif action == "data_model":
        validate_data_model_case(case)
    elif action == "handle_rpc":
        validate_handle_rpc_case(case)
    elif action == "select_catalog":
        validate_select_catalog_case(case)
    elif action == "accessibility_check":
        validate_accessibility_check_case(case)
    elif action == "parse_expression_template":
        validate_parse_expression_template_case(case)
    elif action == "resolve_nodes":
        assert (
            rel_path == "core/node_resolution.yaml"
        ), "resolve_nodes is only supported in core/node_resolution.yaml"
        run_node_resolution_case(case, Path(CONFORMANCE_ROOT))
    elif action == "evaluate_function":
        validate_evaluate_function_case(case)
    elif action == "dispatch_action":
        validate_dispatch_action_case(case)
    elif action == "route_agent_function":
        validate_route_agent_function_case(case)
    else:
        pytest.fail(
            f"Action '{action}' has no handler in the core Python harness."
            " Add one, or add the suite to UNRUNNABLE_SUITES with a reason."
        )


def _timed_processing(
    case: dict[str, Any],
) -> Callable[[str], Callable[[], object]]:
    """Returns how a `process_messages` timing case prepares a timed run.

    The catalogs are built and the payload decoded before the timing starts.
    Each timed run creates a processor and hands it every message in one
    `process_messages` call.
    """
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

        for _, p_val in list(props.items()):
            tpl_info = _extract_template_binding(p_val)
            if tpl_info is not None:
                tpl_comp_id, raw_tpl_path = tpl_info
                tpl_path = ctx.data_context.resolve_path(raw_tpl_path)
                arr = surface.data_model.get(tpl_path)
                if isinstance(arr, list):
                    base_tpl_path = tpl_path.rstrip("/")
                    for i in range(len(arr)):
                        scoped_path = f"{base_tpl_path}/{i}"
                        _resolve_one(tpl_comp_id, scoped_path, f"{tpl_comp_id}_{i}")
                        _resolve_one(
                            tpl_comp_id,
                            scoped_path,
                            f"{tpl_comp_id}-[{scoped_path}]",
                        )

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


def _assert_expected_surface_state(
    processor: MessageProcessor, expected: dict[str, Any]
) -> None:
    if "surfaces" in expected:
        for s_id, s_exp in expected["surfaces"].items():
            surface = processor.model.get_surface(s_id)
            if s_exp.get("exists") is False:
                assert surface is None
                continue
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
                comps_expected = s_exp["components"]
                if isinstance(comps_expected, dict):
                    comp_items = list(comps_expected.items())
                elif isinstance(comps_expected, list):
                    comp_items = [
                        (c.get("id"), c) for c in comps_expected if isinstance(c, dict)
                    ]
                else:
                    comp_items = []
                resolved_nodes = _resolve_surface_components(surface)
                for c_id, c_exp in comp_items:
                    comp = surface.components_model.get(c_id)
                    node_info = resolved_nodes.get(c_id)
                    assert (
                        comp is not None or node_info is not None
                    ), f"Component '{c_id}' missing from surface '{s_id}'"
                    if isinstance(c_exp, dict):
                        c_type = (
                            comp.type
                            if comp
                            else (node_info["type"] if node_info else "")
                        )
                        if "component" in c_exp:
                            assert c_type == c_exp["component"]
                        if "metadata" in c_exp:
                            assert comp is not None
                            assert comp.metadata == c_exp["metadata"]
                        if node_info:
                            node_props = node_info["props"]
                            for p_key, p_val in c_exp.items():
                                if p_key in ("id", "component", "metadata"):
                                    continue
                                norm_val = _normalize_prop_value(node_props.get(p_key))
                                assert norm_val == p_val or (
                                    isinstance(norm_val, int)
                                    and not isinstance(norm_val, bool)
                                    and isinstance(p_val, str)
                                    and str(norm_val) == p_val
                                ), (
                                    f"Property '{p_key}' mismatch on component"
                                    f" '{c_id}': got {norm_val!r}, expected"
                                    f" {p_val!r}"
                                )

                if isinstance(comps_expected, list) and all(
                    surface.components_model.get(c_id) is not None
                    for c_id, _ in comp_items
                ):
                    assert len(surface.components_model.keys) == len(comp_items), (
                        f"Surface '{s_id}' component count mismatch: expected"
                        f" {len(comp_items)}, got"
                        f" {len(surface.components_model.keys)}"
                    )

            _assert_surface_validation_fields(s_id, s_exp, surface)


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


def validate_pure_validation_case(case: dict[str, Any]) -> None:
    catalogs = get_catalogs_for_test_case(case)
    val_config = (
        RELAXED_VALIDATION if case.get("strictMode") is False else STRICT_VALIDATION
    )
    processor = MessageProcessor(
        catalogs, options=MessageProcessorOptions(validation_config=val_config)
    )
    captured_renderer_errors: list[dict[str, Any]] = []
    processor.model.on_error.subscribe(lambda msg: captured_renderer_errors.append(msg))

    steps = case.get("steps") or [case]

    for idx, step in enumerate(steps):
        messages = step.get("messages") or step.get("payload")
        if not messages and "message" in step:
            messages = [step["message"]]
        if not messages:
            continue

        expect_error = step.get("expectError") or (
            case.get("expectError") if idx == len(steps) - 1 else None
        )

        if expect_error:
            captured_renderer_errors.clear()
            with assert_raises(expect_error, captured_renderer_errors):
                _run_pure_validation_step_with_error(processor, messages)
        else:
            processor.process_messages(messages)
            expected = step.get("expect")
            if not expected and idx == len(steps) - 1:
                expected = case.get("expect")
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
    unknown = set(flags) - set(_CASE_VALIDATION_FLAGS)
    assert not unknown, f"Unknown validationConfig flags: {sorted(unknown)}"
    return ValidationConfig(
        **{_CASE_VALIDATION_FLAGS[name]: value for name, value in flags.items()}
    )


def validate_process_messages_case(case: dict[str, Any]) -> None:
    catalogs = get_catalogs_for_test_case(case)
    if "validationConfig" in case:
        # The case sets its checks, so they don't depend on this harness.
        val_config: ValidationConfig | None = _case_validation_config(
            case["validationConfig"]
        )
    else:
        is_strict = bool(
            case.get("strictMode")
            or case.get("strict_mode")
            or case.get("options", {}).get("strict_mode")
        )
        val_config = STRICT_VALIDATION if is_strict else None
    processor = MessageProcessor(
        catalogs, options=MessageProcessorOptions(validation_config=val_config)
    )
    captured_renderer_errors: list[dict[str, Any]] = []
    processor.model.on_error.subscribe(lambda msg: captured_renderer_errors.append(msg))

    messages = case.get("messages") or (
        [case["payload"]] if "payload" in case else None
    )
    expect_error = case.get("expectError")

    if messages:
        if expect_error:
            captured_renderer_errors.clear()
            with assert_raises(expect_error, captured_renderer_errors):
                processor.process_messages(messages)
        else:
            processor.process_messages(messages)
            expected = case.get("expect", {})
            _assert_expected_surface_state(processor, expected)
        return

    steps = case.get("steps", [])
    for step in steps:
        messages = step.get("messages") or step.get("payload")
        if not messages and "message" in step:
            messages = [step["message"]]
        if not messages:
            continue

        expect_error = step.get("expectError") or (
            case.get("expectError") if step is steps[-1] else None
        )

        if expect_error:
            captured_renderer_errors.clear()
            with assert_raises(expect_error, captured_renderer_errors):
                processor.process_messages(messages)
        else:
            processor.process_messages(messages)
            expected = step.get("expect") or (
                case.get("expect") if step is steps[-1] else {}
            )
            _assert_expected_surface_state(processor, expected)


def validate_capabilities_case(case: dict[str, Any]) -> None:
    catalogs = get_catalogs_for_test_case(case)
    processor = MessageProcessor(catalogs)
    args = case.get("args") or {}
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


def validate_from_json_case(case: dict[str, Any]) -> None:
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
        expected = case.get("expect", {})
        unknown_keys = set(expected) - _FROM_JSON_EXPECT_KEYS
        assert (
            not unknown_keys
        ), f"Unknown from_json expect keys: {sorted(unknown_keys)}"
        if "catalogId" in expected:
            assert cat.catalog_id == expected["catalogId"]
        if "protocolVersion" in expected:
            assert cat.protocol_version == expected["protocolVersion"]
        if "components" in expected:
            if isinstance(expected["components"], list):
                for comp_name in expected["components"]:
                    assert cat.get_component(comp_name) is not None
            elif isinstance(expected["components"], dict):
                for comp_name in expected["components"]:
                    assert cat.get_component(comp_name) is not None
        if "functions" in expected:
            if isinstance(expected["functions"], list):
                for fn_name in expected["functions"]:
                    assert cat.get_function(fn_name) is not None
        if "componentMetadata" in expected and isinstance(
            expected["componentMetadata"], dict
        ):
            for comp_name, exp_meta in expected["componentMetadata"].items():
                comp_api = cat.get_component(comp_name)
                assert comp_api is not None
                assert comp_api.metadata == exp_meta
        if expected.get("selfContained"):
            _assert_self_contained(cat.validation_schema)
        if expected.get("matchesBuiltinCatalog"):
            _assert_matches_builtin_catalog(cat)
        if "validComponents" in expected or "invalidComponents" in expected:
            validator = PayloadValidator(cat)
            for component in expected.get("validComponents", []):
                validator.validate_component(component)
            for component in expected.get("invalidComponents", []):
                with pytest.raises(A2uiValidationError):
                    validator.validate_component(component)


# The `expect` keys a `derive` case may use (`DeriveExpect` in
# conformance_schema.json).
_DERIVE_EXPECT_KEYS = frozenset({
    "absentKeys",
    "catalogId",
    "components",
    "functions",
    "instructions",
    "protocolVersion",
    "theme",
})


def validate_derive_case(case: dict[str, Any]) -> None:
    """Runs a `derive` case.

    Loads the source catalog with `from_json`, derives a catalog from it, and
    checks the derived catalog and its `to_json()` document.
    """
    document, _ = _load_case_catalog(case)
    source = Catalog.from_json(document)
    args = case["args"]

    def entries(kind: str) -> list[Any] | None:
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

    def derive() -> CatalogApi:
        return source.derive(
            catalog_id=args["catalogId"],
            components=entries("components"),
            functions=entries("functions"),
            instructions=args.get("instructions"),
        )

    if "expectError" in case:
        with assert_raises(case["expectError"]):
            derive()
        return

    expected = case["expect"]
    unknown_keys = set(expected) - _DERIVE_EXPECT_KEYS
    assert not unknown_keys, f"Unknown derive expect keys: {sorted(unknown_keys)}"
    derived = derive()
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


def validate_validation_schema_case(case: dict[str, Any]) -> None:
    """Runs a `validation_schema` case against its golden artifact.

    `catalog.validation_schema` must equal the JSON file that `expectFile`
    names, ignoring object key order, which Python dicts ignore already, and
    the order of `enum` values and `required` names.
    """
    assert "expect" not in case, "validation_schema cases take no expect"
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


def validate_round_trip_case(case: dict[str, Any]) -> None:
    """Runs a `round_trip` case: `from_json(c).to_json()` equals `c`.

    The document is always loaded with `from_json`, even when the SDK
    implements the catalog itself. A case-level `catalogId` overrides a
    document that declares none, and must not appear in the output. The
    comparison ignores key order, which Python dicts ignore already, and the
    order of `enum` and `required`.
    """
    unexpected = {"expect", "expectFile"} & set(case)
    assert not unexpected, f"round_trip cases take no {sorted(unexpected)}"
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


def validate_to_json_case(case: dict[str, Any]) -> None:
    """Runs a `to_json` case: `catalog.to_json()` equals `expectFile`.

    A `builtinCatalog` case serializes the SDK's own implementation for the
    case's protocol version, and is skipped if the SDK has none. Other cases
    load `catalogPath` or `catalog` with `from_json`. The comparison ignores
    key order and the order of `enum` and `required`.
    """
    assert "expect" not in case, "to_json cases take expectFile, not expect"
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


def validate_common_types_schema_case(case: dict[str, Any]) -> None:
    from a2ui.core.catalog import get_common_types_schema_json
    from a2ui.core.common import to_protocol_version

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


def validate_common_type_case(case: dict[str, Any]) -> None:
    from pydantic import TypeAdapter, ValidationError

    from a2ui.core.schema import v0_9 as schema_v0_9, v1_0 as schema_v1_0

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

    for step in case["steps"]:
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


def validate_resolve_path_case(case: dict[str, Any]) -> None:
    from a2ui.core.resolution.data_context import DataContext
    from a2ui.core.state.surface_model import SurfaceModel

    args = case.get("args", {})
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


def validate_data_model_case(case: dict[str, Any]) -> None:
    from a2ui.core.state.data_model import DataModel

    initial = case.get("initial")
    model = DataModel(initial_data=initial)

    class _Observer:

        def __init__(self, path: str):
            self.path = path
            self.change_count = 0
            self.current_value = model.get(path)

        def on_change(self, val: Any) -> None:
            self.change_count += 1
            self.current_value = val

    observers: list[_Observer] = []
    watch_paths = case.get("watch") or []
    for p in watch_paths:
        obs = _Observer(p)
        model.subscribe(p, obs.on_change)
        observers.append(obs)

    steps = case.get("steps") or []
    for idx, step in enumerate(steps):
        for obs in observers:
            obs.change_count = 0

        expect_err = step.get("expect_error") or step.get("expectError")
        if expect_err:
            with assert_raises(expect_err):
                _apply_data_model_op(model, step)
            continue

        _apply_data_model_op(model, step)

        if "expect_notified" in step:
            expected_notified = step["expect_notified"]
            actual_notified: list[str] = []
            for obs in observers:
                for _ in range(obs.change_count):
                    actual_notified.append(obs.path)
            assert sorted(actual_notified) == sorted(expected_notified), (
                f"Step {idx} ({step.get('op')}) expect_notified mismatch: "
                f"got {actual_notified}, expected {expected_notified}"
            )

        if "expect_values" in step:
            expected_values = step["expect_values"]
            for v_path, exp_val in expected_values.items():
                obs = next((o for o in observers if o.path == v_path), None)
                assert (
                    obs is not None
                ), f"Path '{v_path}' in expect_values is not watched"
                assert obs.current_value == exp_val, (
                    f"Step {idx} ({step.get('op')}) expect_values mismatch for"
                    f" '{v_path}': got {obs.current_value}, expected {exp_val}"
                )

    if "expect" in case:
        expected = case["expect"]
        assert model.get("/") == expected


def _apply_data_model_op(model: Any, step: dict[str, Any]) -> None:
    op = step.get("op")
    step_path = step.get("path", "")
    if op == "get":
        actual = model.get(step_path)
        if step.get("expect_absent") is True:
            assert (
                actual is None
            ), f"Expected path '{step_path}' to be absent, got {actual}"
        if "expect_type" in step:
            exp_type = step["expect_type"]
            if exp_type == "list":
                assert isinstance(
                    actual, list
                ), f"Expected path '{step_path}' to be list, got {type(actual)}"
            elif exp_type == "object":
                assert isinstance(
                    actual, dict
                ), f"Expected path '{step_path}' to be dict, got {type(actual)}"
        if "expect" in step:
            assert actual == step["expect"], (
                f"Get at path '{step_path}' mismatch: got {actual}, expected"
                f" {step['expect']}"
            )
    elif op == "set":
        model.set(step_path, step.get("value"))
    elif op == "delete":
        model.set(step_path, None)
    elif op == "dispose":
        model.dispose()
    else:
        raise ValueError(f"Unknown data_model op: {op}")


def validate_get_renderer_data_model_case(case: dict[str, Any]) -> None:
    catalogs = get_catalogs_for_test_case(case)
    processor = MessageProcessor(catalogs)
    steps = case.get("steps")
    if steps:
        for step in steps:
            msgs = step.get("messages") or step.get("payload")
            if msgs:
                processor.process_messages(msgs)
    else:
        msgs = case.get("messages") or ([case["payload"]] if "payload" in case else [])
        if msgs:
            processor.process_messages(msgs)
    args = case.get("args") or {}
    ver = args.get("version") or resolve_protocol_version(case)
    res = processor.get_renderer_data_model(ver)
    expected = case.get("expect")
    if expected is None and "expect" in case:
        assert res is None
    elif isinstance(expected, dict):
        if "data" in expected:
            assert res == expected["data"]
        else:
            assert res == expected


def validate_handle_rpc_case(case: dict[str, Any]) -> None:
    args = case.get("args", {})
    message = args.get("message")
    outbound_call = args.get("outboundCall")
    inbound_response = args.get("inboundResponse")
    fn_metadata = args.get("functionMetadata", {})
    user_activation = bool(args.get("userActivationPresent", False))

    from a2ui.core.catalog import Catalog, FunctionImplementation

    funcs: list[FunctionImplementation] = []
    for fn_name, meta in fn_metadata.items():
        allowed = meta.get("allowedCallers", "rendererOrAgent")
        requires_activation = meta.get("requiresUserActivation", False)

        def make_exec(name: str):
            def execute(fn_args: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
                if name == "playMedia":
                    return {"playing": True, "timestamp": 0}
                elif name == "openExternalUrl":
                    return {"opened": True}
                elif name == "syncState":
                    return None
                elif name == "failingFunction":
                    raise Exception("An error occurred during function execution.")
                elif name == "calculateTax":
                    amount = (fn_args or {}).get("amount", 0)
                    return amount * 0.1
                elif name == "echoArgs":
                    return dict(fn_args or {})
                return None

            return execute

        fn_schema = meta.get("schema") or meta.get("parameters") or {"type": "object"}
        funcs.append(
            FunctionImplementation(
                name=fn_name,
                return_type=meta.get("returnType", "any"),
                schema=fn_schema,
                execute=make_exec(fn_name),
                allowed_callers=allowed,
                requires_user_activation=requires_activation,
            )
        )

    cat_id, cat_version = _resolve_rpc_catalog_info(args, message, outbound_call, case)
    catalogs = _build_rpc_catalogs(cat_id, cat_version, funcs)
    captured_renderer_errors: list[dict[str, Any]] = []
    processor = MessageProcessor(
        catalogs=catalogs,
        options=MessageProcessorOptions(
            outbound_listener=lambda msg: None,
            error_handler=lambda msg: captured_renderer_errors.append(msg),
        ),
    )
    _setup_rpc_surface_if_needed(args, catalogs[0], catalogs, cat_version, processor)

    if message:
        _verify_rpc_inbound_message(
            message, case, processor, user_activation, captured_renderer_errors
        )

    if (
        outbound_call
        and inbound_response
        and not (case.get("expectError") or (case.get("expect") or {}).get("error"))
    ):
        correlated_id = case.get("expect", {}).get("correlatedCallId")
        if correlated_id is not None:
            assert (
                inbound_response["agentFunctionResponse"]["functionCallId"]
                == correlated_id
            )

        from a2ui.core.rpc import CallOptions
        from a2ui.core.schema.v1_0.common_types import FunctionCall

        call_fn = outbound_call["callFunction"]
        call_name = call_fn.get("@call") or call_fn.get("call")
        fut = processor.call_agent_function(
            surface_id=outbound_call["surfaceId"],
            call=FunctionCall(
                call=call_name,
                catalogId=call_fn.get("catalogId")
                or "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
                args=call_fn.get("args"),
            ),
            options=CallOptions(
                function_call_id=outbound_call["functionCallId"],
                version="1.0",
            ),
        )
        processor.process_messages(inbound_response)
        assert fut.done()
        assert fut.result() == case.get("expect", {}).get("result")
    elif outbound_call and (
        case.get("expectError") or (case.get("expect") or {}).get("error")
    ):
        import asyncio

        from a2ui.core.exceptions import A2uiRpcError
        from a2ui.core.rpc import CallOptions
        from a2ui.core.schema.v1_0.common_types import FunctionCall

        expected_err = case.get("expectError") or case.get("expect", {}).get("error")

        def _start_call(spec: dict[str, Any]) -> Any:
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

        if "secondOutboundCall" in args:

            async def _expect_duplicate() -> None:
                # The first call stays pending, so reusing its id must be refused.
                pending = _start_call(outbound_call)
                with pytest.raises(A2uiRpcError) as exc_info:
                    _start_call(args["secondOutboundCall"])
                assert exc_info.value.code == expected_err.get("code", "DUPLICATE")
                pending.cancel()

            asyncio.run(_expect_duplicate())
        elif inbound_response:

            async def _expect_inbound_error() -> None:
                pending = _start_call(outbound_call)
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
                pending = _start_call(outbound_call)
                processor.rpc.dispose()
                with pytest.raises((A2uiRpcError, asyncio.CancelledError)) as exc_info:
                    await pending
                if isinstance(exc_info.value, A2uiRpcError) and "code" in expected_err:
                    assert exc_info.value.code == expected_err["code"]

            asyncio.run(_expect_cancelled())
        elif "timeoutMs" in outbound_call:

            async def _expect_timeout() -> None:
                # No response arrives, so the handler's timer must reject the future.
                with pytest.raises(A2uiRpcError) as exc_info:
                    await _start_call(outbound_call)
                assert exc_info.value.code == expected_err.get("code", "TIMEOUT")

            asyncio.run(_expect_timeout())


def validate_accessibility_check_case(case: dict[str, Any]) -> None:
    pytest.skip(UNRUNNABLE_SUITES["core/accessibility.yaml"])


def validate_select_catalog_case(case: dict[str, Any]) -> None:
    from a2ui.core.resolution import DataContext
    from a2ui.core.state import ComponentModel, SurfaceModel

    args = case.get("args", {})
    surface_args = args.get("surface", {})
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

    expect_err = case.get("expectError")

    if expect_err:
        with assert_raises(expect_err):
            for cat_id, cat in catalogs_dict.items():
                def_ver = getattr(default_cat, "protocol_version", None)
                cat_ver = getattr(cat, "protocol_version", None)
                if def_ver and cat_ver and def_ver != cat_ver:
                    raise A2uiCatalogError(
                        f"Protocol version mismatch: cannot mix catalog '{cat_id}'"
                        f" ({cat_ver}) with surface version {def_ver}."
                    )

            if "components" in args:
                for c_id, c_data in args["components"].items():
                    comp_cat_id = c_data.get("catalogId")
                    if comp_cat_id:
                        if comp_cat_id not in catalogs_dict:
                            raise A2uiCatalogError(
                                f"Catalog '{comp_cat_id}' is not supported by surface"
                                f" '{s_id}'."
                            )
                        comp_cat = catalogs_dict[comp_cat_id]
                        def_ver = getattr(default_cat, "protocol_version", None)
                        cat_ver = getattr(comp_cat, "protocol_version", None)
                        if def_ver and cat_ver and def_ver != cat_ver:
                            raise A2uiCatalogError(
                                f"Component '{c_id}' catalog protocol version {cat_ver}"
                                " mismatches default catalog protocol version"
                                f" {def_ver}."
                            )
                    else:
                        comp_cat = default_cat

                    comp_model = ComponentModel(
                        c_id, c_data.get("component", "Box"), catalog=comp_cat
                    )
                    surface.components_model.add_component(comp_model)
            elif "functionCall" in args:
                fn_call = args["functionCall"]
                fn_cat_id = fn_call.get("catalogId")
                ctx = DataContext(surface=surface, path="/")
                ctx._execute_function(
                    fn_call["call"], fn_call.get("args", {}), catalog_id=fn_cat_id
                )
    else:
        if "components" in args:
            last_selected = None
            for c_id, c_data in args["components"].items():
                comp_cat_id = c_data.get("catalogId")
                if comp_cat_id:
                    if comp_cat_id not in catalogs_dict:
                        raise A2uiCatalogError(
                            f"Catalog '{comp_cat_id}' is not supported by surface"
                            f" '{s_id}'."
                        )
                    comp_cat = catalogs_dict[comp_cat_id]
                else:
                    comp_cat = default_cat
                last_selected = comp_cat.catalog_id

                comp_model = ComponentModel(
                    c_id, c_data.get("component", "Box"), catalog=comp_cat
                )
                surface.components_model.add_component(comp_model)

            if "expectSelected" in case:
                assert last_selected == case["expectSelected"]

        elif "functionCall" in args:
            fn_call = args["functionCall"]
            fn_cat_id = fn_call.get("catalogId")
            ctx = DataContext(surface=surface, path="/")
            if fn_cat_id:
                if fn_cat_id not in catalogs_dict:
                    raise A2uiCatalogError(f"Catalog not found: {fn_cat_id}")
                selected = catalogs_dict[fn_cat_id].catalog_id
            else:
                selected = surface.default_catalog.catalog_id

            if "expectSelected" in case:
                assert selected == case["expectSelected"]


def validate_parse_expression_template_case(case: dict[str, Any]) -> None:
    from a2ui.core.expressions.expression_parser import ExpressionParser

    input_str = case.get("input", "")
    expect_error = case.get("expect_error") or case.get("expectError")
    parser = ExpressionParser()

    if expect_error:
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


def validate_dispatch_action_case(case: dict[str, Any]) -> None:
    import copy
    from a2ui.core.catalog import FunctionImplementation

    action_payload = case["actionPayload"]
    data_model_dict = case.get("dataModel") or {}
    surface_id = case.get("surfaceId", "main")
    source_comp_id = case.get("sourceComponentId", "test_comp")
    scope = case.get("scope")
    user_activation = bool(case.get("userActivation", True))
    expect_dispatched = case.get("expectDispatched")
    expect_data_model = case.get("expectDataModel")
    expect_error = case.get("expectError")

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
    data_model = DataModel(data_model_dict)
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

    context = DataContext(surface=surface, path=scope or "/")

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
        _assert_dispatched_action_event(case, expect_dispatched, dispatched)
        if expect_data_model is not None:
            assert data_model.get("/") == expect_data_model


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


def _evaluate_function_on_surface(case: dict[str, Any]) -> Any:
    """Evaluates the case's function as a call on a surface (the `surface` block).

    The surface is built for the case's protocolVersion. Its available catalogs
    are the catalogPaths entries built for that version, and its default
    catalog is the one `surface.catalogId` names, if any. The call goes through
    the SDK's catalog resolution, naming the case's call-level `catalogId`.
    """
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


def validate_evaluate_function_case(case: dict[str, Any]) -> None:
    func_name = case["function"]
    args = case["args"]
    data_model_dict = case.get("dataModel") or {}
    locale = case.get("locale", "en-US")
    expect_error = case.get("expectError") or case.get("expect_error")

    if "surface" in case:

        def _invoke() -> Any:
            return _evaluate_function_on_surface(case)

    else:
        catalogs = get_catalogs_for_test_case(case)
        default_cat = catalogs[0] if catalogs else v09_catalog
        data_model = DataModel(data_model_dict)
        surface = SurfaceModel(
            surface_id="main",
            default_catalog=default_cat,
            data_model=data_model,
        )
        surface.locale = locale
        context = DataContext(surface=surface, path="/")

        def _invoke() -> Any:
            if (
                default_cat
                and hasattr(default_cat, "functions")
                and func_name in default_cat.functions
            ):
                fn = default_cat.functions[func_name]
                if getattr(fn, "execute_func", None) is not None:
                    return fn.execute_func(args, context)
                return fn.execute(args, context)
            return context.resolve_dynamic_value({"call": func_name, "args": args})

    if expect_error:
        with assert_raises(expect_error):
            _invoke()
    else:
        result = _invoke()
        expected = case.get("expect")
        assert result == expected


def _routing_catalogs(case: dict[str, Any], version: str) -> list[Catalog]:
    """Builds the catalogs of a `route_agent_function` case.

    `localFunctions` take the SDK's basic catalog implementations for the
    case's protocol version. `agentFunctions` are declared with their argument
    schema and no implementation, so they are schema-only.
    """
    basic = v10_catalog if _normalize_version(version) == "1.0" else v09_catalog
    catalogs = []
    for spec in case.get("catalogs") or []:
        functions: list[Any] = [
            basic.functions[name] for name in spec.get("localFunctions") or []
        ]
        for name, declaration in (spec.get("agentFunctions") or {}).items():
            functions.append(
                FunctionApi(
                    name=name,
                    schema=declaration["args"],
                    requires_user_activation=declaration.get(
                        "requiresUserActivation", False
                    ),
                )
            )
        catalogs.append(Catalog(spec["catalogId"], version, [], functions))
    return catalogs


async def _flush_async_work() -> None:
    """Lets the callbacks of settled futures, and those they schedule, run."""
    for _ in range(5):
        await asyncio.sleep(0)


async def _run_route_agent_function_case(case: dict[str, Any]) -> None:
    version = _normalize_version(case["protocolVersion"])
    wire_version = "1.0" if version == "1.0" else f"v{version}"
    surface_spec = case.get("surface") or {}
    outbound: list[dict[str, Any]] = []
    processor = MessageProcessor(
        _routing_catalogs(case, version),
        options=MessageProcessorOptions(
            outbound_listener=(
                None
                if surface_spec.get("outboundListener") is False
                else outbound.append
            ),
        ),
    )
    create_surface: dict[str, Any] = {"surfaceId": "main"}
    if "catalogId" in surface_spec:
        create_surface["catalogId"] = surface_spec["catalogId"]
    processor.process_messages(
        [{"version": wire_version, "createSurface": create_surface}]
    )
    surface = processor.model.get_surface("main")
    assert surface is not None
    if case.get("dataModel") is not None:
        surface.data_model.set("/", case["dataModel"])

    errors: list[dict[str, Any]] = []
    surface.on_error.subscribe(errors.append)
    context = DataContext(surface, "/")
    # Current values of the binding and check evaluations, in order.
    values: list[Any] = []
    evaluations: list[Callable[[], Any]] = []
    disposables: list[Callable[[], None]] = []
    outbound_seen = 0
    errors_seen = 0
    try:
        for index, step in enumerate(case.get("steps") or []):
            label = f"step {index}"
            if "evaluate" in step:
                kind = step.get("as", "binding")
                if kind == "action":
                    context.resolve_action({"functionCall": step["evaluate"]})
                elif kind == "check":
                    probe_id = f"probe_{len(evaluations)}"
                    comp = ComponentModel(
                        probe_id,
                        "Probe",
                        surface.default_catalog,
                        {
                            "checks": [{
                                "condition": step["evaluate"],
                                "message": "Check failed",
                            }]
                        },
                    )
                    surface.components_model.add_component(comp)
                    binder = GenericBinder(ComponentContext(comp, context))
                    disposables.append(binder.dispose)
                    evaluations.append(lambda b=binder: b.current_props.get("isValid"))
                else:
                    slot = len(values)
                    values.append(None)

                    def _on_change(value: Any, slot: int = slot) -> None:
                        values[slot] = value

                    sub = context.subscribe_dynamic_value(step["evaluate"], _on_change)
                    values[slot] = sub.value
                    disposables.append(sub.unsubscribe)
                    evaluations.append(lambda s=slot: values[s])
            elif "respond" in step:
                response = dict(step["respond"])
                call_index = response.pop("call")
                calls = [m for m in outbound if "callAgentFunction" in m]
                call_id = calls[call_index]["callAgentFunction"]["functionCallId"]
                processor.process_messages([{
                    "version": "1.0",
                    "agentFunctionResponse": {"functionCallId": call_id, **response},
                }])
            else:
                pytest.fail(f"{label}: a step needs 'evaluate' or 'respond'.")
            await _flush_async_work()

            sent = outbound[outbound_seen:]
            outbound_seen = len(outbound)
            for message in sent:
                assert "callAgentFunction" in message, f"{label}: unexpected {message}"
                assert message["callAgentFunction"]["surfaceId"] == "main", label
            assert [m["callAgentFunction"]["callFunction"] for m in sent] == step.get(
                "expectOutbound", []
            ), f"{label}: outbound callFunction payloads"

            reported = errors[errors_seen:]
            errors_seen = len(errors)
            expected_errors = step.get("expectErrors", [])
            assert len(reported) == len(
                expected_errors
            ), f"{label}: reported {reported}"
            for actual, expected in zip(reported, expected_errors):
                assert actual["code"] == expected["code"], f"{label}: {actual}"
                if "message" in expected:
                    assert (
                        expected["message"] in actual["message"]
                    ), f"{label}: {actual}"

            if "expectValues" in step:
                assert [read() for read in evaluations] == step[
                    "expectValues"
                ], f"{label}: values"
    finally:
        for dispose in disposables:
            dispose()


def validate_route_agent_function_case(case: dict[str, Any]) -> None:
    """Runs a `route_agent_function` case.

    Function calls are evaluated on surface `main`, created through a
    `MessageProcessor`, and the `callAgentFunction` messages it sends are
    answered with `agentFunctionResponse`. A `binding` subscribes to the call
    as a dynamic value, as a component binding does; a `check` subscribes to it
    as the condition of a check rule, as the generic binder does; an `action`
    resolves it as the `functionCall` of an action, within a user activation.
    """
    asyncio.run(_run_route_agent_function_case(case))
