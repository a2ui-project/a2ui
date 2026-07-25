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

import pytest
from pydantic import ValidationError
from typing import get_args

from a2ui.core.schema import (
    A2uiClientMessageListWrapper,
    A2uiClientActionMessage,
    A2uiClientErrorMessage,
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
    msg = A2uiClientErrorMessage.model_validate(valid_error)
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
    msg = A2uiClientErrorMessage.model_validate(valid_error)
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
