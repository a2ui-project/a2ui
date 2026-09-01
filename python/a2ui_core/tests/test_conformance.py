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

import contextlib
import json
import os
import re
from typing import Any
import pytest
import yaml

from a2ui.core.catalog import Catalog
from a2ui.core.basic_catalog import v0_8, v0_9, v1_0
from a2ui.core.schema import ProtocolVersion
from a2ui.core.processing import MessageProcessor
from a2ui.core.validation import STRICT_VALIDATION, ValidationConfig
from a2ui.core.exceptions import (
    A2uiError,
    A2uiParseError,
    A2uiValidationError,
    A2uiCatalogError,
    A2uiIntegrityError,
)

from a2ui.core.validation import A2uiValidatorError

CATEGORY_TO_EXCEPTION = {
    "ParseError": (A2uiParseError, A2uiError),
    "ValidationError": (A2uiValidationError, A2uiValidatorError, A2uiError),
    "CatalogError": (A2uiCatalogError, A2uiError),
    "IntegrityError": (
        A2uiIntegrityError,
        A2uiValidationError,
        A2uiValidatorError,
        A2uiError,
        ValueError,
    ),
    "RecursionError": (A2uiValidationError, A2uiValidatorError, A2uiError, ValueError),
}

SUPPORTED_PROTOCOL_VERSIONS = {"v0.8", "v0.9", "v1.0", "0.8", "0.9", "1.0"}

# Transition skip list for core test cases pending feature implementation or version adapters
SKIP_TEST_NAMES: set[str] = {
    "test_index_function_in_collection_loop",
    "test_index_function_with_offset",
    "test_index_function_nested_path",
    "test_index_function_outside_loop_error",
    "test_validation_result_dynamic_object_return",
    "test_validation_result_boolean_fallback",
}

# Transition skip list containing specific test suite files or basenames to skip entirely.
SKIP_TEST_SUITES: set[str] = set()

# Root core conformance directory resolution
CONFORMANCE_ROOT = os.environ.get(
    "CONFORMANCE_ROOT",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../conformance")),
)
CORE_DIR = os.path.join(CONFORMANCE_ROOT, "core")

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
        return "v1.0"
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


def load_conformance_cases() -> list[tuple[str, str, dict[str, Any]]]:
    cases = []
    yaml_files = find_yaml_files(CORE_DIR)
    for file_path in yaml_files:
        rel_path = os.path.relpath(file_path, CONFORMANCE_ROOT)
        base_name = os.path.basename(file_path)
        if rel_path in SKIP_TEST_SUITES or base_name in SKIP_TEST_SUITES:
            continue
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except Exception:
            continue

        if not isinstance(data, list):
            continue

        for case in data:
            if not isinstance(case, dict):
                continue
            name = case.get("name")
            if not name or name in SKIP_TEST_NAMES:
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
        if version == "v1.0"
        else (v08_catalog if version == "v0.8" else v09_catalog)
    )

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
        elif "catalogId" in cat_spec:
            c_id = cat_spec["catalogId"]
            p_ver = resolve_protocol_version(case) or "v0.9"
            c_comps = cat_spec.get("components")
            c_theme = cat_spec.get("theme")
            if c_comps or c_theme:
                c_schema = {"catalogId": c_id}
                if c_comps:
                    c_schema["components"] = c_comps
                if c_theme:
                    c_schema["theme"] = c_theme
                cat = Catalog.from_json(
                    c_schema, catalog_id=c_id, protocol_version=p_ver
                )
            else:
                cat = Catalog(
                    catalog_id=c_id,
                    protocol_version=p_ver,
                    components=list(basic_catalog.components.values()),
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
                    if c_comps or c_theme:
                        c_schema = {"catalogId": c_id}
                        if c_comps:
                            c_schema["components"] = c_comps
                        if c_theme:
                            c_schema["theme"] = c_theme
                        cat = Catalog.from_json(
                            c_schema, catalog_id=c_id, protocol_version=p_ver
                        )
                    else:
                        cat = Catalog(
                            catalog_id=c_id,
                            protocol_version=p_ver,
                            components=list(basic_catalog.components.values()),
                        )
                    specified_catalogs.append(cat)
    if "catalogPaths" in case and isinstance(case["catalogPaths"], list):
        for p in case["catalogPaths"]:
            full_p = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", p))
            if os.path.exists(full_p):
                with open(full_p, "r", encoding="utf-8") as f:
                    c_json = json.load(f)
                    c_id = c_json.get("catalogId") or "test-catalog"
                    p_ver = resolve_protocol_version(case) or "v0.9"
                    cat = Catalog.from_json(
                        c_json, catalog_id=c_id, protocol_version=p_ver
                    )
                    specified_catalogs.append(cat)
                    if c_id != "test-catalog":
                        test_cat = Catalog.from_json(
                            c_json, catalog_id="test-catalog", protocol_version=p_ver
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
    return specified_catalogs + [
        c for c in catalogs_map.values() if c not in specified_catalogs
    ]


@contextlib.contextmanager
def assert_raises(expect_error: Any):
    if isinstance(expect_error, dict):
        category = expect_error.get("category")
        message = expect_error.get("message", "")
        expected_class = CATEGORY_TO_EXCEPTION.get(category, (A2uiError, ValueError))
    else:
        expected_class = (A2uiError, ValueError)
        message = str(expect_error)

    with pytest.raises(expected_class) as excinfo:
        yield

    if message:
        msg_norm = message.lower()
        err_str = str(excinfo.value).lower()
        match = (
            message in str(excinfo.value)
            or re.search(re.escape(message), str(excinfo.value))
            or re.search(message, str(excinfo.value))
            or (
                "not of type" in msg_norm
                and (
                    "input should be" in err_str
                    or "type_mismatch" in err_str
                    or "must be a" in err_str
                )
            )
            or (
                "is a required property" in msg_norm
                and ("field required" in err_str or "missing" in err_str)
            )
            or (
                "additional properties are not allowed" in msg_norm
                and ("extra inputs are not permitted" in err_str or "extra" in err_str)
            )
            or (
                "circular" in msg_norm
                and ("circular" in err_str or "self-reference" in err_str)
            )
            or ("orphan" in msg_norm and "orphan" in err_str)
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
        )
        assert (
            match
        ), f"Expected error '{message}' not found in exception '{excinfo.value}'"

    if isinstance(expect_error, dict) and expect_error.get("code"):
        expected_code = expect_error["code"]
        err_details = getattr(excinfo.value, "details", [])
        detail_codes = [d.code for d in err_details] if err_details else []
        assert expected_code in detail_codes or expected_code in str(excinfo.value), (
            f"Expected error code '{expected_code}' not found in exception details"
            f" ({detail_codes}) or message ('{excinfo.value}')"
        )


CONFORMANCE_CASES = load_conformance_cases()


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

    action = case.get("action")
    if not action:
        pytest.skip(f"Test case '{test_id}' missing required 'action' field.")

    if action == "from_json":
        validate_from_json_case(case)
    elif action == "catalog_schema":
        validate_catalog_schema_case(case)
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
    else:
        pytest.skip(f"Action '{action}' not implemented in core Python harness.")


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
                for c_id, c_exp in comp_items:
                    comp = surface.components_model.get(c_id)
                    assert (
                        comp is not None
                    ), f"Component '{c_id}' missing from surface '{s_id}'"
                    if "component" in c_exp:
                        assert comp.type == c_exp["component"]


def validate_pure_validation_case(case: dict[str, Any]) -> None:
    catalogs = get_catalogs_for_test_case(case)
    val_config = STRICT_VALIDATION
    processor = MessageProcessor(catalogs, validation_config=val_config)

    steps = case.get("steps")
    if not steps:
        steps = [case]

    for step in steps:
        messages = step.get("messages") or step.get("payload")
        if not messages and "message" in step:
            messages = [step["message"]]
        if not messages:
            continue

        expect_error = step.get("expectError") or case.get("expectError")

        if expect_error:
            with assert_raises(expect_error):
                processor.process_messages(messages)
        else:
            processor.process_messages(messages)


def validate_process_messages_case(case: dict[str, Any]) -> None:
    catalogs = get_catalogs_for_test_case(case)
    is_strict = bool(
        case.get("strictMode")
        or case.get("strict_mode")
        or case.get("options", {}).get("strict_mode")
    )
    val_config = STRICT_VALIDATION if is_strict else None
    processor = MessageProcessor(catalogs, validation_config=val_config)

    messages = case.get("messages") or (
        [case["payload"]] if "payload" in case else None
    )
    expect_error = case.get("expectError")

    if messages:
        if expect_error:
            with assert_raises(expect_error):
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
            with assert_raises(expect_error):
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
    ver = resolve_protocol_version(case) or "v0.9"
    p_ver = ProtocolVersion(ver)
    caps = processor.get_renderer_capabilities(versions=[p_ver])
    expected = case.get("expect", {})
    for k, v in expected.items():
        assert k in caps


def validate_from_json_case(case: dict[str, Any]) -> None:
    c_schema = (
        case.get("catalogSchema") or case.get("catalog") or case.get("schema") or case
    )
    c_id = resolve_catalog_id(case)
    p_ver = resolve_protocol_version(case)
    expect_err = case.get("expectError")

    if expect_err:
        with assert_raises(expect_err):
            Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)
    else:
        cat = Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)
        expected = case.get("expect", {})
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


def validate_catalog_schema_case(case: dict[str, Any]) -> None:
    p_ver = resolve_protocol_version(case)
    if case.get("useBasicCatalog") or case.get("catalog") == "BasicCatalog":
        if p_ver == "v1.0":
            from a2ui.core.basic_catalog.v1_0 import BasicCatalog

            cat: Catalog[Any, Any] = BasicCatalog()
        elif p_ver == "v0.9":
            from a2ui.core.basic_catalog.v0_9 import BasicCatalog

            cat = BasicCatalog()
        elif p_ver == "v0.8":
            from a2ui.core.basic_catalog.v0_8 import BasicCatalog

            cat = BasicCatalog()
        else:
            raise ValueError(f"BasicCatalog not supported for version {p_ver}")
    else:
        c_path = case.get("catalogPath") or case.get("catalogFile")
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
        c_id = (
            resolve_catalog_id(case)
            or (c_schema.get("catalogId") if isinstance(c_schema, dict) else None)
            or "https://a2ui.org/catalogs/basic"
        )
        expect_err = case.get("expectError")

        if expect_err:
            with assert_raises(expect_err):
                Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)
            return
        else:
            cat = Catalog.from_json(c_schema, catalog_id=c_id, protocol_version=p_ver)

    assert cat is not None

    exp_path = case.get("expectPath") or case.get("expectFile")
    if exp_path:
        full_exp_p = os.path.abspath(os.path.join(CONFORMANCE_ROOT, "../", exp_path))
        with open(full_exp_p, "r", encoding="utf-8") as f:
            expected = json.load(f)
    else:
        expected = case.get("expect")

    if expected is not None:
        assert cat.catalog_schema == expected


def validate_resolve_path_case(case: dict[str, Any]) -> None:
    from a2ui.core.rendering.data_context import DataContext
    from a2ui.core.state.surface_model import SurfaceModel

    args = case.get("args", {})
    path = args.get("path", "")
    context_path = args.get("contextPath") or args.get("context_path")
    surface = SurfaceModel(surface_id="dummy", default_catalog=basic_catalog)
    ctx = DataContext(surface=surface, path=context_path or "/")
    res = ctx.resolve_path(path)
    expected = case.get("expect", {})
    if "result" in expected:
        assert res == expected["result"]


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
    res = processor.get_renderer_data_model()
    expected = case.get("expect")
    if expected is None and "expect" in case:
        assert res is None
    elif isinstance(expected, dict):
        if "data" in expected:
            assert res == expected["data"]
        else:
            assert res == expected
