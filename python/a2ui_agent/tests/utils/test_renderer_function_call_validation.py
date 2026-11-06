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

"""Checks of v1.0 `callRendererFunction` messages by the agent's validators."""

from typing import Any

import pytest

from a2ui.core import A2uiValidationError, Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import FunctionImplementation
from a2ui.utils import RendererState, validate_payload

_BASIC = BasicCatalog("1.0")
_CUSTOM_ID = "https://example.com/arcana.json"
_CUSTOM = Catalog.from_json({
    "catalogId": _CUSTOM_ID,
    "protocolVersion": "1.0",
    "components": {
        "Dummy": {
            "type": "object",
            "properties": {"component": {"const": "Dummy"}},
            "required": ["component"],
        }
    },
    "functions": {
        "getMoonPhase": {
            "type": "object",
            "allowedCallers": "agentOnly",
            "returnType": "string",
            "properties": {
                "@call": {"const": "getMoonPhase"},
                "args": {
                    "type": "object",
                    "properties": {"date": {"type": "string"}},
                    "additionalProperties": False,
                },
            },
            "required": ["@call"],
        },
        "echo": {
            "type": "object",
            "allowedCallers": "rendererOrAgent",
            "returnType": "any",
            "properties": {
                "@call": {"const": "echo"},
                "args": {"type": "object"},
            },
            "required": ["@call"],
        },
        "describe": {
            "type": "object",
            "allowedCallers": "rendererOrAgent",
            "returnType": "string",
            "properties": {
                "@call": {"const": "describe"},
                "args": {
                    "type": "object",
                    "properties": {
                        "text": {"$ref": "common_types.json#/$defs/DynamicString"}
                    },
                    "additionalProperties": False,
                },
            },
            "required": ["@call"],
        },
        "scrollTo": {
            "type": "object",
            "allowedCallers": "rendererOrAgent",
            "returnType": "void",
            "properties": {
                "@call": {"const": "scrollTo"},
                "args": {
                    "type": "object",
                    "properties": {"id": {"type": "string"}},
                    "required": ["id"],
                    "additionalProperties": False,
                },
            },
            "required": ["@call"],
        },
    },
})
_CATALOGS = [_BASIC, _CUSTOM]


def _call(
    name: str,
    catalog_id: str = _CUSTOM_ID,
    args: dict[str, Any] | None = None,
    surface_id: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "functionCallId": "f1",
        "callFunction": {"@call": name, "catalogId": catalog_id, "args": args or {}},
    }
    if surface_id is not None:
        body["surfaceId"] = surface_id
    return {"version": "1.0", "callRendererFunction": body}


def _create(surface_id: str = "s") -> dict[str, Any]:
    return {
        "version": "1.0",
        "createSurface": {"surfaceId": surface_id, "catalogId": _BASIC.catalog_id},
    }


def _delete(surface_id: str = "s") -> dict[str, Any]:
    return {"version": "1.0", "deleteSurface": {"surfaceId": surface_id}}


def _recording_catalog(
    calls: list[dict[str, Any]],
    *,
    allowed_callers: Any = "rendererOrAgent",
    requires_user_activation: bool = False,
) -> CatalogApi:
    """A catalog whose `record` function appends its args to `calls`."""

    def record(args: dict[str, Any], *_: Any) -> None:
        calls.append(args)

    return Catalog(
        catalog_id="https://example.com/recording.json",
        protocol_version="1.0",
        functions=[
            FunctionImplementation(
                name="record",
                return_type="void",
                schema={
                    "type": "object",
                    "properties": {"note": {"type": "string"}},
                    "additionalProperties": False,
                },
                execute=record,
                allowed_callers=allowed_callers,
                requires_user_activation=requires_user_activation,
            )
        ],
    )


@pytest.mark.parametrize(
    "message",
    [
        _call("scrollTo", args={"id": "x"}),
        _call("getMoonPhase", args={"date": "2026-11-05"}),
        _call("getMoonPhase"),
    ],
    ids=["rendererOrAgent", "agentOnly", "agentOnly_without_args"],
)
def test_call_the_agent_may_make_is_accepted(message):
    validate_payload(_CATALOGS, [message])


@pytest.mark.parametrize(
    ("message", "match"),
    [
        (
            _call("summonDragon", catalog_id=_BASIC.catalog_id),
            "names 'summonDragon', which catalog .* does not declare",
        ),
        (
            _call("getMoonPhase", args={"date": 42}),
            "does not match the arguments of 'getMoonPhase'.*not of type 'string'",
        ),
        (
            _call("getMoonPhase", args={"date": "d", "bogus": 1}),
            "does not match the arguments of 'getMoonPhase'.*'bogus' was unexpected",
        ),
        (
            _call("scrollTo"),
            "does not match the arguments of 'scrollTo'.*'id' is a required",
        ),
        (
            _call("formatString", catalog_id=_BASIC.catalog_id, args={"value": "hi"}),
            r"names 'formatString', which only the renderer may call"
            r" \(allowedCallers is"
            r" rendererOnly\)",
        ),
        (
            _call(
                "openUrl",
                catalog_id=_BASIC.catalog_id,
                args={"url": "https://example.com"},
            ),
            "names 'openUrl', which only the renderer may call",
        ),
        (
            _call("getMoonPhase", catalog_id="https://nope.example/catalog.json"),
            (
                "catalog 'https://nope.example/catalog.json', which isn't one of the"
                " active catalogs"
            ),
        ),
        (
            _call("@index", catalog_id=_CUSTOM_ID),
            "names '@index', which catalog .* does not declare",
        ),
    ],
    ids=[
        "unknown_function",
        "wrong_arg_type",
        "extra_arg",
        "missing_required_arg",
        "renderer_only",
        "requires_user_activation_basic",
        "unregistered_catalog",
        "system_function",
    ],
)
def test_call_the_renderer_would_refuse_is_rejected(message, match):
    with pytest.raises(A2uiValidationError, match=match):
        validate_payload(_CATALOGS, [message])


def test_call_without_a_catalog_id_is_rejected():
    message = _call("scrollTo", args={"id": "x"})
    del message["callRendererFunction"]["callFunction"]["catalogId"]
    with pytest.raises(A2uiValidationError, match="catalogId"):
        validate_payload(_CATALOGS, [message])


def test_function_that_requires_user_activation_is_rejected():
    catalog = _recording_catalog([], requires_user_activation=True)
    with pytest.raises(
        A2uiValidationError,
        match=(
            "names 'record', which requires a user activation, and a call from"
            " the agent has none"
        ),
    ):
        validate_payload([catalog], [_call("record", catalog_id=catalog.catalog_id)])


def test_function_with_no_allowed_callers_is_renderer_only():
    catalog = _recording_catalog([], allowed_callers=None)
    with pytest.raises(A2uiValidationError, match=r"allowedCallers is rendererOnly"):
        validate_payload([catalog], [_call("record", catalog_id=catalog.catalog_id)])


def test_arguments_are_checked_as_written():
    with pytest.raises(A2uiValidationError, match="not of type 'string'"):
        validate_payload(
            _CATALOGS, [_call("getMoonPhase", args={"date": {"@path": "/date"}})]
        )


@pytest.mark.parametrize(
    "text",
    [
        {"@path": "/name"},
        {"@call": "scrollTo", "args": {"id": "x"}},
        {
            "@call": "formatString",
            "catalogId": _BASIC.catalog_id,
            "args": {"value": "hi"},
        },
    ],
    ids=["data_binding", "call", "call_to_another_catalog"],
)
def test_argument_the_renderer_resolves_is_accepted(text):
    validate_payload(_CATALOGS, [_call("describe", args={"text": text})])


def test_argument_schema_checks_the_calls_it_admits():
    with pytest.raises(
        A2uiValidationError, match="Unrecognized function 'summonDragon'"
    ):
        validate_payload(
            _CATALOGS, [_call("describe", args={"text": {"@call": "summonDragon"}})]
        )


@pytest.mark.parametrize(
    "value",
    [
        {"@call": "scrollTo", "args": {"id": "x"}},
        {
            "@call": "formatString",
            "catalogId": _BASIC.catalog_id,
            "args": {"value": "hi"},
        },
        [{"@call": "@index"}],
    ],
    ids=["same_catalog", "another_catalog", "system_function_in_a_list"],
)
def test_call_nested_in_untyped_arguments_is_accepted(value):
    validate_payload(_CATALOGS, [_call("echo", args={"value": value})])


@pytest.mark.parametrize(
    ("text", "match"),
    [
        ({"@call": "summonDragon"}, "Unrecognized function 'summonDragon'"),
        (
            {"@call": "scrollTo", "args": {}},
            (
                "holds a call to 'scrollTo' that does not match the arguments of"
                " 'scrollTo'"
            ),
        ),
        (
            {"@call": "getMoonPhase"},
            r"holds a call to 'getMoonPhase' that the renderer can't make: Function"
            r" 'getMoonPhase' cannot be called by renderer \(allowedCallers is"
            r" agentOnly\)",
        ),
        (
            {"@call": "formatString", "catalogId": "https://nope.example/c.json"},
            (
                "names catalog 'https://nope.example/c.json', which isn't one of the"
                " active catalogs"
            ),
        ),
        (
            {"@call": "@index", "catalogId": _CUSTOM_ID},
            "system functions belong to no catalog",
        ),
        ({"@call": "@nope"}, "holds a call to '@nope' that is invalid"),
    ],
    ids=[
        "unknown_function",
        "bad_args",
        "agent_only",
        "unregistered_catalog",
        "system_function_with_catalog",
        "unknown_system_function",
    ],
)
def test_call_nested_in_the_arguments_is_checked(text, match):
    with pytest.raises(A2uiValidationError, match=match):
        validate_payload(_CATALOGS, [_call("echo", args={"value": text})])


@pytest.mark.parametrize(
    ("value", "match"),
    [
        (
            {"@call": {"@call": "getMoonPhase"}},
            r"holds a call to 'getMoonPhase' that the renderer can't make: Function"
            r" 'getMoonPhase' cannot be called by renderer \(allowedCallers is"
            r" agentOnly\)",
        ),
        (
            {"@call": [{"@call": "getMoonPhase"}]},
            "holds a call to 'getMoonPhase' that the renderer can't make",
        ),
    ],
    ids=["in_an_object", "in_a_list"],
)
def test_call_under_a_non_string_call_key_is_checked(value, match):
    with pytest.raises(A2uiValidationError, match=match):
        validate_payload(_CATALOGS, [_call("echo", args={"value": value})])


@pytest.mark.parametrize(
    ("value", "match"),
    [
        ({"@bogus": 1}, "Unrecognized reserved protocol directive '@bogus'"),
        (
            {"inner": {"@calls": "getMoonPhase"}},
            "Unrecognized reserved protocol directive '@calls'",
        ),
        (
            {"@call": "scrollTo", "args": {"id": "x"}, "bogus": 1},
            "holds a call to 'scrollTo' with unrecognized field 'bogus'",
        ),
        (
            {"@call": "scrollTo", "catalogId": None, "args": {"id": "x"}},
            "holds a call to 'scrollTo' whose 'catalogId' must be a string",
        ),
        (
            {"@call": "scrollTo", "catalogId": 7, "args": {"id": "x"}},
            "holds a call to 'scrollTo' whose 'catalogId' must be a string",
        ),
        (
            {"@call": "getMoonPhase", "catalogId": _CUSTOM_ID, "args": None},
            "holds a call to 'getMoonPhase' whose 'args' must be an object",
        ),
        (
            {"@call": "scrollTo", "args": ["x"]},
            "holds a call to 'scrollTo' whose 'args' must be an object",
        ),
        (
            {"@call": "@index", "args": None},
            "holds a call to '@index' whose 'args' must be an object",
        ),
    ],
    ids=[
        "unknown_directive",
        "misspelled_call_directive",
        "extra_call_field",
        "null_catalog_id",
        "non_string_catalog_id",
        "null_args",
        "list_args",
        "system_function_null_args",
    ],
)
def test_argument_the_renderer_cant_resolve_is_rejected(value, match):
    with pytest.raises(A2uiValidationError, match=match):
        validate_payload(_CATALOGS, [_call("echo", args={"value": value})])


def test_nested_call_that_requires_user_activation_is_rejected():
    value = {
        "@call": "openUrl",
        "catalogId": _BASIC.catalog_id,
        "args": {"url": "https://example.com"},
    }
    with pytest.raises(
        A2uiValidationError,
        match=(
            "holds a call to 'openUrl' that the renderer can't make: Function"
            " 'openUrl' requires a user activation, and a call from the agent has"
            " none"
        ),
    ):
        validate_payload(_CATALOGS, [_call("echo", args={"value": value})])


_CATALOGLESS_FORMAT = {"@call": "formatString", "args": {"value": "hi"}}


def test_nested_call_without_a_catalog_runs_in_the_call_catalog():
    with pytest.raises(
        A2uiValidationError, match="Unrecognized function 'formatString'"
    ):
        validate_payload(
            _CATALOGS, [_call("echo", args={"label": _CATALOGLESS_FORMAT})]
        )


def test_nested_call_without_a_catalog_runs_in_the_surface_default_catalog():
    validate_payload(
        _CATALOGS,
        [
            _create(),
            _call("echo", args={"label": _CATALOGLESS_FORMAT}, surface_id="s"),
        ],
    )
    with pytest.raises(A2uiValidationError, match="Unrecognized function 'scrollTo'"):
        validate_payload(
            _CATALOGS,
            [
                _create(),
                _call(
                    "echo",
                    args={"to": {"@call": "scrollTo", "args": {"id": "x"}}},
                    surface_id="s",
                ),
            ],
        )


def test_renderer_state_runs_nested_calls_in_the_surface_default_catalog():
    state = RendererState(_CATALOGS)
    state.apply([_create()])
    state.apply([_call("echo", args={"label": _CATALOGLESS_FORMAT}, surface_id="s")])


def test_nested_call_without_a_catalog_on_a_surface_without_one_is_rejected():
    payload = [
        {"version": "1.0", "createSurface": {"surfaceId": "s"}},
        _call("echo", args={"label": _CATALOGLESS_FORMAT}, surface_id="s"),
    ]
    with pytest.raises(
        A2uiValidationError,
        match=(
            "Function call 'f1' holds a call to 'formatString' without a catalogId,"
            " and surface 's' has no default catalog"
        ),
    ):
        validate_payload(_CATALOGS, payload)


def test_nested_call_on_a_surface_of_a_known_catalog_runs_in_it():
    message = _call("echo", args={"label": _CATALOGLESS_FORMAT}, surface_id="s")
    validate_payload(_CATALOGS, [message], surface_catalog_ids={"s": _BASIC.catalog_id})
    with pytest.raises(
        A2uiValidationError, match="Unrecognized function 'formatString'"
    ):
        validate_payload(_CATALOGS, [message], surface_catalog_ids={"s": _CUSTOM_ID})


@pytest.mark.parametrize(
    "value",
    [_CATALOGLESS_FORMAT, {"@call": "scrollTo", "args": {"id": "x"}}],
    ids=["basic_function", "custom_function"],
)
def test_nested_call_on_an_assumed_surface_may_run_in_any_catalog(value):
    validate_payload(_CATALOGS, [_call("echo", args={"value": value}, surface_id="s")])


@pytest.mark.parametrize(
    ("value", "match"),
    [
        ({"@call": "summonDragon"}, "Unrecognized function 'summonDragon'"),
        (
            {"@call": "getMoonPhase"},
            r"cannot be called by renderer \(allowedCallers is agentOnly\)",
        ),
        (
            {"@call": "openUrl", "args": {"url": "https://example.com"}},
            "requires a user activation",
        ),
        (
            {"@call": "scrollTo", "args": {}},
            "holds a call to 'scrollTo' that does not match the arguments",
        ),
    ],
    ids=["undeclared", "agent_only", "requires_user_activation", "bad_args"],
)
def test_nested_call_on_an_assumed_surface_is_still_checked(value, match):
    with pytest.raises(A2uiValidationError, match=match):
        validate_payload(
            _CATALOGS, [_call("echo", args={"value": value}, surface_id="s")]
        )


@pytest.mark.parametrize(
    ("call_function", "match"),
    [
        ({"@call": 1, "catalogId": _CUSTOM_ID}, "@call"),
        (
            {"@call": "scrollTo", "catalogId": _CUSTOM_ID, "args": {}, "bogus": 1},
            "bogus",
        ),
        ({"@call": "getMoonPhase", "catalogId": _CUSTOM_ID, "args": None}, "args"),
        ({"@call": "getMoonPhase", "catalogId": _CUSTOM_ID, "args": []}, "args"),
        ({"@call": "getMoonPhase", "catalogId": None}, "catalogId"),
        (
            {
                "@call": "echo",
                "catalogId": _CUSTOM_ID,
                "args": {"v": {"@path": "a/~3"}},
            },
            "Invalid path syntax",
        ),
    ],
    ids=[
        "non_string_call",
        "extra_field",
        "null_args",
        "list_args",
        "null_catalog_id",
        "bad_path",
    ],
)
def test_call_envelope_the_renderer_would_refuse_is_rejected(call_function, match):
    message = {
        "version": "1.0",
        "callRendererFunction": {"functionCallId": "f1", "callFunction": call_function},
    }
    with pytest.raises(A2uiValidationError, match=match):
        validate_payload(_CATALOGS, [message])


def test_deeply_nested_arguments_are_rejected():
    value: Any = 1
    for _ in range(60):
        value = {"a": value}
    with pytest.raises(A2uiValidationError, match="recursion limit"):
        validate_payload(_CATALOGS, [_call("echo", args={"value": value})])


def test_validation_does_not_run_the_function():
    calls: list[dict[str, Any]] = []
    catalog = _recording_catalog(calls)
    message = _call("record", catalog_id=catalog.catalog_id, args={"note": "hi"})

    validate_payload([catalog], [message])
    state = RendererState([catalog])
    state.apply([message])

    assert calls == []


def test_rejected_call_does_not_run_the_function():
    calls: list[dict[str, Any]] = []
    catalog = _recording_catalog(calls, allowed_callers="rendererOnly")
    message = _call("record", catalog_id=catalog.catalog_id, args={"note": "hi"})

    with pytest.raises(A2uiValidationError):
        validate_payload([catalog], [message])

    assert calls == []


def test_call_on_a_surface_the_payload_never_named_is_accepted():
    validate_payload(_CATALOGS, [_call("scrollTo", args={"id": "x"}, surface_id="s")])


def test_call_on_a_surface_the_payload_created_is_accepted():
    validate_payload(
        _CATALOGS, [_create(), _call("scrollTo", args={"id": "x"}, surface_id="s")]
    )


def test_call_on_a_surface_the_payload_deleted_is_rejected():
    with pytest.raises(
        A2uiValidationError, match="names surface 's', which does not exist"
    ):
        validate_payload(
            _CATALOGS,
            [_create(), _delete(), _call("scrollTo", args={"id": "x"}, surface_id="s")],
        )


def test_call_before_the_payload_creates_its_surface_is_rejected():
    with pytest.raises(
        A2uiValidationError, match="names surface 's', which does not exist"
    ):
        validate_payload(
            _CATALOGS, [_call("scrollTo", args={"id": "x"}, surface_id="s"), _create()]
        )


def test_renderer_state_checks_the_call():
    state = RendererState(_CATALOGS)
    with pytest.raises(A2uiValidationError, match="only the renderer may call"):
        state.apply(
            [_call("formatString", catalog_id=_BASIC.catalog_id, args={"value": "x"})]
        )
    assert state.apply([_call("scrollTo", args={"id": "x"})]) == []


def test_renderer_state_requires_the_surface_to_exist():
    state = RendererState(_CATALOGS)
    message = _call("scrollTo", args={"id": "x"}, surface_id="s")
    with pytest.raises(
        A2uiValidationError, match="names surface 's', which does not exist"
    ):
        state.apply([message])

    state.apply([_create()])
    state.apply([message])


def test_rejected_call_rolls_back_the_messages_before_it():
    state = RendererState(_CATALOGS)
    with pytest.raises(A2uiValidationError, match="does not declare"):
        state.apply([_create(), _call("summonDragon")])
    assert state.surface_ids == []


def test_agent_only_function_bound_into_a_component_is_rejected():
    payload = [{
        "version": "1.0",
        "createSurface": {
            "surfaceId": "s",
            "catalogId": _BASIC.catalog_id,
            "components": [{
                "id": "root",
                "component": "Text",
                "text": {"@call": "getMoonPhase", "catalogId": _CUSTOM_ID, "args": {}},
            }],
        },
    }]
    with pytest.raises(
        A2uiValidationError,
        match=r"Function 'getMoonPhase' cannot be called by renderer \(allowedCallers"
        r" is agentOnly\)",
    ):
        validate_payload(_CATALOGS, payload)
