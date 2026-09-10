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

"""Unit tests for format_pydantic_error utilities."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, ValidationError
import pytest

from a2ui.core.processing.format_pydantic_error import (
    _clean_loc_part,
    format_pydantic_issue,
    format_pydantic_message,
    format_validation_error,
    format_validation_error_summary,
    map_pydantic_error_code,
)


class StrictSample(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    age: int
    role: Literal["admin", "user"] = "user"


class ActionA(BaseModel):
    model_config = ConfigDict(extra="forbid")
    surfaceId: str


class ActionB(BaseModel):
    model_config = ConfigDict(extra="forbid")
    surfaceId: str
    count: int


class Envelope(BaseModel):
    messages: list[ActionA | ActionB]


def test_clean_loc_part():
    """Tests unwrapping validator wrapper strings."""
    assert (
        _clean_loc_part("function-after[CreateSurfaceMessage]")
        == "CreateSurfaceMessage"
    )
    assert (
        _clean_loc_part("function-before[UpdateComponentsMessage]")
        == "UpdateComponentsMessage"
    )
    assert _clean_loc_part("surfaceId") == "surfaceId"
    assert _clean_loc_part("0") == "0"


def test_map_pydantic_error_code():
    """Tests mapping Pydantic error types to canonical A2UI codes."""
    assert map_pydantic_error_code("missing") == "missing_field"
    assert map_pydantic_error_code("extra_forbidden") == "extra_field"
    assert map_pydantic_error_code("string_type") == "type_mismatch"
    assert map_pydantic_error_code("int_parsing") == "type_mismatch"
    assert map_pydantic_error_code("type_error") == "type_mismatch"
    assert map_pydantic_error_code("literal_error") == "invalid_value"
    assert map_pydantic_error_code("value_error") == "invalid_value"


def test_format_pydantic_message_and_issue():
    """Tests message and issue formatting for various error types."""
    # Extra forbidden
    err_extra = {
        "type": "extra_forbidden",
        "loc": ("user", "unknown_field"),
        "ctx": {"extra": "unknown_field"},
    }
    assert "unrecognized key(s) in object: 'unknown_field'" in format_pydantic_message(
        err_extra
    )
    assert format_pydantic_issue(err_extra) == (
        "user.unknown_field: Additional properties are not allowed: unrecognized key(s)"
        " in object: 'unknown_field' (extra inputs are not permitted)"
    )

    # Missing field
    err_missing = {
        "type": "missing",
        "loc": ("name",),
        "msg": "Field required",
    }
    assert format_pydantic_message(err_missing) == "Field required"
    assert format_pydantic_issue(err_missing) == "name: Field required"
    assert (
        format_pydantic_message(
            err_missing, path_str="name", match_jsonschema_missing=True
        )
        == "'name' is a required property"
    )

    # Literal / enum mismatch
    err_literal = {
        "type": "literal_error",
        "loc": ("role",),
        "input": "superadmin",
        "ctx": {"expected": "'admin' or 'user'"},
    }
    assert format_pydantic_issue(err_literal) == (
        "role: Invalid enum value. Expected 'admin' or 'user', received 'superadmin'"
    )

    # Type mismatch
    err_type_mismatch = {
        "type": "string_type",
        "loc": ("label",),
        "input": 123,
        "msg": "Input should be a valid string",
    }
    assert format_pydantic_message(err_type_mismatch) == (
        "Expected string, received number (input should be a valid string)"
    )
    assert format_pydantic_issue(err_type_mismatch) == (
        "label: Expected string, received number (input should be a valid string)"
    )


def test_format_validation_error_with_model():
    """Tests formatting a real Pydantic ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        StrictSample.model_validate({"age": "not_an_int", "extra_prop": 123})

    details = format_validation_error(exc_info.value)
    codes = {d.code for d in details}
    assert "missing_field" in codes
    assert "extra_field" in codes
    assert "type_mismatch" in codes

    # allow_unknown_extra filters extra_field
    details_filtered = format_validation_error(exc_info.value, allow_unknown_extra=True)
    assert not any(d.code == "extra_field" for d in details_filtered)


def test_format_validation_error_union_pruning():
    """Tests pruning of irrelevant union branches when valid_actions are supplied."""
    payload = {"messages": [{"surfaceId": "s1", "actionA": {}, "invalid": 123}]}
    with pytest.raises(ValidationError) as exc_info:
        Envelope.model_validate(payload)

    # Without union filtering, multiple union branches report errors
    all_details = format_validation_error(exc_info.value)
    assert len(all_details) > 0

    # With union filtering for actionA, only ActionAMessage errors are retained
    filtered_details = format_validation_error(
        exc_info.value,
        messages=[{"actionA": {}}],
        valid_actions={"actionA", "actionB"},
    )
    assert len(filtered_details) > 0


def test_format_validation_error_summary():
    """Tests joining error diagnostics into a summary string."""
    with pytest.raises(ValidationError) as exc_info:
        StrictSample.model_validate({})

    summary = format_validation_error_summary(exc_info.value)
    assert isinstance(summary, str)
    assert "name" in summary
    assert "age" in summary


def test_format_validation_error_strip_messages_prefix():
    """Tests stripping artificial messages.<index> prefix from error paths."""
    payload = {"messages": [{"surfaceId": 123}]}
    with pytest.raises(ValidationError) as exc_info:
        Envelope.model_validate(payload)

    details = format_validation_error(
        exc_info.value,
        messages=[{"actionA": {}}],
        valid_actions={"actionA", "actionB"},
        strip_messages_prefix=True,
    )
    assert len(details) > 0
    for d in details:
        assert not d.path.startswith("messages.")
        assert d.path == "surfaceId"
