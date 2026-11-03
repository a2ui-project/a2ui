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

"""Unit tests for A2uiInboundPartConverter."""

from __future__ import annotations

from a2a import types as a2a_types
from google.genai import types as genai_types
import pytest

from a2ui.a2a import create_a2ui_part
from a2ui.adk import A2uiInboundPartConverter
from a2ui.core import A2uiValidationError
from a2ui.core.schema import ProtocolVersion


def test_converts_v1_0_action_part_to_genai_text_part() -> None:
    converter = A2uiInboundPartConverter()
    a2a_part = create_a2ui_part({
        "version": "1.0",
        "action": {
            "name": "submit_order",
            "surfaceId": "checkout-surface",
            "sourceComponentId": "submit-btn",
            "timestamp": "2026-03-31T12:00:00Z",
            "context": {"qty": 2, "item": "espresso"},
        },
    })

    result = converter(a2a_part)

    assert isinstance(result, genai_types.Part)
    assert result.text is not None
    assert "submit_order" in result.text
    assert "checkout-surface" in result.text
    assert "submit-btn" in result.text
    assert '"qty": 2' in result.text
    assert '"item": "espresso"' in result.text


def test_converts_v1_0_validation_error_part_to_genai_text_part() -> None:
    converter = A2uiInboundPartConverter()
    a2a_part = create_a2ui_part({
        "version": "1.0",
        "error": {
            "code": "VALIDATION_FAILED",
            "surfaceId": "checkout-surface",
            "path": "/components/0/text",
            "message": "Text value cannot be empty",
        },
    })

    result = converter.convert(a2a_part)

    assert isinstance(result, genai_types.Part)
    assert result.text is not None
    assert "VALIDATION_FAILED" in result.text
    assert "checkout-surface" in result.text
    assert "/components/0/text" in result.text
    assert "Text value cannot be empty" in result.text


def test_converts_v0_9_action_and_error_parts() -> None:
    converter = A2uiInboundPartConverter(version=ProtocolVersion.V0_9)
    action_part = create_a2ui_part(
        {
            "version": "v0.9",
            "action": {
                "name": "book_restaurant",
                "surfaceId": "booking-surface",
                "sourceComponentId": "book-btn",
                "timestamp": "2026-03-31T12:00:00Z",
                "context": {"guests": 4},
            },
        },
        version=ProtocolVersion.V0_9,
    )
    error_part = create_a2ui_part(
        {
            "version": "v0.9",
            "error": {
                "code": "VALIDATION_FAILED",
                "surfaceId": "booking-surface",
                "path": "/partySize",
                "message": "Party size must be at least 1",
            },
        },
        version=ProtocolVersion.V0_9,
    )

    action_result = converter(action_part)
    error_result = converter(error_part)

    assert isinstance(action_result, genai_types.Part)
    assert action_result.text is not None
    assert "book_restaurant" in action_result.text
    assert '"guests": 4' in action_result.text

    assert isinstance(error_result, genai_types.Part)
    assert error_result.text is not None
    assert "VALIDATION_FAILED" in error_result.text
    assert "/partySize" in error_result.text


def test_converts_v0_8_user_action_part() -> None:
    converter = A2uiInboundPartConverter()
    a2a_part = create_a2ui_part(
        {
            "userAction": {
                "name": "select_table",
                "surfaceId": "floor-map",
                "sourceComponentId": "table-7",
                "timestamp": "2026-03-31T12:00:00Z",
                "context": {"seats": 2},
            },
        },
        version=ProtocolVersion.V0_8,
    )

    result = converter(a2a_part)

    assert isinstance(result, genai_types.Part)
    assert result.text is not None
    assert "select_table" in result.text
    assert "floor-map" in result.text
    assert "table-7" in result.text
    assert '"seats": 2' in result.text


def test_returns_none_for_rpc_messages() -> None:
    converter = A2uiInboundPartConverter()
    call_part = create_a2ui_part({
        "version": "1.0",
        "callAgentFunction": {
            "functionCallId": "call-101",
            "surfaceId": "checkout-surface",
            "callFunction": {
                "@call": "fetchCustomerProfile",
                "args": {"customerId": "cust-42"},
            },
        },
    })
    response_part = create_a2ui_part({
        "version": "1.0",
        "rendererFunctionResponse": {
            "functionCallId": "call-102",
            "value": {"confirmed": True},
        },
    })

    assert converter(call_part) is None
    assert converter(response_part) is None


def test_delegates_non_a2ui_parts_to_default_adk_converter() -> None:
    converter = A2uiInboundPartConverter()
    text_part = a2a_types.Part(root=a2a_types.TextPart(text="Hello agent"))
    plain_data_part = a2a_types.Part(
        root=a2a_types.DataPart(data={"customKey": "customValue"})
    )

    text_result = converter(text_part)
    data_result = converter(plain_data_part)

    assert isinstance(text_result, genai_types.Part)
    assert text_result.text == "Hello agent"
    assert isinstance(data_result, genai_types.Part)


def test_raises_validation_error_on_invalid_a2ui_part() -> None:
    converter = A2uiInboundPartConverter(version=ProtocolVersion.V1_0)
    invalid_part = create_a2ui_part({"version": "1.0"})

    with pytest.raises(A2uiValidationError):
        converter(invalid_part)
