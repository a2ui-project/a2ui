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

import pytest
from pydantic import ValidationError
from typing import get_args

from a2ui.core import (
    A2uiCatalogError,
    Catalog,
    get_agent_to_renderer_schema_map,
    get_common_types_schema_map,
)
from a2ui.core.schema import (
    ProtocolVersion,
    A2uiClientMessageListWrapper,
    A2uiClientActionMessage,
    A2uiRendererErrorMessage,
    A2uiClientDataModel,
    A2uiValidationError,
    A2uiGenericError,
    A2uiMessage,
    DeleteSurfaceMessage,
)


def test_valid_action_message():
    valid_action = {
        "version": "v0.9",
        "action": {
            "name": "submit",
            "surfaceId": "s1",
            "sourceComponentId": "c1",
            "timestamp": "2026-06-02T23:37:16Z",
            "context": {"foo": "bar"},
        },
    }
    msg = A2uiClientActionMessage.model_validate(valid_action)
    assert msg.version == "v0.9"
    assert msg.action.name == "submit"
    assert msg.action.context == {"foo": "bar"}


def test_valid_validation_error_message():
    valid_error = {
        "version": "v0.9",
        "error": {
            "code": "VALIDATION_FAILED",
            "surfaceId": "s1",
            "path": "/components/0/text",
            "message": "Too short",
        },
    }
    msg = A2uiRendererErrorMessage.model_validate(valid_error)
    assert msg.version == "v0.9"
    assert isinstance(msg.error, A2uiValidationError)
    assert msg.error.code == "VALIDATION_FAILED"
    assert msg.error.path == "/components/0/text"


def test_valid_generic_error_message():
    valid_error = {
        "version": "v0.9",
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "Something went wrong",
            "surfaceId": "s1",
        },
    }
    msg = A2uiRendererErrorMessage.model_validate(valid_error)
    assert msg.version == "v0.9"
    assert isinstance(msg.error, A2uiGenericError)
    assert msg.error.code == "INTERNAL_ERROR"
    assert msg.error.message == "Something went wrong"


def test_valid_data_model_message():
    valid_data_model = {
        "version": "v0.9",
        "surfaces": {
            "s1": {"user": "Alice"},
            "s2": {"cart": []},
        },
    }
    msg = A2uiClientDataModel.model_validate(valid_data_model)
    assert msg.version == "v0.9"
    assert msg.surfaces["s1"] == {"user": "Alice"}
    assert msg.surfaces["s2"] == {"cart": []}


def test_fails_on_invalid_version():
    invalid_action = {
        "version": "v0.8",
        "action": {
            "name": "submit",
            "surfaceId": "s1",
            "sourceComponentId": "c1",
            "timestamp": "2026-06-02T23:37:16Z",
            "context": {},
        },
    }
    with pytest.raises(ValidationError):
        A2uiClientActionMessage.model_validate(invalid_action)


def test_valid_delete_surface_server_message():
    msg = {
        "version": "v0.9",
        "deleteSurface": {"surfaceId": "surface-1"},
    }
    parsed = DeleteSurfaceMessage.model_validate(msg)
    assert parsed.version == "v0.9"
    assert parsed.delete_surface.surface_id == "surface-1"


def test_seamless_programmatic_construction_snake_or_alias():
    from a2ui.core.schema import CreateSurface

    # 1. Construct using snake_case keyword arguments
    obj_snake = CreateSurface(surface_id="surf-snake", catalog_id="cat-snake")
    assert obj_snake.surface_id == "surf-snake"
    assert obj_snake.catalog_id == "cat-snake"
    assert obj_snake.model_dump(by_alias=True)["surfaceId"] == "surf-snake"

    # 2. Construct using external camelCase alias keyword arguments
    obj_alias = CreateSurface(surfaceId="surf-alias", catalogId="cat-alias")
    assert obj_alias.surface_id == "surf-alias"
    assert obj_alias.catalog_id == "cat-alias"
    assert obj_alias.model_dump(by_alias=True)["surfaceId"] == "surf-alias"


@pytest.mark.parametrize(
    ("version", "schema_version"),
    [
        (ProtocolVersion.V0_9, "v0_9"),
        (ProtocolVersion.V0_9_1, "v0_9"),
        (ProtocolVersion.V1_0, "v1_0"),
    ],
)
def test_common_types_schema_follows_release_line(
    version: ProtocolVersion, schema_version: str
) -> None:
    """v0.9.1 uses the schema of its release line, v0.9."""
    schema = get_common_types_schema_map(version)
    assert schema["$id"] == (
        f"https://a2ui.org/specification/{schema_version}/common_types.json"
    )


def test_common_types_schema_rejects_unsupported_versions() -> None:
    with pytest.raises(A2uiCatalogError):
        get_common_types_schema_map(ProtocolVersion.V0_8)


@pytest.mark.parametrize(
    ("version", "expected_id"),
    [
        (ProtocolVersion.V0_8, None),
        (
            ProtocolVersion.V0_9,
            "https://a2ui.org/specification/v0_9/server_to_client.json",
        ),
        (
            ProtocolVersion.V0_9_1,
            "https://a2ui.org/specification/v0_9/server_to_client.json",
        ),
        (
            ProtocolVersion.V1_0,
            "https://a2ui.org/specification/v1_0/agent_to_renderer.json",
        ),
    ],
)
def test_agent_to_renderer_schema_follows_release_line(
    version: ProtocolVersion, expected_id: str | None
) -> None:
    schema = get_agent_to_renderer_schema_map(version)
    assert schema.get("$id") == expected_id


def test_catalog_schema_returns_independent_copies() -> None:
    catalog = Catalog(
        catalog_id="test",
        protocol_version="1.0",
        defs={"Wrapper": {"$ref": "#/$defs/DynamicString"}},
        common_types_defs={"DynamicString": {"type": "string"}},
    )
    schema = catalog.catalog_schema
    schema["$defs"]["DynamicString"]["type"] = "number"
    assert catalog.common_types_defs["DynamicString"] == {"type": "string"}
    assert catalog.catalog_schema["$defs"]["DynamicString"]["type"] == "string"


def test_catalog_schema_rejects_unparsable_versions() -> None:
    with pytest.raises(A2uiCatalogError):
        Catalog(catalog_id="test", protocol_version="latest").catalog_schema
