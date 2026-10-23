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

import glob
import json
import os
from pathlib import Path

import jsonschema
import pytest
import referencing
import yaml


def load_json_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_yaml_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


CONFORMANCE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = CONFORMANCE_DIR.parent
SCHEMA = load_json_file(CONFORMANCE_DIR / "conformance_schema.json")
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA)
FIXTURE_VALIDATOR = jsonschema.Draft202012Validator(
    {"$ref": "#/$defs/NodeResolutionFixture", "$defs": SCHEMA["$defs"]}
)

V10_COMMON_TYPES = load_json_file(
    REPO_ROOT / "specification" / "v1_0" / "json" / "common_types.json"
)
V10_RENDERER_TO_AGENT = load_json_file(
    REPO_ROOT / "specification" / "v1_0" / "json" / "renderer_to_agent.json"
)
V09_COMMON_TYPES = load_json_file(
    REPO_ROOT / "specification" / "v0_9" / "json" / "common_types.json"
)
V09_CLIENT_TO_SERVER = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://a2ui.org/specification/v0_9/client_to_server.json",
    **load_json_file(
        REPO_ROOT / "specification" / "v0_9" / "json" / "client_to_server.json"
    ),
}

SPEC_REGISTRY = referencing.Registry().with_resources([
    (
        V10_COMMON_TYPES["$id"],
        referencing.Resource.from_contents(V10_COMMON_TYPES),
    ),
    (
        V10_RENDERER_TO_AGENT["$id"],
        referencing.Resource.from_contents(V10_RENDERER_TO_AGENT),
    ),
    (
        V09_COMMON_TYPES["$id"],
        referencing.Resource.from_contents(V09_COMMON_TYPES),
    ),
    (
        V09_CLIENT_TO_SERVER["$id"],
        referencing.Resource.from_contents(V09_CLIENT_TO_SERVER),
    ),
])

V10_RENDERER_TO_AGENT_VALIDATOR = jsonschema.Draft202012Validator(
    V10_RENDERER_TO_AGENT, registry=SPEC_REGISTRY
)
V09_CLIENT_TO_SERVER_VALIDATOR = jsonschema.Draft202012Validator(
    V09_CLIENT_TO_SERVER, registry=SPEC_REGISTRY
)


def validate_renderer_error_payload(renderer_error):
    version = renderer_error.get("version")
    if version == "v1.0":
        V10_RENDERER_TO_AGENT_VALIDATOR.validate(renderer_error)
    elif version in ("v0.9", "v0.9.1"):
        normalized = (
            {**renderer_error, "version": "v0.9"}
            if version == "v0.9.1"
            else renderer_error
        )
        V09_CLIENT_TO_SERVER_VALIDATOR.validate(normalized)
    else:
        raise ValueError(f"Unsupported rendererError version: {version!r}")


def _iter_container_renderer_errors(container):
    for key in ("expectError", "expect_error"):
        err = container.get(key)
        if isinstance(err, dict) and "rendererError" in err:
            yield err["rendererError"]


def iter_renderer_errors(case):
    yield from _iter_container_renderer_errors(case)
    for step in case.get("steps") or []:
        if isinstance(step, dict):
            yield from _iter_container_renderer_errors(step)


def get_yaml_files():
    files = []
    for domain in ["core", "agent", "extensions"]:
        pattern = os.path.join(CONFORMANCE_DIR, domain, "**", "*.yaml")
        files.extend(
            f
            for f in glob.glob(pattern, recursive=True)
            if not (
                f.startswith(os.path.join(CONFORMANCE_DIR, "agent", "builder"))
                or f.startswith(os.path.join(CONFORMANCE_DIR, "agent", "macros"))
            )
        )
    return sorted(files)


def validate_node_fixture(fixture_path, conformance_dir):
    fixture = load_yaml_file(fixture_path)
    FIXTURE_VALIDATOR.validate(fixture)
    catalog = load_json_file(conformance_dir / fixture["catalog"])
    if not isinstance(catalog, dict):
        raise ValueError(f"{fixture['catalog']}: catalog must be a JSON object")


def validate_conformance_yaml(yaml_path, conformance_dir=CONFORMANCE_DIR):
    yaml_data = load_yaml_file(yaml_path)
    VALIDATOR.validate(yaml_data)
    for case in yaml_data:
        if case["action"] == "resolve_nodes" and "fixture" in case:
            validate_node_fixture(conformance_dir / case["fixture"], conformance_dir)
        for renderer_error in iter_renderer_errors(case):
            validate_renderer_error_payload(renderer_error)


@pytest.mark.parametrize(
    "yaml_path",
    get_yaml_files(),
    ids=lambda item: os.path.basename(item) if isinstance(item, str) else str(item),
)
def test_validate_conformance_yaml(yaml_path):
    try:
        validate_conformance_yaml(yaml_path)
    except jsonschema.ValidationError as e:
        pytest.fail(f"{yaml_path} at {e.json_path}: {e.message}")
    except (OSError, ValueError, yaml.YAMLError) as e:
        pytest.fail(f"{yaml_path}: {e}")


def node_case(**changes):
    return {
        "name": "schema regression",
        "action": "resolve_nodes",
        "fixture": "test_data/node/fixture.yaml",
        "expect": {"nodes": {}},
        "steps": [],
        **changes,
    }


@pytest.mark.parametrize("missing", ["expect", "steps"])
def test_node_cases_require_their_fields(missing):
    case = {key: value for key, value in node_case().items() if key != missing}
    with pytest.raises(jsonschema.ValidationError):
        VALIDATOR.validate([case])


@pytest.mark.parametrize(
    "step",
    [
        {"op": "set_data", "path": "/name", "value": None},
        {
            "op": "update_components",
            "components": [{"id": "root", "component": "Text"}],
        },
        {"op": "remove_component", "component_id": "root"},
        {"op": "write", "node": "root", "property": "value", "value": None},
        {"op": "invoke", "node": "root", "property": "action"},
        {
            "op": "process_messages",
            "messages": [{"version": "v1.0", "deleteSurface": {"surfaceId": "main"}}],
        },
        {"op": "dispose"},
    ],
)
def test_node_operations_require_their_operands(step):
    step = {**step, "expect": {"nodes": {}, "emissions": {}}}
    VALIDATOR.validate([node_case(steps=[step])])
    for operand in step:
        incomplete = {key: value for key, value in step.items() if key != operand}
        with pytest.raises(jsonschema.ValidationError):
            VALIDATOR.validate([node_case(steps=[incomplete])])


@pytest.mark.parametrize(
    "step",
    [
        {"op": "dipose", "expect": {"nodes": {}, "emissions": {}}},
        {"op": "dispose", "node": "root", "expect": {"nodes": {}, "emissions": {}}},
        {"op": "dispose", "expect": {"nodes": {}, "emisions": {}}},
        {"op": "dispose", "expect": {"nodes": {}, "emissions": {"root": 0}}},
    ],
)
def test_node_steps_reject_unknown_or_incomplete_assertions(step):
    with pytest.raises(jsonschema.ValidationError):
        VALIDATOR.validate([node_case(steps=[step])])


@pytest.mark.parametrize(
    "expectation",
    [
        {},
        {"nodes": {}, "same_node": []},
        {"nodes": {"root": {"componentId": "root"}}},
        {"nodes": {"root": {"state": "resovled"}}},
        {"nodes": {}, "events": [{"name": "save", "context": {}}]},
        {"nodes": {}, "functions": [{"name": "openUrl", "arguments": {}}]},
    ],
)
def test_node_expectations_reject_unknown_or_incomplete_fields(expectation):
    with pytest.raises(jsonschema.ValidationError):
        VALIDATOR.validate([node_case(expect=expectation)])


@pytest.mark.parametrize(
    "fixture",
    [
        None,
        {},
        {"catalog": "catalog.json", "data": [], "components": []},
        {"catalog": "catalog.json", "data": {}, "components": {}},
        {"catalog": "catalog.json", "data": {}, "components": [{"id": "root"}]},
        {"catalog": "catalog.json", "data": {}, "components": [], "component": []},
    ],
)
def test_node_fixture_shape_is_validated(tmp_path, fixture):
    fixture_path = tmp_path / "fixture.yaml"
    fixture_path.write_text(yaml.safe_dump(fixture), encoding="utf-8")
    with pytest.raises(jsonschema.ValidationError):
        validate_node_fixture(fixture_path, tmp_path)


def write_node_suite(tmp_path):
    suite_path = tmp_path / "suite.yaml"
    suite_path.write_text(yaml.safe_dump([node_case()]), encoding="utf-8")
    fixture_path = tmp_path / "test_data/node/fixture.yaml"
    fixture_path.parent.mkdir(parents=True)
    fixture_path.write_text(
        yaml.safe_dump({"catalog": "catalog.json", "data": {}, "components": []}),
        encoding="utf-8",
    )
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text("{}", encoding="utf-8")
    return suite_path, fixture_path, catalog_path


def test_node_paths_are_relative_to_conformance_root(tmp_path):
    suite_path, _, _ = write_node_suite(tmp_path)
    validate_conformance_yaml(suite_path, tmp_path)


@pytest.mark.parametrize("missing", ["fixture", "catalog"])
def test_node_fixture_and_catalog_paths_must_exist(tmp_path, missing):
    suite_path, fixture_path, catalog_path = write_node_suite(tmp_path)
    (fixture_path if missing == "fixture" else catalog_path).unlink()
    with pytest.raises(FileNotFoundError):
        validate_conformance_yaml(suite_path, tmp_path)


@pytest.mark.parametrize("catalog", ["not JSON", "[]"])
def test_node_catalog_must_be_a_json_object(tmp_path, catalog):
    suite_path, _, catalog_path = write_node_suite(tmp_path)
    catalog_path.write_text(catalog, encoding="utf-8")
    with pytest.raises(ValueError):
        validate_conformance_yaml(suite_path, tmp_path)


@pytest.mark.parametrize(
    "valid_renderer_error",
    [
        {
            "version": "v1.0",
            "error": {
                "code": "VALIDATION_FAILED",
                "surfaceId": "s1",
                "path": "/components/0/text",
                "message": "Invalid property type",
            },
        },
        {
            "version": "v1.0",
            "error": {
                "code": "UNALLOWED_PARENT",
                "surfaceId": "s1",
                "path": "/components/1",
                "message": "Parent not allowed",
            },
        },
        {
            "version": "v1.0",
            "error": {
                "code": "INVALID_FUNCTION_CALL",
                "functionCallId": "call-109",
                "message": "Missing callFunction",
            },
        },
        {
            "version": "v0.9",
            "error": {
                "code": "VALIDATION_FAILED",
                "surfaceId": "s1",
                "path": "/components/0/text",
                "message": "Invalid property type",
            },
        },
        {
            "version": "v0.9",
            "error": {
                "code": "INTEGRITY_ERROR",
                "surfaceId": "s1",
                "message": "Duplicate surfaceId",
            },
        },
    ],
)
def test_renderer_error_validates_against_spec(valid_renderer_error):
    validate_renderer_error_payload(valid_renderer_error)


@pytest.mark.parametrize(
    "invalid_renderer_error",
    [
        # v1.0 VALIDATION_FAILED missing required path
        {
            "version": "v1.0",
            "error": {
                "code": "VALIDATION_FAILED",
                "surfaceId": "s1",
                "message": "Missing path",
            },
        },
        # v1.0 generic error with both surfaceId and functionCallId violates oneOf
        {
            "version": "v1.0",
            "error": {
                "code": "INVALID_FUNCTION_CALL",
                "surfaceId": "s1",
                "functionCallId": "call-1",
                "message": "Both surfaceId and functionCallId",
            },
        },
        # v0.9 UNALLOWED_PARENT is not allowed as a ValidationFailedError in v0.9 without downgrade
        {
            "version": "v0.9",
            "error": {
                "code": "VALIDATION_FAILED",
                "surfaceId": "s1",
                "message": "Missing path in v0.9",
            },
        },
    ],
)
def test_renderer_error_rejects_spec_violations(invalid_renderer_error):
    with pytest.raises(jsonschema.ValidationError):
        validate_renderer_error_payload(invalid_renderer_error)
