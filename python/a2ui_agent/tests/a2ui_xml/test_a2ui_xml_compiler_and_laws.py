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

"""Unit tests for A2UI XML Six-Laws validation, lenient recovery, and A2UI features."""

from __future__ import annotations

import pytest

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats import (
    A2uiXmlCompiler,
    A2uiXmlFormat,
    A2uiXmlFormatFactory,
    A2uiXmlParser,
    to_message_dicts,
)
from a2ui.inference_formats.a2ui_xml import (
    A2uiXmlParseError,
    A2uiXmlValidationError,
)
from a2ui.parser import A2uiPart, RawA2uiPart, TextPart

pytestmark = pytest.mark.filterwarnings("ignore:\\[EXPERIMENTAL\\]:UserWarning")


class TestA2uiXmlSixLawsStrictVsLenient:
    """Verifies strict Six-Laws enforcement vs. lenient compiler recovery."""

    @pytest.fixture
    def catalog_v10(self) -> BasicCatalog:
        return BasicCatalog("1.0")

    def test_valid_strict_a2ui_xml_has_zero_violations(self, catalog_v10):
        compiler = A2uiXmlCompiler([catalog_v10], strict=True)
        source = """```json dataModel
{
  "form": {"rep": "Ada", "amount": "2500"}
}
```
<Card>
  <Column>
    <TextField label="Representative" value="$/form/rep" />
    <TextField label="Amount" value="$/form/amount" variant="number">
      <Check call="required" message="Amount is required." />
    </TextField>
    <Button variant="primary" action="save_deal">
      <Text text="Save Deal" />
    </Button>
  </Column>
</Card>"""
        diag = compiler.compile_with_diagnostics(source)
        assert diag.strict_valid is True
        assert diag.lenient_valid is True
        assert diag.strict_violations == ()

        msgs = to_message_dicts(diag.messages)
        assert len(msgs) == 1
        cs = msgs[0]["createSurface"]
        assert cs["surfaceId"] == "main"
        assert cs["dataModel"] == {"form": {"rep": "Ada", "amount": "2500"}}
        comps = {c["id"]: c for c in cs["components"]}
        assert comps["root"]["component"] == "Card"

    def test_single_quotes_and_bare_booleans_fail_strict_but_recover_lenient(
        self, catalog_v10
    ):
        source = """<DateTimeInput value='$/dt' enableDate enableTime="TRUE" />"""
        compiler = A2uiXmlCompiler([catalog_v10])

        # Strict mode rejects Law 5 violations
        with pytest.raises(A2uiXmlParseError):
            compiler.compile(source, strict=True)

        # Lenient mode recovers and records violations
        diag = compiler.compile_with_diagnostics(source, strict=False)
        assert diag.strict_valid is False
        assert diag.lenient_valid is True
        laws = {v.law for v in diag.strict_violations}
        assert "law5_double_quotes" in laws
        assert "law5_bool_case" not in laws  # attribute coercion uses schema

        comp = to_message_dicts(diag.messages)[0]["createSurface"]["components"][0]
        assert comp["id"] == "root"
        assert comp["value"] == {"@path": "/dt"}
        assert comp["enableDate"] is True
        assert comp["enableTime"] is True

    def test_inline_verticality_and_unclosed_tags_recover_in_lenient_mode(
        self, catalog_v10
    ):
        # Multiple tags on one line + unclosed <Column> at EOF
        source = '<Column><Text text="Line 1" /><Text text="Line 2" />'
        compiler = A2uiXmlCompiler([catalog_v10])

        with pytest.raises(A2uiXmlParseError):
            compiler.compile(source, strict=True)

        diag = compiler.compile_with_diagnostics(source, strict=False)
        assert diag.strict_valid is False
        laws = {v.law for v in diag.strict_violations}
        assert "law2_verticality" in laws
        assert "unclosed_tag" in laws

        comps = to_message_dicts(diag.messages)[0]["createSurface"]["components"]
        assert comps[0]["id"] == "root"
        assert comps[0]["component"] == "Column"
        assert len(comps[0]["children"]) == 2

    def test_single_child_container_with_multiple_children_auto_wraps_leniently(
        self, catalog_v10
    ):
        # Card only accepts single `child`, not multiple children
        source = """<Card>
  <Text text="Header" />
  <Text text="Body" />
</Card>"""
        compiler = A2uiXmlCompiler([catalog_v10])

        with pytest.raises(A2uiXmlValidationError):
            compiler.compile(source, strict=True)

        diag = compiler.compile_with_diagnostics(source, strict=False)
        assert diag.strict_valid is False
        assert any(v.law == "single_child_auto_wrap" for v in diag.strict_violations)
        comps = {
            c["id"]: c
            for c in to_message_dicts(diag.messages)[0]["createSurface"]["components"]
        }
        assert comps["root"]["component"] == "Card"
        wrapper_id = comps["root"]["child"]
        assert comps[wrapper_id]["component"] == "Column"
        assert len(comps[wrapper_id]["children"]) == 2

    def test_kebab_ui_prefix_and_non_ascii_tag_suffix_recovery(self, catalog_v10):
        source = '<ui-text✨ text="Recovered" />'
        compiler = A2uiXmlCompiler([catalog_v10])

        with pytest.raises(A2uiXmlParseError):
            compiler.compile(source, strict=True)

        diag = compiler.compile_with_diagnostics(source, strict=False)
        assert diag.strict_valid is False
        comp = to_message_dicts(diag.messages)[0]["createSurface"]["components"][0]
        assert comp["component"] == "Text"
        assert comp["text"] == "Recovered"

    def test_implicit_multi_root_synthesis(self, catalog_v10):
        source = """<Text text="First" />
---
<Text text="Second" />"""
        msgs = to_message_dicts(A2uiXmlCompiler([catalog_v10]).compile(source))
        comps = {c["id"]: c for c in msgs[0]["createSurface"]["components"]}
        assert comps["root"]["component"] == "Column"
        assert len(comps["root"]["children"]) == 3
        mid_id = comps["root"]["children"][1]
        assert comps[mid_id]["component"] == "Divider"


class TestA2uiXmlCatalogAgnosticAndProtocolFeatures:
    """Verifies 100% catalog-agnostic behavior, bindings, actions, checks, and versions."""

    def test_completely_custom_catalog_with_zero_basic_component_names(self):
        """Proves zero reliance on hardcoded 'Text', 'Column', 'Card', etc."""
        custom_cat = Catalog.from_json(
            {
                "catalogId": "https://acme.example/custom/v1",
                "components": {
                    "StackBox": {
                        "description": "Arranges items vertically.",
                        "properties": {
                            "component": {"const": "StackBox"},
                            "entries": {"$ref": "common_types.json#/$defs/ChildList"},
                        },
                        "required": ["component", "entries"],
                    },
                    "SplitView": {
                        "properties": {
                            "component": {"const": "SplitView"},
                            "leftPane": {"$ref": "common_types.json#/$defs/Child"},
                            "rightPane": {"$ref": "common_types.json#/$defs/Child"},
                        },
                        "required": ["component", "leftPane", "rightPane"],
                    },
                    "Glyph": {
                        "properties": {
                            "component": {"const": "Glyph"},
                            "caption": {
                                "$ref": "common_types.json#/$defs/DynamicString"
                            },
                            "count": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                        },
                        "required": ["component", "caption"],
                    },
                    "TriggerPad": {
                        "properties": {
                            "component": {"const": "TriggerPad"},
                            "onActivate": {"$ref": "common_types.json#/$defs/Action"},
                        },
                        "required": ["component", "onActivate"],
                    },
                },
                "functions": {
                    "doubleNum": {
                        "returnType": "number",
                        "properties": {
                            "@call": {"const": "doubleNum"},
                            "args": {
                                "type": "object",
                                "properties": {"x": {"type": "number"}},
                                "required": ["x"],
                            },
                        },
                        "required": ["@call", "args"],
                    }
                },
            },
            protocol_version=ProtocolVersion.V1_0,
        )

        fmt = A2uiXmlFormatFactory().bind([custom_cat])
        prompt = fmt.prompt_generator.generate()
        assert "<StackBox>" in prompt
        assert "<SplitView>" in prompt
        assert "$doubleNum(" in prompt

        parser = fmt.create_parser()
        parts = parser.parse_response("""Lead-in text.
<a2ui surface="custom_surf">
<SplitView>
  <Glyph slot="leftPane" caption="Items" count="$doubleNum(21)" />
  <TriggerPad slot="rightPane" onActivate="launch_now" />
</SplitView>
</a2ui>""")
        assert isinstance(parts[0], TextPart)
        assert parts[0].text == "Lead-in text."
        assert isinstance(parts[1], A2uiPart)
        cs = to_message_dicts(parts[1].a2ui)[0]["createSurface"]
        assert cs["surfaceId"] == "custom_surf"
        comps = {c["id"]: c for c in cs["components"]}
        assert comps["root"]["component"] == "SplitView"
        left = comps[comps["root"]["leftPane"]]
        assert left["count"] == {"@call": "doubleNum", "args": {"x": 21}}
        right = comps[comps["root"]["rightPane"]]
        assert right["onActivate"] == {"event": {"name": "launch_now"}}

        # Decompile and recompile strictly
        decompiled = parser.decompile(parts[1].a2ui)
        recompiled = A2uiXmlCompiler([custom_cat], strict=True).compile(decompiled)
        assert (
            to_message_dicts(recompiled)[0]["createSurface"]["surfaceId"]
            == "custom_surf"
        )

    def test_currency_strings_vs_data_bindings_and_escaped_dollar(self):
        cat = BasicCatalog("1.0")
        compiler = A2uiXmlCompiler([cat], strict=True)
        source = """<Column>
  <Text text="$49.99 USD" />
  <Text text="\\$/literal/path" />
  <Text text="$/bound/path" />
  <List template="$/items">
    <Column>
      <Text text="$itemTitle" />
      <Text text="$" />
    </Column>
  </List>
</Column>"""
        msgs = to_message_dicts(compiler.compile(source))
        comps = {c["id"]: c for c in msgs[0]["createSurface"]["components"]}
        children = [comps[cid] for cid in comps["root"]["children"]]
        assert children[0]["text"] == "$49.99 USD"
        assert children[1]["text"] == "$/literal/path"
        assert children[2]["text"] == {"@path": "/bound/path"}
        assert children[3]["children"]["path"] == "/items"
        tmpl_col = comps[children[3]["children"]["componentId"]]
        tmpl_kids = [comps[cid] for cid in tmpl_col["children"]]
        assert tmpl_kids[0]["text"] == {"@path": "itemTitle"}
        assert tmpl_kids[1]["text"] == {"@path": ""}

    def test_static_property_rejects_data_binding(self):
        cat = BasicCatalog("1.0")
        compiler = A2uiXmlCompiler([cat])
        with pytest.raises(A2uiXmlValidationError, match="static"):
            compiler.compile('<Text text="Hi" variant="$/dynVariant" />')

    def test_v091_vs_v10_wire_shapes_actions_checks_and_standalone_calls(self):
        cat_v091 = BasicCatalog("0.9")
        cat_v10 = BasicCatalog("1.0")

        a2ui_xml_v091 = """```json dataModel
{"user": {"email": "ada@example.com"}}
```
<Card>
  <Column>
    <TextField label="Email" value="$/user/email">
      <Check call="required" />
      <Check call="email" message="Enter a valid email" />
    </TextField>
    <Button action="Event('submit', {email: $/user/email})">
      <Text text="$formatString('Send to ${/user/email}')" />
    </Button>
  </Column>
</Card>"""
        msgs_091 = to_message_dicts(
            A2uiXmlCompiler([cat_v091], strict=True).compile(a2ui_xml_v091)
        )
        assert [list(m.keys()) for m in msgs_091] == [
            ["version", "createSurface"],
            ["version", "updateComponents"],
            ["version", "updateDataModel"],
        ]
        comps_091 = {c["id"]: c for c in msgs_091[1]["updateComponents"]["components"]}
        tf_091 = next(c for c in comps_091.values() if c["component"] == "TextField")
        assert tf_091["value"] == {"path": "/user/email"}
        assert tf_091["checks"][0]["condition"] == {
            "call": "required",
            "args": {"value": {"path": "/user/email"}},
        }

        # userMessage and CallFunction rejected in v0.9.1, accepted in v1.0
        with pytest.raises(A2uiXmlValidationError, match="v1.0"):
            A2uiXmlCompiler([cat_v091]).compile(
                """<Button action="Event('go', userMessage='Going')"><Text text="Go" /></Button>"""
            )
        with pytest.raises(A2uiXmlValidationError, match="CallFunction"):
            A2uiXmlCompiler([cat_v091]).compile(
                '<CallFunction name="openUrl" url="https://a2ui.org" />'
            )

        a2ui_xml_v10 = """<Button action="Event('go', {id: 7}, userMessage='Opening')">
  <Text text="Go" />
</Button>
<CallFunction name="openUrl" id="open_1" url="https://a2ui.org" />
<DeleteSurface id="old_surf" />"""
        msgs_10 = to_message_dicts(
            A2uiXmlCompiler([cat_v10], strict=True).compile(a2ui_xml_v10)
        )
        assert "createSurface" in msgs_10[0]
        btn_10 = msgs_10[0]["createSurface"]["components"][0]
        assert btn_10["action"] == {
            "event": {
                "name": "go",
                "context": {"id": 7},
                "userMessage": "Opening",
            }
        }
        assert msgs_10[1] == {
            "version": "1.0",
            "callRendererFunction": {
                "functionCallId": "open_1",
                "callFunction": {
                    "catalogId": cat_v10.catalog_id,
                    "@call": "openUrl",
                    "args": {"url": "https://a2ui.org"},
                },
            },
        }
        assert msgs_10[2] == {
            "version": "1.0",
            "deleteSurface": {"surfaceId": "old_surf"},
        }

    def test_tabs_items_choice_picker_fences_and_partial_surface_updates(self):
        cat = BasicCatalog("1.0")
        parser = A2uiXmlParser([cat], strict=True)

        full_response = """<a2ui surface="Booking">
<Tabs>
  <Item title="Flight">
    <ChoicePicker label="Seat" value="$/seat">
      ```json options
      [
        {"label": "Window", "value": "window"},
        {"label": "Aisle", "value": "aisle"}
      ]
      ```
    </ChoicePicker>
  </Item>
  <Item title="Summary">
    <Text text="Ready" />
  </Item>
</Tabs>
</a2ui>
<a2ui surface="Booking" update="true">
<DataModel path="/seat">
  ```json
  ["window"]
  ```
</DataModel>
</a2ui>"""
        parts = parser.parse_response(full_response)
        assert len(parts) == 2
        create_msg = to_message_dicts(parts[0].a2ui)[0]["createSurface"]
        assert create_msg["surfaceId"] == "Booking"
        root_tabs = create_msg["components"][0]
        assert root_tabs["component"] == "Tabs"
        assert len(root_tabs["tabs"]) == 2
        assert root_tabs["tabs"][0]["title"] == "Flight"

        update_msg = to_message_dicts(parts[1].a2ui)[0]["updateDataModel"]
        assert update_msg == {
            "surfaceId": "Booking",
            "path": "/seat",
            "value": ["window"],
        }

    def test_multi_catalog_v10_resolution_and_disambiguation(self):
        cat_a = Catalog.from_json(
            {
                "catalogId": "https://example.com/cat_a",
                "components": {
                    "SharedBadge": {
                        "properties": {
                            "component": {"const": "SharedBadge"},
                            "label": {"type": "string"},
                        },
                        "required": ["component", "label"],
                    },
                    "OnlyA": {
                        "properties": {
                            "component": {"const": "OnlyA"},
                            "child": {"$ref": "common_types.json#/$defs/Child"},
                        },
                        "required": ["component", "child"],
                    },
                },
            },
            protocol_version=ProtocolVersion.V1_0,
        )
        cat_b = Catalog.from_json(
            {
                "catalogId": "https://example.com/cat_b",
                "components": {
                    "SharedBadge": {
                        "properties": {
                            "component": {"const": "SharedBadge"},
                            "label": {"type": "string"},
                        },
                        "required": ["component", "label"],
                    }
                },
            },
            protocol_version=ProtocolVersion.V1_0,
        )

        fmt = A2uiXmlFormat([cat_a, cat_b], strict=True)
        rules = fmt.prompt_generator.generate_base_rules()
        assert "SharedBadge" in rules

        parser = fmt.create_parser()
        # Ambiguous without catalogId fails
        with pytest.raises(A2uiXmlValidationError, match="Ambiguous"):
            parser.compile('<OnlyA>\n  <SharedBadge label="Hi" />\n</OnlyA>')

        # Disambiguated with catalogId compiles and round-trips cleanly
        msgs = parser.compile(
            "<OnlyA>\n"
            '  <SharedBadge catalogId="https://example.com/cat_b" label="Hi" />\n'
            "</OnlyA>"
        )
        msg_dict = to_message_dicts(msgs)[0]["createSurface"]
        assert "catalogId" not in msg_dict
        comps = {c["id"]: c for c in msg_dict["components"]}
        assert comps["root"]["catalogId"] == "https://example.com/cat_a"
        assert comps["c1"]["catalogId"] == "https://example.com/cat_b"

        decompiled = parser.decompile(msgs)
        assert 'catalogId="https://example.com/cat_b"' in decompiled
        assert "cat_a" not in decompiled  # OnlyA is unique, so catalogId omitted!
        recompiled = parser.compile(decompiled)
        assert to_message_dicts(recompiled) == [
            {"version": "1.0", "createSurface": msg_dict}
        ]

    def test_item_rejects_unknown_attributes_when_additional_properties_false(self):
        table_cat = Catalog.from_json(
            {
                "catalogId": "https://example.com/table_cat",
                "components": {
                    "DataTable": {
                        "properties": {
                            "component": {"const": "DataTable"},
                            "columns": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "header": {"type": "string"},
                                        "field": {"type": "string"},
                                    },
                                    "required": ["header", "field"],
                                    "additionalProperties": False,
                                },
                            },
                        },
                        "required": ["component", "columns"],
                    }
                },
            },
            protocol_version=ProtocolVersion.V1_0,
        )
        compiler = A2uiXmlCompiler([table_cat])
        with pytest.raises(
            A2uiXmlValidationError, match="Unknown property 'bogusAttr'"
        ):
            compiler.compile_with_diagnostics(
                '<DataTable>\n  <Item header="Col" field="col" bogusAttr="bad"'
                " />\n</DataTable>"
            )

        # Case mismatch on closed <Item> schema recovers leniently and records violation
        diag = compiler.compile_with_diagnostics(
            '<DataTable>\n  <Item HEADER="Col" field="col" />\n</DataTable>',
            strict=False,
        )
        assert diag.strict_valid is False
        assert diag.lenient_valid is True
        comp = to_message_dicts(diag.messages)[0]["createSurface"]["components"][0]
        assert comp["columns"] == [{"header": "Col", "field": "col"}]

    def test_a2ui_envelope_law5_violations_propagate_into_compile_with_diagnostics(
        self,
    ):
        cat = BasicCatalog("1.0")
        lenient_parser = A2uiXmlParser([cat], strict=False)
        strict_parser = A2uiXmlParser([cat], strict=True)

        response = """<a2ui surface='main' update>
<Text id="c1" text="Updated" />
</a2ui>"""

        # Strict parser rejects on unwrap / parse_response
        with pytest.raises(A2uiXmlParseError):
            strict_parser.unwrap(response)

        # Lenient parser unwraps while preserving Law 5 violations into raw_block diagnostics
        raw_blocks = [
            r.part.a2ui_raw
            for r in lenient_parser.unwrap(response)
            if isinstance(r.part, RawA2uiPart)
        ]
        assert len(raw_blocks) == 1
        diag = lenient_parser.compile_with_diagnostics(raw_blocks[0])
        assert diag.lenient_valid is True
        assert diag.strict_valid is False
        assert any(v.law == "law5_double_quotes" for v in diag.strict_violations)

        with pytest.raises(A2uiXmlParseError):
            lenient_parser.compile_with_diagnostics(raw_blocks[0], strict=True)
