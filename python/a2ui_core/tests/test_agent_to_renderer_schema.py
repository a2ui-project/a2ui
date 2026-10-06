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

"""Checks the agent_to_renderer (server_to_client) schema generated from the Pydantic models.

Byte-for-byte equality with the published `server_to_client.json` /
`agent_to_renderer.json` files is covered by the `agent_to_renderer`
conformance suite. These tests verify that the generated schema is a valid
JSON Schema document, that messages dumped from the Pydantic models validate
against it, and that the public API returns independent copies.
"""

import glob
import importlib
import json
import os
from typing import Any

import pytest
from jsonschema import Draft202012Validator, ValidationError
from pydantic import TypeAdapter
from referencing import Registry, Resource

from a2ui.core.common import to_protocol_version
from a2ui.core.exceptions import A2uiError
from a2ui.core.schema import (
    ProtocolVersion,
    get_agent_to_renderer_schema_json,
    get_agent_to_renderer_schema_map,
    get_common_types_schema_map,
    v0_8 as schema_v0_8,
    v0_9 as schema_v0_9,
    v1_0 as schema_v1_0,
)
from a2ui.core.validation import SchemaValidator

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SPEC_ROOT = os.path.join(REPO_ROOT, "specification")

_SCHEMA_PACKAGES = {
    "v0_8": "v0_8",
    "v0_9": "v0_9",
    "v0_9_1": "v0_9",
    "v1_0": "v1_0",
}

_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"


def _spec_versions() -> list[str]:
    """Specification directories that publish a server_to_client.json or agent_to_renderer.json."""
    paths = [
        *glob.glob(os.path.join(SPEC_ROOT, "v*", "json", "server_to_client.json")),
        *glob.glob(os.path.join(SPEC_ROOT, "v*", "json", "agent_to_renderer.json")),
    ]
    return sorted(
        {os.path.basename(os.path.dirname(os.path.dirname(p))) for p in paths}
    )


def _protocol_version(version: str) -> ProtocolVersion:
    """Turns a directory name into a protocol version: 'v0_9_1' -> V0_9_1."""
    return to_protocol_version(version[1:].replace("_", "."))


def test_every_published_version_has_a_schema_package() -> None:
    """A new specification version cannot silently skip these checks."""
    versions = _spec_versions()
    assert (
        versions
    ), f"No server_to_client.json or agent_to_renderer.json found under {SPEC_ROOT}."
    assert set(versions) <= set(_SCHEMA_PACKAGES), versions


@pytest.mark.parametrize("version", _spec_versions())
def test_generated_schema_is_valid_meta_schema(version: str) -> None:
    """The generated schema for every version is a valid Draft 2020-12 document."""
    schema_map = get_agent_to_renderer_schema_map(_protocol_version(version))
    Draft202012Validator(Draft202012Validator.META_SCHEMA).validate(schema_map)


def test_v08_models_round_trip_through_generated_schema() -> None:
    """v0.8 payload models serialize to objects accepted by the generated v0.8 schema."""
    schema_map = get_agent_to_renderer_schema_map(ProtocolVersion.V0_8)
    validator = Draft202012Validator(schema_map)

    begin_msg = schema_v0_8.BeginRendering(
        surface_id="s1",
        root="root_comp",
        styles={"primaryColor": "#FF0000"},
    )
    validator.validate(
        {"beginRendering": begin_msg.model_dump(by_alias=True, exclude_none=True)}
    )

    surface_update = schema_v0_8.SurfaceUpdate(
        surface_id="s1",
        components=[
            schema_v0_8.SurfaceUpdateComponentsItem(
                id="root_comp",
                component={"Text": {"text": {"literalString": "Hello"}}},
            )
        ],
    )
    validator.validate(
        {"surfaceUpdate": surface_update.model_dump(by_alias=True, exclude_none=True)}
    )

    data_update = schema_v0_8.DataModelUpdate(
        surface_id="s1",
        contents=[
            schema_v0_8.DataModelUpdateContentsItem(
                key="user",
                value_map=[
                    schema_v0_8.DataModelUpdateContentsItemValueMapItem(
                        key="name",
                        value_string="Alice",
                    )
                ],
            )
        ],
    )
    validator.validate(
        {"dataModelUpdate": data_update.model_dump(by_alias=True, exclude_none=True)}
    )

    with pytest.raises(ValidationError):
        validator.validate({"surfaceUpdate": {"surfaceId": "s1", "components": []}})


@pytest.mark.parametrize(
    "protocol_version",
    [ProtocolVersion.V0_9, ProtocolVersion.V0_9_1, ProtocolVersion.V1_0],
)
def test_modern_models_round_trip_through_generated_schema(
    protocol_version: ProtocolVersion,
) -> None:
    """Messages dumped from v0.9/v0.9.1/v1.0 models validate against the generated schema."""
    schema_map = get_agent_to_renderer_schema_map(protocol_version)
    common_map = get_common_types_schema_map(protocol_version)

    call_key = "@call" if protocol_version == ProtocolVersion.V1_0 else "call"
    base_uri = schema_map["$id"].rsplit("/", 1)[0]
    stub_catalog_uri = f"{base_uri}/catalog.json"
    registry: Registry[Any] = (
        Registry()
        .with_resource(
            common_map["$id"],
            Resource.from_contents(common_map),
        )
        .with_resource(
            stub_catalog_uri,
            Resource.from_contents({
                "$schema": _DRAFT_2020_12,
                "$id": stub_catalog_uri,
                "$defs": {
                    "theme": {
                        "type": "object",
                        "properties": {"primaryColor": {"type": "string"}},
                        "additionalProperties": False,
                    },
                    "anyComponent": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "component": {"const": "Text"},
                            "text": {"type": "string"},
                        },
                        "required": ["component", "text"],
                    },
                    "anyFunction": {
                        "type": "object",
                        "properties": {
                            call_key: {"const": "fetchData"},
                            "args": {"type": "object"},
                        },
                        "required": [call_key],
                    },
                },
            }),
        )
    )
    validator = SchemaValidator(schema_map, registry=registry)

    pkg = schema_v1_0 if protocol_version == ProtocolVersion.V1_0 else schema_v0_9
    adapter: TypeAdapter[Any] = TypeAdapter(pkg.AgentToRendererMessage)

    instances: list[dict[str, Any]] = [
        {
            "version": protocol_version.value,
            "createSurface": {
                "surfaceId": "s1",
                "catalogId": "https://example.com/catalog.json",
                "sendDataModel": True,
            },
        },
        {
            "version": protocol_version.value,
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Text", "text": "Hello"}],
            },
        },
        {
            "version": protocol_version.value,
            "updateDataModel": {
                "surfaceId": "s1",
                "path": "/user",
                "value": {"name": "Alice"},
            },
        },
        {
            "version": protocol_version.value,
            "deleteSurface": {"surfaceId": "s1"},
        },
    ]
    if protocol_version == ProtocolVersion.V1_0:
        instances.extend([
            {
                "version": "v1.0",
                "callRendererFunction": {
                    "functionCallId": "call_1",
                    "callFunction": {
                        "@call": "fetchData",
                        "catalogId": "https://example.com/catalog.json",
                        "args": {"q": "test"},
                    },
                },
            },
            {
                "version": "v1.0",
                "agentFunctionResponse": {
                    "functionCallId": "call_1",
                    "value": {"ok": True},
                },
            },
        ])

    for instance in instances:
        validated = adapter.validate_python(instance)
        dumped = adapter.dump_python(
            validated, mode="json", by_alias=True, exclude_unset=True
        )
        assert dumped == instance
        validator.validate(dumped)

    # Empty components array violates minItems: 1 in the generated schema.
    with pytest.raises(ValidationError):
        validator.validate({
            "version": protocol_version.value,
            "updateComponents": {"surfaceId": "s1", "components": []},
        })


def test_agent_to_renderer_schema_returns_independent_copies() -> None:
    """Mutating a returned schema map does not corrupt the internal cache."""
    schema = get_agent_to_renderer_schema_map(ProtocolVersion.V1_0)
    schema["title"] = "Mutated"
    assert (
        get_agent_to_renderer_schema_map(ProtocolVersion.V1_0)["title"]
        == "A2UI Message Schema"
    )
    assert (
        json.loads(get_agent_to_renderer_schema_json(ProtocolVersion.V1_0))["title"]
        == "A2UI Message Schema"
    )


def test_agent_to_renderer_schema_rejects_unsupported_version() -> None:
    with pytest.raises(A2uiError):
        get_agent_to_renderer_schema_map("v99.0")  # type: ignore[arg-type]


def test_agent_to_renderer_schema_rejects_missing_message_union(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from a2ui.core.schema import agent_to_renderer_schema as schema_mod

    mod = importlib.import_module("a2ui.core.schema.v0_9.server_to_client")
    monkeypatch.delattr(mod, "AgentToRendererMessage", raising=False)
    with pytest.raises(A2uiError, match="does not define AgentToRendererMessage"):
        schema_mod._build_agent_to_renderer_schema(ProtocolVersion.V0_9)
