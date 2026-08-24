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
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple
import pytest
import yaml

from a2ui.core.catalog import Catalog
from a2ui.core.basic_catalog import v0_8, v0_9, v1_0
from a2ui.core.schema import ProtocolVersion
from a2ui.core.processing import MessageProcessor
from a2ui.core.exceptions import (
    A2uiError,
    A2uiParseError,
    A2uiValidationError,
    A2uiCatalogError,
    A2uiIntegrityError,
)

CATEGORY_TO_EXCEPTION = {
    "ParseError": A2uiParseError,
    "ValidationError": A2uiValidationError,
    "CatalogError": A2uiCatalogError,
    "IntegrityError": A2uiIntegrityError,
}

SUPPORTED_PROTOCOL_VERSIONS = {"v0.8", "v0.9", "v1.0", "0.8", "0.9", "1.0"}

# Transition skip list for core test cases pending feature implementation or version adapters
SKIP_TEST_NAMES: Set[str] = {
    "test_topology_missing_root_error",
    "test_topology_direct_circular_reference_error",
    "test_topology_indirect_circular_reference_error",
    "test_topology_self_reference_error",
    "test_topology_dangling_child_reference_error",
    "test_topology_orphaned_component_error",
    "test_composition_surface_implicit_parent_container",
    "test_composition_allowed_parent_success",
    "test_composition_unallowed_parent_error",
    "test_composition_allowed_child_success",
    "test_composition_unallowed_child_error",
    "test_index_function_in_collection_loop",
    "test_index_function_with_offset",
    "test_index_function_nested_path",
    "test_index_function_outside_loop_error",
    "test_validation_result_dynamic_object_return",
    "test_validation_result_boolean_fallback",
    "test_pointer_escape_characters",
    "test_pointer_array_indexing",
    "test_pointer_auto_vivification",
    "test_data_deletion_value_null",
    "test_data_deletion_nested_pointer_sibling_preservation",
    "test_data_deletion_top_level_key",
    "test_data_deletion_parent_object_recursive",
}

# Transition skip list containing specific test suite files or basenames to skip entirely.
SKIP_TEST_SUITES: Set[str] = set()

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


def find_yaml_files(dir_path: str) -> List[str]:
    results = []
    if not os.path.exists(dir_path):
        return results
    for root, _, files in os.walk(dir_path):
        for file in files:
            if file.endswith(".yaml") or file.endswith(".yml"):
                results.append(os.path.join(root, file))
    return sorted(results)


def resolve_protocol_version(case: Dict[str, Any]) -> Optional[str]:
    if "protocolVersion" in case and case["protocolVersion"]:
        return case["protocolVersion"]
    cat_spec = case.get("catalog") if isinstance(case.get("catalog"), dict) else {}
    if "protocolVersion" in cat_spec and cat_spec["protocolVersion"]:
        return cat_spec["protocolVersion"]
    if "catalogs" in case and isinstance(case["catalogs"], list):
        for cat in case["catalogs"]:
            if isinstance(cat, dict) and cat.get("protocolVersion"):
                return cat["protocolVersion"]
    return None


def resolve_catalog_id(case: Dict[str, Any]) -> Optional[str]:
    cat_spec = case.get("catalog") if isinstance(case.get("catalog"), dict) else {}
    return case.get("catalogId") or cat_spec.get("catalogId")


def load_conformance_cases() -> List[Tuple[str, str, Dict[str, Any]]]:
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


def get_catalogs_for_test_case(case: Dict[str, Any]) -> List[Any]:
    catalogs_map: Dict[str, Any] = {}

    for cat in ALL_CATALOGS:
        if hasattr(cat, "catalog_id"):
            catalogs_map[cat.catalog_id] = cat
    catalogs_map["basic"] = basic_catalog
    catalogs_map["v0.8:basic"] = v08_catalog
    catalogs_map["v0.9:basic"] = v09_catalog
    catalogs_map["v1.0:basic"] = v10_catalog

    version = resolve_protocol_version(case) or "v0.9"

    def add_catalog_id(cat_id: str, ver: Optional[str] = None):
        if cat_id and cat_id not in catalogs_map:
            catalogs_map[cat_id] = Catalog(
                catalog_id=cat_id,
                protocol_version=ver or version,
                components=list(basic_catalog.components.values()),
            )

    specified_catalogs: List[Any] = []

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
                    catalogs_map[c_id] = cat
                    specified_catalogs.append(cat)

    messages: List[Any] = case.get("messages") or (
        [case["payload"]] if "payload" in case else []
    )
    if "steps" in case:
        for step in case["steps"]:
            if "payload" in step:
                payload = step["payload"]
                if isinstance(payload, list):
                    messages.extend(payload)
                elif isinstance(payload, dict):
                    messages.append(payload)

    expect_err = case.get("expectError")
    is_catalog_error_case = isinstance(expect_err, dict) and expect_err.get(
        "category"
    ) in ("CatalogError", "A2uiCatalogError")

    scan_version: Optional[str] = None

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
        expected_class = CATEGORY_TO_EXCEPTION.get(category, A2uiError)
    else:
        expected_class = ValueError
        message = str(expect_error)

    with pytest.raises(expected_class) as excinfo:
        yield

    if message:
        assert (
            message in str(excinfo.value)
            or re.search(re.escape(message), str(excinfo.value))
            or re.search(message, str(excinfo.value))
        )


CONFORMANCE_CASES = load_conformance_cases()


@pytest.mark.parametrize(
    "test_id, rel_path, case",
    CONFORMANCE_CASES,
    ids=[c[0] for c in CONFORMANCE_CASES],
)
def test_conformance_suite(test_id: str, rel_path: str, case: Dict[str, Any]) -> None:
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
    elif action in ("process_messages", "validate"):
        validate_process_messages_case(case)
    elif action in (
        "get_client_capabilities",
        "get_renderer_capabilities",
    ):
        validate_capabilities_case(case)
    else:
        pytest.skip(f"Action '{action}' not implemented in core Python harness.")


def validate_from_json_case(case: Dict[str, Any]) -> None:
    catalog_data = case["catalog"]
    override_id = case.get("catalogId")
    protocol_version = resolve_protocol_version(case) or "v0.9"
    expect_error = case.get("expectError")

    if expect_error:
        with assert_raises(expect_error):
            Catalog.from_json(
                catalog_data,
                catalog_id=override_id,
                protocol_version=protocol_version,
            )
    else:
        cat = Catalog.from_json(
            catalog_data,
            catalog_id=override_id,
            protocol_version=protocol_version,
        )
        expected = case.get("expect", {})
        if "catalogId" in expected:
            assert cat.catalog_id == expected["catalogId"]
        if "protocolVersion" in expected:
            assert cat.protocol_version == expected["protocolVersion"]
        if "instructions" in expected:
            assert cat.instructions == expected["instructions"]
        if "components" in expected:
            for comp_name, comp_expected in expected["components"].items():
                comp = cat.get_component(comp_name)
                assert comp is not None, f"Component '{comp_name}' missing from catalog"
                for k, v in comp_expected.items():
                    if k == "allowedParents":
                        assert comp.allowed_parents == v
                    elif k == "allowedChildren":
                        assert comp.allowed_children == v
        if "functions" in expected:
            for func_name, func_expected in expected["functions"].items():
                func = cat.get_function(func_name)
                assert func is not None, f"Function '{func_name}' missing from catalog"
                for k, v in func_expected.items():
                    if k == "allowedCallers":
                        assert func.allowed_callers == v
                    elif k == "requiresUserActivation":
                        assert func.requires_user_activation == v


def validate_catalog_schema_case(case: Dict[str, Any]) -> None:
    catalog_data = case["catalog"]
    override_id = resolve_catalog_id(case) or f"catalog-{case.get('name')}"
    protocol_version = resolve_protocol_version(case) or "v0.9"
    theme = case.get("theme")
    if theme and isinstance(catalog_data, dict):
        catalog_data = dict(catalog_data)
        catalog_data["theme"] = theme
    cat = Catalog.from_json(
        catalog_data,
        catalog_id=override_id,
        protocol_version=protocol_version,
    )
    schema = dict(cat.catalog_schema or {})
    components_map = schema.get("components", {})
    if components_map and "$defs" not in schema:
        defs = {}
        defs["anyComponent"] = {
            "oneOf": [{"$ref": f"#/components/{name}"} for name in components_map]
        }
        if schema.get("theme"):
            defs["theme"] = schema["theme"]
        schema["$defs"] = defs

    expected = case.get("expect", {})
    for k, v in expected.items():
        act_v = schema.get(k)
        if act_v is None and k == "protocolVersion":
            act_v = cat.protocol_version
        if act_v is None and k == "styles":
            act_v = schema.get("theme")
        assert act_v == v


def validate_process_messages_case(case: Dict[str, Any]) -> None:
    messages = case.get("messages") or (
        [case["payload"]] if "payload" in case else None
    )
    if not messages and "steps" in case:
        for step in case["steps"]:
            if "payload" in step:
                messages = step["payload"]
                break

    if not messages:
        return

    expect_error = case.get("expectError")
    catalogs = get_catalogs_for_test_case(case)
    strict_mode = bool(
        case.get("strictMode")
        or case.get("strict_mode")
        or case.get("options", {}).get("strict_mode")
    )
    processor = MessageProcessor(catalogs, strict_mode=strict_mode)

    if expect_error:
        with assert_raises(expect_error):
            processor.process_messages(messages)
    else:
        processor.process_messages(messages)
        expected = case.get("expect", {})
        if "surfaces" in expected:
            for s_id, s_exp in expected["surfaces"].items():
                surface = processor.model.get_surface(s_id)
                if s_exp.get("exists") is False:
                    assert surface is None
                    continue
                assert surface is not None
                if "components" in s_exp:
                    comps_expected = s_exp["components"]
                    if isinstance(comps_expected, dict):
                        comp_items = list(comps_expected.items())
                    elif isinstance(comps_expected, list):
                        comp_items = [
                            (c.get("id"), c)
                            for c in comps_expected
                            if isinstance(c, dict)
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


def validate_capabilities_case(case: Dict[str, Any]) -> None:
    catalogs = get_catalogs_for_test_case(case)
    processor = MessageProcessor(catalogs)
    ver = resolve_protocol_version(case) or "v0.9"
    p_ver = ProtocolVersion(ver)
    caps = processor.get_renderer_capabilities(versions=[p_ver])
    expected = case.get("expect", {})
    for k, v in expected.items():
        assert k in caps
