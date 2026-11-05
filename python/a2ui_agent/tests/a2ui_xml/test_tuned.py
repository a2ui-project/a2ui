# Copyright 2026 Google LLC
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

"""Unit tests for tuned A2UI XML (`tuned=True`, `A2uiXmlFormat`, `A2uiXmlFormatFactory`)."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiValidationError, Catalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats import (
    A2uiXmlFormat as TopA2uiXmlFormat,
    A2uiXmlFormatFactory as TopA2uiXmlFormatFactory,
    to_message_dicts,
)
from a2ui.inference_formats.a2ui_xml import (
    A2uiXmlCompiler,
    A2uiXmlFormat,
    A2uiXmlFormatFactory,
    A2uiXmlParseError,
    A2uiXmlParser,
    A2uiXmlPromptGenerator,
    A2uiXmlValidationError,
)
from a2ui.parser import A2uiPart

pytestmark = pytest.mark.filterwarnings("ignore:\\[EXPERIMENTAL\\]:UserWarning")


def _make_rich_catalog() -> Catalog:
    """Builds a synthetic v0.9 catalog exercising all tuned A2UI XML schema shapes."""
    schema = {
        "catalogId": "https://example.com/synthetic_ui_v0_9.json",
        "protocolVersion": "v0.9",
        "$defs": {
            "DateObj": {
                "oneOf": [
                    {
                        "type": "object",
                        "properties": {
                            "year": {"type": "integer"},
                            "month": {"type": "integer"},
                            "day": {"type": "integer"},
                        },
                        "required": ["year", "month", "day"],
                        "additionalProperties": False,
                    },
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DataBinding"
                        )
                    },
                ]
            },
            "TypedBadge": {
                "oneOf": [
                    {
                        "type": "object",
                        "properties": {
                            "kind": {
                                "type": "string",
                                "enum": ["info", "warn", "critical"],
                            },
                            "label": {"type": "string"},
                        },
                        "required": ["kind", "label"],
                        "additionalProperties": False,
                    },
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DataBinding"
                        )
                    },
                ]
            },
        },
        "components": {
            "VStack": {
                "type": "object",
                "description": "Arranges child widgets vertically.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "VStack"},
                            "children": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ChildList"
                                )
                            },
                            "cols": {"type": "integer"},
                            "rounded": {"type": "boolean"},
                        },
                        "required": ["component", "children"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "SymbolGlyph": {
                "type": "object",
                "description": "Displays a named vector icon glyph.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "SymbolGlyph"},
                            "icon": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString"
                                )
                            },
                        },
                        "required": ["component", "icon"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "RichLabel": {
                "type": "object",
                "description": "Renders formatted text content and headings.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "RichLabel"},
                            "text": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString"
                                )
                            },
                            "usageHint": {
                                "type": "string",
                                "enum": [
                                    "h1",
                                    "h2",
                                    "h3",
                                    "h4",
                                    "h5",
                                    "body1",
                                    "caption",
                                ],
                            },
                            "badge": {"$ref": "#/$defs/TypedBadge"},
                        },
                        "required": ["component", "text"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "ConsentToggle": {
                "type": "object",
                "description": "Boolean checkbox selection control.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/Checkable"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "ConsentToggle"},
                            "label": {"type": "string"},
                            "checked": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicBoolean"
                                )
                            },
                        },
                        "required": ["component"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "RuleSeparator": {
                "type": "object",
                "description": "Horizontal divider rule separating sections.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "RuleSeparator"},
                            "inset": {"type": "boolean"},
                        },
                        "required": ["component"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "ActionBtn": {
                "type": "object",
                "description": "Interactive action button.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "ActionBtn"},
                            "label": {"type": "string"},
                            "variant": {
                                "type": "string",
                                "enum": ["filled", "outlined"],
                            },
                            "action": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/Action"
                                )
                            },
                        },
                        "required": ["component"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "FilterPills": {
                "type": "object",
                "description": "Selectable pill chips.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "FilterPills"},
                            "options": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "value": {"type": "string"},
                                    },
                                    "required": ["label", "value"],
                                    "additionalProperties": False,
                                },
                            },
                            "tags": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicStringList"
                                )
                            },
                        },
                        "required": ["component", "options"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "AlertFeed": {
                "type": "object",
                "description": "Structured feed list.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "AlertFeed"},
                            "listItems": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "headline": {"type": "string"},
                                        "leading": {
                                            "type": "object",
                                            "properties": {
                                                "icon": {"type": "string"},
                                                "avatar": {"type": "string"},
                                            },
                                            "additionalProperties": False,
                                        },
                                        "trailing": {
                                            "type": "object",
                                            "properties": {
                                                "text": {"type": "string"},
                                                "icon": {"type": "string"},
                                            },
                                            "additionalProperties": False,
                                        },
                                    },
                                    "required": ["headline"],
                                    "additionalProperties": False,
                                },
                            },
                        },
                        "required": ["component", "listItems"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "PopupSheet": {
                "type": "object",
                "description": "Popup modal with trigger and content child slots.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "PopupSheet"},
                            "trigger": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentId"
                                )
                            },
                            "content": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentId"
                                )
                            },
                        },
                        "required": ["component", "trigger", "content"],
                    },
                ],
                "unevaluatedProperties": False,
            },
            "CalendarField": {
                "type": "object",
                "description": "Calendar date picker.",
                "allOf": [
                    {
                        "$ref": (
                            "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                        )
                    },
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "CalendarField"},
                            "value": {"$ref": "#/$defs/DateObj"},
                        },
                        "required": ["component"],
                    },
                ],
                "unevaluatedProperties": False,
            },
        },
        "functions": {
            "required": {
                "description": "Checks value is non-empty / truthy.",
                "returnType": "boolean",
                "properties": {
                    "call": {"const": "required"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "value": {
                                "$ref": (
                                    "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicValue"
                                )
                            }
                        },
                        "required": ["value"],
                    },
                },
            }
        },
    }
    return Catalog.from_json(schema, protocol_version=ProtocolVersion.V0_9)


def _extract_comps(parser: A2uiXmlParser, raw: str) -> dict[str, dict[str, object]]:
    parts = parser.parse_response(raw)
    comps: dict[str, dict[str, object]] = {}
    for p in parts:
        if isinstance(p, A2uiPart):
            for m in p.a2ui:
                d = m.model_dump(by_alias=True, exclude_none=True)
                if "updateComponents" in d:
                    for c in d["updateComponents"]["components"]:
                        comps[c["id"]] = c
    return comps


def test_tuned_flags_and_convenience_classes() -> None:
    cat = _make_rich_catalog()

    # Untuned explicit
    untuned_fmt = A2uiXmlFormat([cat], tuned=False)
    assert untuned_fmt.tuned is False
    assert untuned_fmt.prompt_generator.tuned is False
    untuned_parser = untuned_fmt.create_parser()
    assert untuned_parser.tuned is False
    assert untuned_parser.compiler.tuned is False

    untuned_factory = A2uiXmlFormatFactory(tuned=False)
    assert untuned_factory.tuned is False
    assert untuned_factory.create_format([cat]).tuned is False

    # Default tuned
    tuned_fmt = A2uiXmlFormat([cat])
    assert isinstance(tuned_fmt, A2uiXmlFormat)
    assert tuned_fmt.tuned is True
    assert tuned_fmt.prompt_generator.tuned is True
    tuned_parser = tuned_fmt.create_parser()
    assert tuned_parser.tuned is True
    assert tuned_parser.compiler.tuned is True

    tuned_factory = A2uiXmlFormatFactory()
    assert isinstance(tuned_factory, A2uiXmlFormatFactory)
    assert tuned_factory.tuned is True
    created = tuned_factory.bind([cat])
    assert isinstance(created, A2uiXmlFormat)
    assert created.tuned is True

    assert A2uiXmlCompiler([cat], tuned=True).tuned is True
    assert A2uiXmlPromptGenerator([cat], tuned=True).tuned is True


def test_jsx_braces_and_closing_tag_debris_healed_only_when_tuned() -> None:
    cat = _make_rich_catalog()
    markup = """<a2ui>
<VStack cols={2} rounded="{true}">
  <RichLabel text={"Quarterly Report"} usageHint={"h2"} />
  <FilterPills tags={["q1", "q2"]}>
    <Item label="Q1" value="q1" />
  </FilterPills>
</VStack" align="center">
</a2ui>"""

    untuned = A2uiXmlParser([cat], tuned=False)
    with pytest.raises(
        (A2uiXmlParseError, A2uiXmlValidationError, A2uiValidationError)
    ):
        untuned.parse_response(markup)

    tuned = A2uiXmlParser([cat], tuned=True)
    comps = _extract_comps(tuned, markup)
    assert comps["root"]["cols"] == 2
    assert comps["root"]["rounded"] is True
    assert comps["c1"]["text"] == "Quarterly Report"
    assert comps["c1"]["usageHint"] == "h2"
    assert comps["c2"]["tags"] == ["q1", "q2"]


def test_check_binds_non_value_dynamic_property_like_checked() -> None:
    cat = _make_rich_catalog()
    markup = """<a2ui>
```json dataModel
{"form": {"agreed": false}}
```
<ConsentToggle label="Accept Terms" checked="$/form/agreed">
  <Check call="required" message="Must accept terms" />
</ConsentToggle>
</a2ui>"""

    untuned = A2uiXmlParser([cat], tuned=False)
    with pytest.raises(A2uiValidationError):
        untuned.parse_response(markup)

    tuned = A2uiXmlParser([cat], tuned=True)
    comps = _extract_comps(tuned, markup)
    checks = comps["root"]["checks"]
    assert isinstance(checks, list)
    assert checks[0]["condition"]["args"]["value"] == {"path": "/form/agreed"}


def test_prose_divider_disambiguation_code_fences_and_leaf_body_text() -> None:
    cat = _make_rich_catalog()
    # SymbolGlyph appears before RichLabel, and ConsentToggle appears before RuleSeparator!
    markup = """<a2ui>
<VStack>
  Welcome heading

  ---

  ```yaml
  env: prod
  ```

  <ActionBtn onClick="save()">Save Changes</ActionBtn>
</VStack>
</a2ui>"""

    tuned = A2uiXmlParser([cat], tuned=True)
    comps = _extract_comps(tuned, markup)
    assert comps["c1"]["component"] == "RichLabel"
    assert comps["c1"]["text"] == "Welcome heading"
    assert comps["c2"]["component"] == "RuleSeparator"
    assert comps["c3"]["component"] == "RichLabel"
    assert "env: prod" in str(comps["c3"]["text"])
    assert comps["c4"]["component"] == "ActionBtn"
    assert comps["c4"]["label"] == "Save Changes"
    assert comps["c4"]["action"] == {"event": {"name": "save"}}


def test_morphological_subtags_singular_wrap_and_nested_item_objects() -> None:
    cat = _make_rich_catalog()
    markup = """<a2ui>
<VStack>
  <FilterPill value="active" />
  <FilterPills options="">
    <FilterPill value="p1">Priority 1</FilterPill>
    <FilterPill label="Priority 2" />
  </FilterPills>
  <AlertFeed>
    <AlertFeedItem leadingIcon="warning" trailing="Critical">SSH Open</AlertFeedItem>
    <Item headline="Stale Key">
      <SymbolGlyph slot="leading" icon="key" color="warn" />
      ```json trailing
      {"text": "90d", "unexpectedColor": "red"}
      ```
    </Item>
  </AlertFeed>
</VStack>
</a2ui>"""

    tuned = A2uiXmlParser([cat], tuned=True)
    comps = _extract_comps(tuned, markup)
    assert comps["c1"]["component"] == "FilterPills"
    assert comps["c1"]["options"] == [{"label": "active", "value": "active"}]
    assert comps["c2"]["options"] == [
        {"value": "p1", "label": "Priority 1"},
        {"label": "Priority 2", "value": "Priority 2"},
    ]
    assert comps["c3"]["listItems"] == [
        {
            "headline": "SSH Open",
            "leading": {"icon": "warning"},
            "trailing": {"text": "Critical"},
        },
        {
            "headline": "Stale Key",
            "leading": {"icon": "key"},
            "trailing": {"text": "90d"},
        },
    ]


def test_enum_clamping_optional_drop_unknown_attr_datamodel_and_wrappers() -> None:
    cat = _make_rich_catalog()
    markup = """<a2ui surface="main" dataModel='{"user": "Ada"}'>
<VStack unknownElevation="4" dataModel='{"compDm": true}'>
  ```json dataModel
  {"extra": 42}
  ```
  <RichLabel text="Subhead" usageHint="h6" badge="Urgent" />
  <ActionBtn label="Go" variant="glassmorphic" />
  <CalendarField value="2026-10-15" />
  <PopupSheet>
    <Child slot="trigger">
      <ActionBtn label="Open" />
    </Child>
    <Child slot="content">
      <RichLabel text="Body" />
    </Child>
  </PopupSheet>
</VStack>
</a2ui>"""

    untuned = A2uiXmlParser([cat], tuned=False)
    with pytest.raises((A2uiXmlParseError, A2uiXmlValidationError)):
        untuned.parse_response(markup)

    tuned = A2uiXmlParser([cat], tuned=True)
    parts = tuned.parse_response(markup)
    comps = _extract_comps(tuned, markup)
    assert comps["c1"]["usageHint"] == "h5"
    assert comps["c1"]["badge"] == {"kind": "info", "label": "Urgent"}
    assert "variant" not in comps["c2"]
    assert comps["c3"]["value"] == {"year": 2026, "month": 10, "day": 15}
    assert comps["c4"]["component"] == "PopupSheet"

    # Verify lifted + inline dataModel merged into updateDataModel
    dm_msgs = [
        m.model_dump(by_alias=True, exclude_none=True)["updateDataModel"]
        for pt in parts
        if isinstance(pt, A2uiPart)
        for m in pt.a2ui
        if "updateDataModel" in m.model_dump(by_alias=True, exclude_none=True)
    ]
    assert dm_msgs
    assert dm_msgs[-1]["value"] == {"user": "Ada", "compDm": True, "extra": 42}


def test_tuned_streaming_matches_one_shot_parse() -> None:
    cat = _make_rich_catalog()
    markup = """Intro text.
<a2ui>
<VStack cols={2}>
  ```json dataModel
  {"ok": true}
  ```
  <AlertFeed>
    <Item headline="Item 1">
      <SymbolGlyph slot="leading" icon="bolt" />
    </Item>
  </AlertFeed>
  <RichLabel text="Heading" usageHint="h6" />
</VStack>
</a2ui>"""

    tuned = A2uiXmlParser([cat], tuned=True)
    one_shot = _extract_comps(tuned, markup)

    stream = tuned.open_stream()
    streamed_comps: dict[str, dict[str, object]] = {}
    for ch_idx in range(0, len(markup), 17):
        for part in stream.feed(markup[ch_idx : ch_idx + 17]):
            if isinstance(part, A2uiPart):
                for msg in to_message_dicts(part.a2ui):
                    if "updateComponents" in msg:
                        for c in msg["updateComponents"]["components"]:
                            streamed_comps[c["id"]] = c
    for part in stream.close():
        if isinstance(part, A2uiPart):
            for msg in to_message_dicts(part.a2ui):
                if "updateComponents" in msg:
                    for c in msg["updateComponents"]["components"]:
                        streamed_comps[c["id"]] = c
    assert "main" in stream.state.surface_ids
    assert streamed_comps == one_shot


def test_public_barrel_reexports() -> None:
    assert TopA2uiXmlFormat is A2uiXmlFormat
    assert TopA2uiXmlFormatFactory is A2uiXmlFormatFactory


def test_tuned_prompt_generator_depth3_item_schema_and_micro_anchor() -> None:
    cat = _make_rich_catalog()
    untuned_prompt = A2uiXmlPromptGenerator([cat], tuned=False).generate()
    tuned_prompt = A2uiXmlPromptGenerator([cat], tuned=True).generate()

    assert "## Syntax Quick-Check" not in untuned_prompt
    assert "## Syntax Quick-Check" in tuned_prompt
    # Depth-3 expansion shows `leading?: {icon?: string, avatar?: string}` instead of opaque `object`
    assert "leading?: {icon?: string, avatar?: string}" in tuned_prompt
    assert "{year: integer, month: integer, day: integer}" in tuned_prompt
