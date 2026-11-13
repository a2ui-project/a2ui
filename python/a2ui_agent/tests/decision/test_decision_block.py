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

"""Unit tests for DecisionBlock and DecisionPromptGenerator."""

from __future__ import annotations

import json
from typing import Any

import pytest

from a2ui.core import Catalog
from a2ui.inference_formats.decision import (
    DECISION_RULES,
    ActionSpec,
    ActionStyle,
    ArchetypeGrammar,
    DecisionBlock,
    DecisionPromptGenerator,
    LayoutBrief,
    decision_block_from_messages,
    decision_rules,
)
from a2ui.parser.messages import to_message_models

CATALOG_ID = "https://example.com/catalogs/ops/v1/catalog.json"

EXPECTED_SURFACE_ID_TEXT = (
    "The surface to render into. A new id creates a surface. Reusing an id"
    " updates that surface in place: the new layout replaces the old one, and"
    " parts that did not change keep their state. To change only one part,"
    " also set `region` to that part's role from the `layout` roles (for"
    ' example `"actions"`); only that part is replaced. To start the surface'
    ' over, also set `"replace": true`; the old surface is deleted and a new'
    " one is created."
)


def _make_catalog() -> Catalog:
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": CATALOG_ID,
        "protocolVersion": "1.0",
        "components": {
            "TelemetryBadge": {
                "type": "object",
                "description": "Read-only telemetry badge.",
                "properties": {
                    "component": {"const": "TelemetryBadge"},
                    "serviceName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "latencyMs": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                },
                "required": ["component", "serviceName", "latencyMs"],
            },
        },
        "functions": {},
    }
    return Catalog.from_json(schema)


def test_decision_block_minimal_defaults_and_aliases() -> None:
    block = DecisionBlock.from_mapping({
        "intent": "  Show service health  ",
        "data": json.dumps({"serviceName": "checkout", "latencyMs": 42}),
        "surface_id": "  ",
        "fallback_dsl": "",
        "title": "   ",
        "summary": "",
    })
    assert block.intent == "Show service health"
    assert block.payload == {"serviceName": "checkout", "latencyMs": 42}
    assert block.surface_id is None
    assert block.fallback_dsl is None
    assert block.layout == ()
    assert block.mutable_paths == ()
    assert block.title is None
    assert block.summary is None
    assert block.actions == ()
    assert block.exclude == ()
    assert block.replace is False
    assert block.region is None
    assert block.labels == {}

    assert block.to_json() == {
        "intent": "Show service health",
        "payload": {"serviceName": "checkout", "latencyMs": 42},
    }
    assert block.to_synthesis_kwargs() == {
        "actions": (),
        "exclude": (),
        "mutable_paths": (),
        "fallback_dsl": None,
        "layout": None,
        "title": None,
        "summary": None,
        "labels": None,
        "region": None,
    }
    assert block.to_synthesis_kwargs(default_surface_id="main")["surface_id"] == "main"


def test_decision_block_full_round_trip_every_field() -> None:
    raw: dict[str, Any] = {
        "intent": "Review and submit the transfer",
        "payload": {
            "recipient": "Alex",
            "amount": 125.0,
            "memo": "Lunch",
            "items": [{"itemId": "i1", "name": "Split"}],
            "internalToken": "secret-xyz",
        },
        "surfaceId": "transfer_surface",
        "fallbackDsl": "root = TelemetryBadge($/recipient, $/amount)",
        "layout": ["headline:recipient,amount", "form:/memo"],
        "mutablePaths": ["memo", "/amount"],
        "title": "Confirm transfer",
        "summary": "Check the details before sending.",
        "actions": {
            "send_transfer": {
                "label": "Send money",
                "context": {"recipient": "/recipient", "amount": "/amount"},
                "style": "primary",
            },
            "remove_item": {
                "label": "Remove",
                "scope": "/items",
                "key": "itemId",
                "style": "destructive",
            },
            "cancel": "Cancel",
        },
        "exclude": ["/internalToken", "/items/0/secret"],
        "replace": False,
        "region": "headline",
        "labels": {"/recipient": "Recipient name", "/amount": "Amount (USD)"},
        "template": "ignored_legacy_field",
    }
    block = DecisionBlock.from_mapping(raw)

    assert block.intent == "Review and submit the transfer"
    assert block.surface_id == "transfer_surface"
    assert block.fallback_dsl == "root = TelemetryBadge($/recipient, $/amount)"
    assert block.layout == ("headline:recipient,amount", "form:/memo")
    assert block.mutable_paths == ("/memo", "/amount")
    assert block.title == "Confirm transfer"
    assert block.summary == "Check the details before sending."
    assert block.exclude == ("/internalToken", "/items/0/secret")
    assert block.replace is False
    assert block.region == "headline"
    assert block.labels == {
        "/recipient": "Recipient name",
        "/amount": "Amount (USD)",
    }
    assert block.actions == (
        ActionSpec(
            id="send_transfer",
            label="Send money",
            context={"recipient": "/recipient", "amount": "/amount"},
            style=ActionStyle.PRIMARY,
        ),
        ActionSpec(
            id="remove_item",
            label="Remove",
            scope="/items",
            key="itemId",
            style=ActionStyle.DESTRUCTIVE,
        ),
        ActionSpec(id="cancel", label="Cancel"),
    )

    serialized = block.to_json()
    assert "template" not in serialized
    assert serialized == {
        "intent": "Review and submit the transfer",
        "payload": raw["payload"],
        "surfaceId": "transfer_surface",
        "fallbackDsl": "root = TelemetryBadge($/recipient, $/amount)",
        "layout": ["headline:recipient,amount", "form:/memo"],
        "mutablePaths": ["/memo", "/amount"],
        "title": "Confirm transfer",
        "summary": "Check the details before sending.",
        "actions": {
            "send_transfer": {
                "label": "Send money",
                "context": {"recipient": "/recipient", "amount": "/amount"},
                "style": "primary",
            },
            "remove_item": {
                "label": "Remove",
                "scope": "/items",
                "key": "itemId",
                "style": "destructive",
            },
            "cancel": "Cancel",
        },
        "exclude": ["/internalToken", "/items/0/secret"],
        "region": "headline",
        "labels": {"/recipient": "Recipient name", "/amount": "Amount (USD)"},
    }

    round_tripped = DecisionBlock.from_mapping(serialized)
    assert round_tripped == block

    replace_block = DecisionBlock.from_mapping({
        "intent": "Review and submit the transfer",
        "payload": raw["payload"],
        "surfaceId": "transfer_surface",
        "replace": True,
    })
    assert replace_block.replace is True
    assert replace_block.to_json()["replace"] is True
    assert DecisionBlock.from_mapping(replace_block.to_json()) == replace_block

    kwargs = block.to_synthesis_kwargs(default_surface_id="default_main")
    assert kwargs == {
        "actions": block.actions,
        "exclude": block.exclude,
        "mutable_paths": block.mutable_paths,
        "fallback_dsl": block.fallback_dsl,
        "layout": block.layout,
        "title": block.title,
        "summary": block.summary,
        "labels": {"/recipient": "Recipient name", "/amount": "Amount (USD)"},
        "region": "headline",
        "surface_id": "transfer_surface",
    }
    assert "replace" not in kwargs


def test_decision_block_preserves_action_order_and_accepts_layout_brief() -> None:
    brief = LayoutBrief.parse(["picture:name"], roles=frozenset({"picture"}))
    block = DecisionBlock.from_mapping({
        "intent": "Manage items",
        "payload": [{"id": "1", "name": "First"}],
        "layout": brief,
        "actions": {
            "zeta": "Zeta action",
            "alpha": {"label": "Alpha action", "style": "secondary"},
            "middle": {"label": "Middle action", "scope": "/items"},
            "omega": "Omega action",
        },
    })
    assert block.layout == ("picture:/name",)
    assert [a.id for a in block.actions] == ["zeta", "alpha", "middle", "omega"]
    serialized_actions = block.to_json()["actions"]
    assert list(serialized_actions.keys()) == ["zeta", "alpha", "middle", "omega"]
    assert serialized_actions["zeta"] == "Zeta action"
    assert serialized_actions["alpha"] == {
        "label": "Alpha action",
        "style": "secondary",
    }
    assert serialized_actions["middle"] == {
        "label": "Middle action",
        "scope": "/items",
    }
    assert serialized_actions["omega"] == "Omega action"


@pytest.mark.parametrize(
    ("raw", "exc_type", "pattern"),
    [
        (["not", "an", "object"], TypeError, "Mapping"),
        ({"payload": {}}, ValueError, "intent"),
        ({"intent": "   ", "payload": {}}, ValueError, "intent"),
        ({"intent": 123, "payload": {}}, ValueError, "intent"),
        ({"intent": "Show"}, TypeError, "payload"),
        ({"intent": "Show", "payload": "{bad json"}, ValueError, "not valid JSON"),
        ({"intent": "Show", "payload": '"scalar"'}, TypeError, "JSON string"),
        ({"intent": "Show", "payload": 42}, TypeError, "Payload"),
        ({"intent": "Show", "payload": {}, "surfaceId": 99}, TypeError, "surfaceId"),
        (
            {"intent": "Show", "payload": {}, "fallbackDsl": ["x"]},
            TypeError,
            "fallbackDsl",
        ),
        ({"intent": "Show", "payload": {}, "title": 1}, TypeError, "title"),
        ({"intent": "Show", "payload": {}, "summary": False}, TypeError, "summary"),
        (
            {"intent": "Show", "payload": {}, "layout": "headline:a"},
            TypeError,
            "layout",
        ),
        ({"intent": "Show", "payload": {}, "layout": [123]}, TypeError, "layout"),
        (
            {"intent": "Show", "payload": {}, "mutablePaths": "/email"},
            TypeError,
            "mutablePaths",
        ),
        (
            {"intent": "Show", "payload": {}, "mutablePaths": [123]},
            TypeError,
            "mutablePaths",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": ["Sign In"]},
            TypeError,
            "actions",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": "sign_in"},
            TypeError,
            "actions",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": {123: "Sign In"}},
            TypeError,
            "string action ids",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": {"": "Sign In"}},
            ValueError,
            "non-empty",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": {"   ": "Sign In"}},
            ValueError,
            "non-empty",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": {"go": ""}},
            ValueError,
            "label",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": {"go": {"scope": "/items"}}},
            ValueError,
            "label",
        ),
        (
            {"intent": "Show", "payload": {}, "actions": {"go": 42}},
            ValueError,
            "label string or an options object",
        ),
        (
            {
                "intent": "Show",
                "payload": {},
                "actions": {"go": {"label": "Go", "unknown": True}},
            },
            ValueError,
            "unknown option keys",
        ),
        (
            {
                "intent": "Show",
                "payload": {},
                "actions": {"go": {"label": "Go", "scope": "items"}},
            },
            ValueError,
            "JSON Pointer",
        ),
        (
            {
                "intent": "Show",
                "payload": {},
                "actions": {"go": {"label": "Go", "key": ""}},
            },
            ValueError,
            "key must be a non-empty string",
        ),
        (
            {
                "intent": "Show",
                "payload": {},
                "actions": {"go": {"label": "Go", "key": 123}},
            },
            ValueError,
            "key must be a non-empty string",
        ),
        (
            {
                "intent": "Show",
                "payload": {},
                "actions": {"go": {"label": "Go", "context": ["bad"]}},
            },
            ValueError,
            "context must be an object",
        ),
        (
            {
                "intent": "Show",
                "payload": {},
                "actions": {"go": {"label": "Go", "context": {"id": "not_ptr"}}},
            },
            ValueError,
            "JSON Pointer",
        ),
        (
            {
                "intent": "Show",
                "payload": {},
                "actions": {"go": {"label": "Go", "style": "flashy"}},
            },
            ValueError,
            "style must be one of",
        ),
        (
            {"intent": "Show", "payload": {}, "exclude": "/secret"},
            TypeError,
            "exclude",
        ),
        (
            {"intent": "Show", "payload": {}, "exclude": [123]},
            TypeError,
            "exclude",
        ),
        (
            {"intent": "Show", "payload": {}, "exclude": ["secret"]},
            ValueError,
            "JSON Pointers starting with '/'",
        ),
        (
            {"intent": "Show", "payload": {}, "exclude": [""]},
            ValueError,
            "JSON Pointers starting with '/'",
        ),
        (
            {"intent": "Show", "payload": {}, "exclude": ["/"]},
            ValueError,
            "JSON Pointers starting with '/'",
        ),
        (
            {"intent": "Show", "payload": {}, "replace": "true"},
            TypeError,
            "replace",
        ),
        (
            {"intent": "Show", "payload": {}, "replace": 1},
            TypeError,
            "replace",
        ),
        (
            {"intent": "Show", "payload": {}, "region": 123},
            TypeError,
            "region",
        ),
        (
            {"intent": "Show", "payload": {}, "region": ""},
            ValueError,
            "region",
        ),
        (
            {"intent": "Show", "payload": {}, "region": "   "},
            ValueError,
            "region",
        ),
        (
            {
                "intent": "x",
                "payload": {"a": 1},
                "replace": True,
                "region": "facts",
            },
            ValueError,
            "DecisionBlock cannot combine replace=True with a region update",
        ),
        (
            {"intent": "Show", "payload": {}, "labels": ["bad"]},
            TypeError,
            "labels",
        ),
        (
            {"intent": "Show", "payload": {}, "labels": {123: "CPU"}},
            TypeError,
            "labels",
        ),
        (
            {"intent": "Show", "payload": {}, "labels": {"cpu": "CPU"}},
            ValueError,
            "JSON Pointers starting with '/'",
        ),
        (
            {"intent": "Show", "payload": {}, "labels": {"/": "Root"}},
            ValueError,
            "JSON Pointers starting with '/'",
        ),
        (
            {"intent": "Show", "payload": {}, "labels": {"/cpu": 123}},
            TypeError,
            "labels",
        ),
        (
            {"intent": "Show", "payload": {}, "labels": {"/cpu": "   "}},
            ValueError,
            "non-empty",
        ),
    ],
)
def test_decision_block_rejects_invalid_inputs(
    raw: Any, exc_type: type[Exception], pattern: str
) -> None:
    with pytest.raises(exc_type, match=pattern):
        DecisionBlock.from_mapping(raw)


def test_decision_block_rejects_replace_with_region() -> None:
    with pytest.raises(
        ValueError,
        match="DecisionBlock cannot combine replace=True with a region update",
    ):
        DecisionBlock(
            intent="x",
            payload={"a": 1},
            replace=True,
            region="facts",
        )
    with pytest.raises(
        ValueError,
        match="DecisionBlock cannot combine replace=True with a region update",
    ):
        DecisionBlock.from_mapping({
            "intent": "x",
            "payload": {"a": 1},
            "replace": True,
            "region": "facts",
        })


def test_decision_block_from_messages_reconstructs_surface_and_payload() -> None:
    messages = to_message_models([
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": CATALOG_ID},
        },
        {
            "version": "1.0",
            "updateDataModel": {
                "surfaceId": "s1",
                "value": {"serviceName": "checkout", "latencyMs": 42},
            },
        },
    ])
    recovered = decision_block_from_messages(messages)
    assert recovered == DecisionBlock(
        intent="Render s1",
        payload={"serviceName": "checkout", "latencyMs": 42},
        surface_id="s1",
    )
    custom_intent = decision_block_from_messages(
        messages, default_intent="Custom intent"
    )
    assert custom_intent.intent == "Custom intent"
    assert decision_block_from_messages([]) == DecisionBlock(
        intent="Render surface", payload={}, surface_id=None
    )


def test_prompt_generator_contains_new_surface_id_rules_and_no_template() -> None:
    catalog = _make_catalog()
    gen = DecisionPromptGenerator([catalog])
    prompt = gen.generate()

    assert isinstance(DECISION_RULES, str)
    assert EXPECTED_SURFACE_ID_TEXT in DECISION_RULES
    assert EXPECTED_SURFACE_ID_TEXT in prompt
    assert "`region`" in prompt
    assert "`replace`" in prompt
    assert "`actions`" in prompt
    assert '{"sign_in": "Sign In"' in prompt
    assert '"scope"' in prompt and '"context"' in prompt and '"style"' in prompt
    assert "`exclude`" in prompt
    assert "`mutablePaths`" in prompt
    assert "`labels`" in prompt
    assert "forms and settings must list their editable pointers" in prompt

    # Old payload actions instruction and template section are removed.
    assert '"actions": ["Sign In"]' not in prompt
    assert "array of button labels" not in prompt
    assert "`template`" not in prompt
    assert "Registered Templates" not in prompt
    assert "badge_tpl" not in prompt

    for role in ArchetypeGrammar.default().brief_roles():
        assert f"`{role}`" in decision_rules(ArchetypeGrammar.default())
    assert "- TelemetryBadge" in prompt
    assert gen.generate_catalog_instructions(include_schema=False) == ""
    assert gen.generate_examples() == ""


def test_prompt_generator_renders_native_decision_block_examples_only() -> None:
    catalog = _make_catalog()
    example_one = DecisionBlock.from_mapping({
        "intent": "Sign in to your account",
        "payload": {"email": "alex@example.com", "password": "", "secret": "tok"},
        "surfaceId": "auth",
        "mutablePaths": ["/email", "/password"],
        "actions": {"sign_in": {"label": "Sign In", "style": "primary"}},
        "exclude": ["/secret"],
    })
    example_two = DecisionBlock.from_mapping({
        "intent": "Reset the dashboard surface",
        "payload": {"serviceName": "checkout", "latencyMs": 19},
        "surfaceId": "main",
        "replace": True,
    })

    gen = DecisionPromptGenerator([catalog], block_examples=[example_one, example_two])
    assert gen.block_examples == [example_one, example_two]
    rendered = gen.generate_examples()
    assert rendered.count("<a2ui>") == 2
    assert '"sign_in"' in rendered
    assert '"/secret"' in rendered
    assert '"replace": true' in rendered
    assert rendered in gen.generate()

    positional = DecisionPromptGenerator([catalog], [example_one])
    assert positional.block_examples == [example_one]
    wrapped = positional.generate_examples()
    body = wrapped.removeprefix("<a2ui>\n").removesuffix("\n</a2ui>")
    assert DecisionBlock.from_mapping(json.loads(body)) == example_one

    with pytest.raises(TypeError, match="DecisionBlock"):
        DecisionPromptGenerator(
            [catalog],
            block_examples=[{"intent": "x", "payload": {}}],  # type: ignore[list-item]
        )
    with pytest.raises(TypeError, match="sequence"):
        DecisionPromptGenerator(
            [catalog],
            block_examples="not-a-sequence",  # type: ignore[arg-type]
        )
