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

"""Validation of calls to `agentOnly` functions held in components (v1.0).

A call held in a component (a property binding, a check or an action) is made
by the renderer, which may not call an `agentOnly` function.
"""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.core import (
    A2uiValidationError,
    Catalog,
    MessageProcessor,
    MessageProcessorOptions,
    PayloadValidator,
    STRICT_VALIDATION,
)
from a2ui.core.basic_catalog import BasicCatalog

_ARCANA_ID = "https://example.com/arcana.json"
_AGENT_ONLY = (
    r"Function 'getMoonPhase' cannot be called by renderer \(allowedCallers is"
    r" agentOnly\)"
)


def _function(name: str, allowed_callers: str) -> dict[str, Any]:
    return {
        "type": "object",
        "allowedCallers": allowed_callers,
        "properties": {
            "@call": {"const": name},
            "args": {
                "type": "object",
                "properties": {"date": {"type": "string"}},
                "additionalProperties": False,
            },
            "returnType": {"const": "string"},
        },
        "required": ["@call"],
    }


def _arcana() -> Any:
    """A catalog with a Label and Button, and an agentOnly function."""
    return Catalog.from_json({
        "catalogId": _ARCANA_ID,
        "protocolVersion": "1.0",
        "components": {
            "Label": {
                "type": "object",
                "properties": {
                    "component": {"const": "Label"},
                    "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "text"],
            },
            "Button": {
                "type": "object",
                "properties": {
                    "component": {"const": "Button"},
                    "action": {"$ref": "common_types.json#/$defs/Action"},
                    "checks": {
                        "type": "array",
                        "items": {"$ref": "common_types.json#/$defs/CheckRule"},
                    },
                },
                "required": ["component"],
            },
        },
        "functions": {
            "getMoonPhase": _function("getMoonPhase", "agentOnly"),
            "getTide": _function("getTide", "rendererOrAgent"),
        },
    })


def _validate(component: dict[str, Any]) -> None:
    PayloadValidator(_arcana(), config=STRICT_VALIDATION).validate_component(component)


def test_agent_only_function_in_a_property_binding_is_rejected():
    with pytest.raises(A2uiValidationError, match=_AGENT_ONLY) as e:
        _validate({
            "id": "root",
            "component": "Label",
            "text": {"@call": "getMoonPhase", "args": {}},
        })
    assert e.value.details[0].path == "components.root.text"
    assert e.value.details[0].code == "invalid_function_call"


def test_agent_only_function_in_an_action_is_rejected():
    with pytest.raises(A2uiValidationError, match=_AGENT_ONLY) as e:
        _validate({
            "id": "root",
            "component": "Button",
            "action": {"functionCall": {"@call": "getMoonPhase"}},
        })
    assert e.value.details[0].path == "components.root.action.functionCall"


def test_agent_only_function_in_a_check_is_rejected():
    with pytest.raises(A2uiValidationError, match=_AGENT_ONLY):
        _validate({
            "id": "root",
            "component": "Button",
            "checks": [{
                "condition": {"@call": "getMoonPhase"},
                "message": "Too dark",
            }],
        })


def test_agent_only_function_nested_in_another_call_is_rejected():
    with pytest.raises(A2uiValidationError, match=_AGENT_ONLY):
        _validate({
            "id": "root",
            "component": "Label",
            "text": {
                "@call": "getTide",
                "args": {"date": {"@call": "getMoonPhase"}},
            },
        })


def test_renderer_or_agent_function_in_a_binding_is_accepted():
    _validate({
        "id": "root",
        "component": "Label",
        "text": {"@call": "getTide", "args": {"date": "today"}},
    })


def _processor() -> MessageProcessor:
    return MessageProcessor(
        [BasicCatalog("1.0"), _arcana()],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )


def _create(*components: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": "1.0",
        "createSurface": {
            "surfaceId": "s",
            "catalogId": BasicCatalog("1.0").catalog_id,
            "components": list(components),
        },
    }


def test_agent_only_function_of_another_catalog_in_a_binding_is_rejected():
    with pytest.raises(A2uiValidationError, match=_AGENT_ONLY) as e:
        _processor().process_messages([
            _create({
                "id": "root",
                "component": "Text",
                "text": {"@call": "getMoonPhase", "catalogId": _ARCANA_ID},
            })
        ])
    assert e.value.details[0].path == "components.root.text"


def test_agent_only_function_of_another_catalog_in_an_action_is_rejected():
    with pytest.raises(A2uiValidationError, match=_AGENT_ONLY):
        _processor().process_messages([
            _create(
                {
                    "id": "root",
                    "component": "Button",
                    "child": "label",
                    "action": {
                        "functionCall": {
                            "@call": "getMoonPhase",
                            "catalogId": _ARCANA_ID,
                        }
                    },
                },
                {"id": "label", "component": "Text", "text": "Go"},
            )
        ])


def test_renderer_or_agent_function_of_another_catalog_is_accepted():
    _processor().process_messages([
        _create({
            "id": "root",
            "component": "Text",
            "text": {"@call": "getTide", "catalogId": _ARCANA_ID},
        })
    ])
