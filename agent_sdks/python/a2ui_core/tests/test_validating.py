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

from typing import Any, Dict, List, Set, Tuple, Literal
import pytest
from pydantic import BaseModel

from a2ui.core.validating import (
    A2uiValidator,
    A2uiValidatorError,
    analyze_topology,
    validate_component_integrity,
    validate_recursion_and_paths,
    get_component_references,
    ValidationConfig,
    CatalogSchemaValidator,
)
from a2ui.core.basic_catalog import BasicCatalog


# ==============================================================================
# 1. Integrity Checker Tests
# ==============================================================================


def test_get_component_references():
    ref_map = {
        "Container": ({"singleChild", "nestedObj"}, {"childrenList", "tabs"}),
    }
    comp = {
        "id": "c1",
        "component": {
            "Container": {
                "singleChild": "child1",
                "childrenList": ["child2", "child3"],
                "nestedObj": {"componentId": "child4"},
                "tabs": [{"child": "tab1"}, {"child": "tab2"}],
            }
        },
    }

    refs = list(get_component_references(comp, ref_map))
    ref_ids = [r[0] for r in refs]

    assert "child1" in ref_ids
    assert "child2" in ref_ids
    assert "child3" in ref_ids
    assert "child4" in ref_ids
    assert "tab1" in ref_ids
    assert "tab2" in ref_ids


def test_validate_component_integrity_valid():
    ref_map = {"Box": ({"child"}, set())}
    components = [
        {"id": "root", "component": {"Box": {"child": "c1"}}},
        {"id": "c1", "component": {"Box": {}}},
    ]
    # Should pass without error
    validate_component_integrity(
        components,
        ref_map,
    )


def test_validate_component_integrity_duplicate_id():
    components = [
        {"id": "c1", "component": "Box"},
        {"id": "c1", "component": "Text"},
    ]
    with pytest.raises(ValueError, match="Duplicate component ID: c1"):
        validate_component_integrity(
            components,
            {},
        )


def test_validate_component_integrity_missing_root():
    components = [
        {"id": "c1", "component": "Box"},
    ]
    with pytest.raises(
        ValueError, match="Missing root component: No component has id='root'"
    ):
        validate_component_integrity(
            components,
            {},
        )


def test_validate_component_integrity_dangling_ref():
    ref_map = {"Box": ({"child"}, set())}
    components = [
        {"id": "root", "component": {"Box": {"child": "nonexistent"}}},
    ]
    with pytest.raises(
        ValueError, match="references non-existent component 'nonexistent'"
    ):
        validate_component_integrity(
            components,
            ref_map,
        )


def test_validate_recursion_and_paths_valid():
    data = {"path": "/valid/path", "nested": [{"path": "/another"}]}
    validate_recursion_and_paths(data)


def test_validate_recursion_and_paths_invalid_path():
    data = {"path": "invalid~path//double"}
    with pytest.raises(ValueError, match="Invalid path syntax"):
        validate_recursion_and_paths(data)


def test_validate_recursion_and_paths_global_depth():
    # Construct a nested structure deeper than 50
    deep_list: Any = []
    for _ in range(52):
        deep_list = [deep_list]

    with pytest.raises(ValueError, match="Global recursion limit exceeded"):
        validate_recursion_and_paths(deep_list)


def test_validate_recursion_and_paths_func_depth():
    # Construct functionCall nesting deeper than 5
    deep_call: Dict[str, Any] = {}
    curr = deep_call
    for _ in range(6):
        curr["call"] = "func"
        curr["args"] = {}
        curr = curr["args"]

    with pytest.raises(
        ValueError, match="Recursion limit exceeded: functionCall depth"
    ):
        validate_recursion_and_paths(deep_call)


# ==============================================================================
# 2. Topology Analyzer Tests
# ==============================================================================


def test_analyze_topology_valid():
    ref_map = {"Node": ({"next"}, set())}
    components = [
        {"id": "root", "component": {"Node": {"next": "n1"}}},
        {"id": "n1", "component": {"Node": {}}},
    ]
    visited = analyze_topology(
        components,
        ref_map,
        allow_orphan_components=False,
    )
    assert visited == {"root", "n1"}


def test_analyze_topology_self_ref():
    ref_map = {"Node": ({"next"}, set())}
    components = [
        {"id": "root", "component": {"Node": {"next": "root"}}},
    ]
    with pytest.raises(
        ValueError,
        match="Self-reference detected: Component 'root' references itself",
    ):
        analyze_topology(
            components,
            ref_map,
        )


def test_analyze_topology_circular_ref():
    ref_map = {"Node": ({"next"}, set())}
    components = [
        {"id": "root", "component": {"Node": {"next": "n1"}}},
        {"id": "n1", "component": {"Node": {"next": "root"}}},
    ]
    with pytest.raises(
        ValueError, match="Circular reference detected involving component 'root'"
    ):
        analyze_topology(
            components,
            ref_map,
        )


def test_analyze_topology_orphans():
    ref_map = {"Node": ({"next"}, set())}
    components = [
        {"id": "root", "component": {"Node": {}}},
        {"id": "orphan", "component": {"Node": {}}},
    ]
    with pytest.raises(
        ValueError, match="Component 'orphan' is not reachable from 'root'"
    ):
        analyze_topology(
            components,
            ref_map,
            allow_orphan_components=False,
        )


# ==============================================================================
# 3. Validator Tests
# ==============================================================================


def test_a2ui_validator_protocol_envelope_invalid_version():
    validator = A2uiValidator()
    with pytest.raises(
        A2uiValidatorError,
        match="'version' is a required property|'v0.9' was expected|Field required",
    ):
        validator.validate_protocol_envelope([{"not_version": "v0.8"}])


def test_a2ui_validator_protocol_envelope_not_dict():
    validator = A2uiValidator()
    with pytest.raises(A2uiValidatorError, match="Message must be an object"):
        validator.validate_protocol_envelope(["not_a_dict"])  # type: ignore


def test_a2ui_validator_validate_valid_payload():
    catalog = BasicCatalog()
    validator = A2uiValidator()

    messages = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": "https://a2ui.org/catalog",
                "theme": {"primaryColor": "#000000"},
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["c1"],
                    },
                    {
                        "id": "c1",
                        "component": "Text",
                        "text": "Hello",
                    },
                ],
            },
        },
    ]

    validator.validate(CatalogSchemaValidator.from_catalog(catalog), messages)


def test_a2ui_validator_validate_components_error():
    catalog = BasicCatalog()
    validator = A2uiValidator()

    messages = [
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {
                        "id": "root",
                        "component": "NonexistentComponent",
                    }
                ],
            },
        }
    ]

    with pytest.raises(A2uiValidatorError):
        validator.validate(CatalogSchemaValidator.from_catalog(catalog), messages)


def test_topology_cyclomatic_orphans_coverage():
    ref_map = {"Node": ({"child"}, set())}

    components_orphan = [
        {"id": "root", "component": "Node", "child": "A"},
        {"id": "A", "component": "Node"},
        {"id": "B", "component": "Node"},
    ]
    with pytest.raises(ValueError, match="is not reachable from 'root'"):
        analyze_topology(
            components_orphan,
            ref_map,
            allow_orphan_components=False,
        )

    components_cycle = [
        {"id": "root", "component": "Node", "child": "A"},
        {"id": "A", "component": "Node", "child": "B"},
        {"id": "B", "component": "Node", "child": "A"},
    ]
    with pytest.raises(ValueError, match="Circular reference detected"):
        analyze_topology(
            components_cycle,
            ref_map,
        )

    components_self = [{"id": "root", "component": "Node", "child": "root"}]
    with pytest.raises(ValueError, match="Self-reference detected"):
        analyze_topology(
            components_self,
            ref_map,
        )


def test_integrity_dangling_and_duplicate_pointers():
    ref_map = {"Node": ({"child"}, set())}

    components_dup = [
        {"id": "root", "component": "Node"},
        {"id": "root", "component": "Node"},
    ]
    with pytest.raises(ValueError, match="Duplicate component ID"):
        validate_component_integrity(
            components_dup,
            ref_map,
        )

    components_dangle = [{"id": "root", "component": "Node", "child": "MissingNode"}]
    with pytest.raises(ValueError, match="references non-existent component"):
        validate_component_integrity(
            components_dangle,
            ref_map,
        )


def test_validate_recursion_and_paths_syntax_coverage():
    # 1. Realistic A2UI v0.9 Payload with Invalid Pointer Syntax
    invalid_path_payload = {
        "version": "v0.9",
        "updateDataModel": {
            "surfaceId": "s1",
            "path": "/users/~3name",  # Unescaped pointer!
            "value": "John",
        },
    }
    with pytest.raises(ValueError, match="Invalid path syntax"):
        validate_recursion_and_paths(invalid_path_payload)

    # 2. Realistic A2UI v0.9 Payload with Max Function Call Recursion Depth
    payload_deep_func = {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [
                {
                    "id": "root",
                    "component": "Text",
                    "text": {
                        "call": "nestedFunctionA",
                        "args": {
                            "val": {
                                "call": "nestedFunctionB",
                                "args": {
                                    "val": {
                                        "call": "nestedFunctionC",
                                        "args": {
                                            "val": {
                                                "call": "nestedFunctionD",
                                                "args": {
                                                    "val": {
                                                        "call": "nestedFunctionE",
                                                        "args": {
                                                            "val": {
                                                                "call": "nestedFunctionF",
                                                                "args": {},
                                                            }
                                                        },
                                                    }
                                                },
                                            }
                                        },
                                    }
                                },
                            }
                        },
                    },
                }
            ],
        },
    }
    with pytest.raises(ValueError, match="Recursion limit exceeded"):
        validate_recursion_and_paths(payload_deep_func)


def test_validator_aggregated_pydantic_error_formatting():
    validator = A2uiValidator()

    invalid_s2c_payload = [{"version": "v0.9"}]

    with pytest.raises(A2uiValidatorError) as exc_info:
        validator.validate_protocol_envelope(invalid_s2c_payload)

    assert "messages.0" in str(exc_info.value)


def test_validator_config_parameter():
    # Verify that ValidationConfig is respected during validation

    catalog = CatalogSchemaValidator.from_catalog(BasicCatalog())
    validator = A2uiValidator()
    strict_config = ValidationConfig(
        allow_orphan_components=False, allow_dangling_references=False
    )
    relaxed_config = ValidationConfig(
        allow_orphan_components=True, allow_dangling_references=True
    )

    # 1. Orphan component: with strict_config, this fails. With relaxed_config, it succeeds!
    orphan_components = [
        {"id": "root", "component": "Column", "children": []},
        {"id": "orphan", "component": "Text", "text": "I am an orphan"},
    ]
    with pytest.raises(A2uiValidatorError, match="is not reachable from"):
        validator.validate_components(catalog, orphan_components, config=strict_config)

    validator.validate_components(catalog, orphan_components, config=relaxed_config)

    # 2. Dangling reference: with strict_config, this fails. With relaxed_config, it succeeds!
    dangling_components = [
        {"id": "root", "component": "Column", "children": ["non_existent_id"]}
    ]
    with pytest.raises(A2uiValidatorError, match="references non-existent component"):
        validator.validate_components(
            catalog, dangling_components, config=strict_config
        )

    validator.validate_components(catalog, dangling_components, config=relaxed_config)

    # 3. Full message validation
    payload = {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": dangling_components,
        },
    }
    with pytest.raises(A2uiValidatorError, match="references non-existent component"):
        validator.validate(catalog, payload, config=strict_config)

    validator.validate(catalog, payload, config=relaxed_config)
