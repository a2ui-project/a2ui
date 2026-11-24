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

from types import SimpleNamespace
from typing import Any, get_args
from unittest.mock import MagicMock

from pydantic import ValidationError
import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiValidationError as A2uiValidationException,
    Catalog,
    MessageProcessor,
    MessageProcessorOptions,
    NodeResolver,
    PayloadValidator,
    ValidationConfig,
    get_agent_to_renderer_schema_map,
    get_common_types_schema_map,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import (
    A2uiClientActionMessage,
    A2uiClientDataModel,
    A2uiClientMessageListWrapper,
    A2uiGenericError,
    A2uiMessage,
    A2uiRendererErrorMessage,
    A2uiValidationError,
    DeleteSurfaceMessage,
    ProtocolVersion,
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
    schema = catalog.validation_schema
    schema["$defs"]["DynamicString"]["type"] = "number"
    assert catalog.common_types_defs["DynamicString"] == {"type": "string"}
    assert catalog.validation_schema["$defs"]["DynamicString"]["type"] == "string"


def test_catalog_schema_rejects_unparsable_versions() -> None:
    with pytest.raises(A2uiCatalogError):
        Catalog(catalog_id="test", protocol_version="latest").validation_schema


@pytest.mark.parametrize("version", ["0.9", "1.0"])
def test_validation_avoids_copying_catalog_validation_schema(
    monkeypatch: pytest.MonkeyPatch, version: str
) -> None:
    base_doc = BasicCatalog(version).to_json()
    catalog = Catalog.from_json(base_doc, protocol_version=version)
    baseline_schema = catalog.validation_schema

    texts = [
        {"id": f"t{i}", "component": "Text", "text": f"Item {i}"} for i in range(6)
    ]
    fn_expr = (
        {"@call": "formatString", "args": {"value": "Hello"}}
        if version == "1.0"
        else {
            "call": "formatString",
            "args": {"value": "Hello"},
            "returnType": "string",
        }
    )
    components: list[dict[str, Any]] = [
        {"id": "root", "component": "Card", "child": "col"},
        {
            "id": "col",
            "component": "Column",
            "children": ["dyn", "custom", *(t["id"] for t in texts)],
        },
        {"id": "dyn", "component": "Text", "text": fn_expr},
        {"id": "custom", "component": "UnknownWidget", "label": "ok"},
        *texts,
    ]
    surface_payload: dict[str, Any] = {
        "surfaceId": "s1",
        "catalogId": catalog.catalog_id,
    }
    if version != "1.0":
        surface_payload["theme"] = {"primaryColor": "#112233"}
    msgs: list[dict[str, Any]] = (
        [{
            "version": "1.0",
            "createSurface": {**surface_payload, "components": components},
        }]
        if version == "1.0"
        else [
            {"version": "v0.9", "createSurface": surface_payload},
            {
                "version": "v0.9",
                "updateComponents": {"surfaceId": "s1", "components": components},
            },
        ]
    )

    original_prop = Catalog.validation_schema
    copy_reads = 0

    def counting_validation_schema(self: Catalog) -> dict[str, Any]:
        nonlocal copy_reads
        copy_reads += 1
        assert original_prop.fget is not None
        return original_prop.fget(self)

    with monkeypatch.context() as m:
        m.setattr(Catalog, "validation_schema", property(counting_validation_schema))
        processor = MessageProcessor(
            [catalog],
            options=MessageProcessorOptions(
                validation_config=ValidationConfig(allow_unknown_elements=True)
            ),
        )
        processor.process_messages(msgs)
        PayloadValidator(catalog).validate_theme({"primaryColor": "#112233"})
        surface = processor.model.get_surface("s1")
        assert surface is not None
        resolver = NodeResolver(surface, catalog)
        assert resolver.root is not None
        resolver.dispose()

    assert copy_reads == 0
    assert catalog.validation_schema == baseline_schema


def test_payload_validator_honors_validation_schema_overrides() -> None:
    custom_schema: dict[str, Any] = {
        "$defs": {},
        "components": {
            "Badge": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "Badge"},
                    "count": {"type": "integer"},
                },
                "required": ["id", "component", "count"],
                "additionalProperties": False,
            }
        },
        "functions": {},
    }

    class SubclassCatalog(Catalog):

        @property
        def validation_schema(self) -> dict[str, Any]:
            return custom_schema

    sub_cat = SubclassCatalog(
        catalog_id="https://example.com/sub.json", protocol_version="1.0"
    )
    mock_cat = MagicMock(spec=Catalog)
    mock_cat.catalog_id = "https://example.com/mock.json"
    mock_cat.protocol_version = "1.0"
    mock_cat.get_component.return_value = None
    mock_cat.validation_schema = custom_schema

    duck_cat = SimpleNamespace(
        catalog_id="https://example.com/duck.json",
        protocol_version="1.0",
        validation_schema=custom_schema,
    )

    for cat in (sub_cat, mock_cat, duck_cat):
        validator = PayloadValidator(cat)
        validator.validate_component({"id": "b1", "component": "Badge", "count": 3})
        with pytest.raises(A2uiValidationException):
            validator.validate_component(
                {"id": "b1", "component": "Badge", "count": "three"}
            )
