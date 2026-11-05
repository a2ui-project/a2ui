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

"""Unit tests verifying Express-vs-XML parity audit remediations in A2UI XML."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiParseError, A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats import (
    A2uiXmlCompiler,
    A2uiXmlDecompiler,
    A2uiXmlFormat,
    A2uiXmlFormatFactory,
    A2uiXmlResponseStream,
    ExpressFormat,
    a2ui_xml,
    to_message_dicts,
    to_message_models,
)
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    A2uiPart,
    RawA2uiPart,
    ResponsePart,
    TextPart,
)

pytestmark = pytest.mark.filterwarnings("ignore:\\[EXPERIMENTAL\\]:UserWarning")


def _make_collision_catalog(version: ProtocolVersion = ProtocolVersion.V1_0) -> Catalog:
    """Creates a catalog whose components declare `data`, `dataModel`, and `slot`."""
    prefix = (
        "common_types.json#/$defs/"
        if version == ProtocolVersion.V1_0
        else "https://a2ui.org/specification/v0_9/common_types.json#/$defs/"
    )
    call_key = "@call" if version == ProtocolVersion.V1_0 else "call"
    return Catalog.from_json(
        {
            "catalogId": "https://example.com/collision_cat",
            "components": {
                "DataGrid": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "DataGrid"},
                        "data": {
                            "type": "array",
                            "items": {"type": "object"},
                        },
                        "data_model": {"type": "object"},
                    },
                    "required": ["component", "data"],
                },
                "ModelInspector": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ModelInspector"},
                        "dataModel": {"type": "object"},
                    },
                    "required": ["component", "dataModel"],
                },
                "SlotBadge": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "SlotBadge"},
                        "slot": {"$ref": f"{prefix}DynamicString"},
                        "label": {"$ref": f"{prefix}DynamicString"},
                    },
                    "required": ["component", "slot"],
                },
                "VBox": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "VBox"},
                        "children": {"$ref": f"{prefix}ChildList"},
                    },
                    "required": ["component", "children"],
                },
                "SplitPane": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "SplitPane"},
                        "left": {"$ref": f"{prefix}Child"},
                        "right": {"$ref": f"{prefix}Child"},
                    },
                    "required": ["component", "left", "right"],
                },
                "CheckBoxInput": {
                    "type": "object",
                    "allOf": [
                        {"$ref": f"{prefix}Checkable"},
                        {
                            "type": "object",
                            "properties": {
                                "component": {"const": "CheckBoxInput"},
                                "label": {"$ref": f"{prefix}DynamicString"},
                                "value": {"$ref": f"{prefix}DynamicString"},
                            },
                            "required": ["component"],
                        },
                    ],
                },
            },
            "functions": {
                "anyCheck": {
                    "type": "object",
                    "returnType": "boolean",
                    "properties": {
                        call_key: {"const": "anyCheck"},
                        "args": {
                            "type": "object",
                            "properties": {"value": {}},
                            "required": ["value"],
                        },
                    },
                    "required": [call_key, "args"],
                },
                "dynFn": {
                    "type": "object",
                    "returnType": "boolean",
                    "properties": {
                        call_key: {"const": "dynFn"},
                        "args": {
                            "type": "object",
                            "properties": {
                                "payload": {"$ref": f"{prefix}DynamicValue"}
                            },
                            "required": ["payload"],
                        },
                    },
                    "required": [call_key, "args"],
                },
            },
        },
        protocol_version=version,
    )


class TestPropertyCollisions:
    """Items 1 & 2: Component property collisions on data/dataModel/data_model and slot."""

    def test_component_data_and_datamodel_properties_not_hijacked(self) -> None:
        cat = _make_collision_catalog()
        parser = A2uiXmlFormat([cat], tuned=True).create_parser()

        xml = """<a2ui>
<VBox>
  <DataGrid>
    ```json data
    [{"id": 1, "name": "Row A"}]
    ```
    ```json data_model
    {"meta": true}
    ```
  </DataGrid>
  <ModelInspector>
    ```json dataModel
    {"inspect": "value"}
    ```
  </ModelInspector>
</VBox>
</a2ui>"""
        parts = parser.parse_response(xml)
        assert len(parts) == 1
        assert isinstance(parts[0], A2uiPart)
        cs = to_message_dicts(parts[0].a2ui)[0]["createSurface"]
        assert "dataModel" not in cs
        comps = {c["id"]: c for c in cs["components"]}
        grid = next(c for c in comps.values() if c["component"] == "DataGrid")
        assert grid["data"] == [{"id": 1, "name": "Row A"}]
        assert grid["data_model"] == {"meta": True}
        inspector = next(
            c for c in comps.values() if c["component"] == "ModelInspector"
        )
        assert inspector["dataModel"] == {"inspect": "value"}

        # Verify progressive streaming also preserves component `data` property
        stream = parser.open_stream()
        streamed_parts = []
        for idx in range(0, len(xml), 13):
            streamed_parts.extend(stream.feed(xml[idx : idx + 13]))
        streamed_parts.extend(stream.close())
        surf = stream.state.get_surface("main")
        assert surf is not None
        assert surf.data_model.get("/") == {}
        assert surf.components_model.get_all()[grid["id"]].properties["data"] == [
            {"id": 1, "name": "Row A"}
        ]

        # Verify strict round-trip
        decompiled = parser.decompile(parts[0].a2ui)
        recompiled = A2uiXmlCompiler([cat], strict=True).compile(decompiled)
        assert to_message_dicts(recompiled) == to_message_dicts(parts[0].a2ui)

    def test_component_slot_property_preserved_at_root_list_and_named_slots(
        self,
    ) -> None:
        cat = _make_collision_catalog()
        strict_parser = A2uiXmlFormat([cat], strict=True).create_parser()

        # 1. Root component with `slot` property
        msgs_root = strict_parser.compile('<SlotBadge slot="header" label="Top" />')
        cs_root = to_message_dicts(msgs_root)[0]["createSurface"]
        assert cs_root["components"] == [
            {"id": "root", "component": "SlotBadge", "slot": "header", "label": "Top"}
        ]

        # 2. Inside a ChildList container (`VBox`): `slot="header"` belongs to `SlotBadge`
        msgs_vbox = strict_parser.compile(
            '<VBox>\n  <SlotBadge slot="header" />\n</VBox>'
        )
        cs_vbox = to_message_dicts(msgs_vbox)[0]["createSurface"]
        comps_vbox = {c["id"]: c for c in cs_vbox["components"]}
        assert comps_vbox["root"]["children"] == ["c1"]
        assert comps_vbox["c1"]["slot"] == "header"

        # 3. Inside a multi-slot container (`SplitPane`): decompiles with `parentSlot` and round-trips
        wire = to_message_models({
            "version": "1.0",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": cat.catalog_id,
                "components": [
                    {
                        "id": "root",
                        "component": "SplitPane",
                        "left": "left_badge",
                        "right": "right_badge",
                    },
                    {
                        "id": "left_badge",
                        "component": "SlotBadge",
                        "slot": "nav_slot",
                    },
                    {
                        "id": "right_badge",
                        "component": "SlotBadge",
                        "slot": "body_slot",
                    },
                ],
            },
        })
        decompiled = strict_parser.decompile(wire)
        assert 'parentSlot="left"' in decompiled
        assert 'slot="nav_slot"' in decompiled
        recompiled = strict_parser.compile(decompiled)
        assert to_message_dicts(recompiled) == to_message_dicts(wire)


class TestDataPathsChecksAndEscaping:
    """Items 3, 4, 5, 6, and 7: Paths, unconstrained Check schemas, scanner, strings, empty lists."""

    def test_digit_starting_relative_data_paths_and_currency_literals(self) -> None:
        cat = BasicCatalog("1.0")
        parser = A2uiXmlFormat([cat], strict=True).create_parser()
        source = """<Column>
  <Text text="$0" />
  <Text text="$0/title" />
  <Text text="$12/items/0" />
  <Text text="$49.99" />
  <Text text="$1,500" />
</Column>"""
        msgs = parser.compile(source)
        comps = {
            c["id"]: c for c in to_message_dicts(msgs)[0]["createSurface"]["components"]
        }
        kids = [comps[cid]["text"] for cid in comps["root"]["children"]]
        assert kids == [
            {"@path": "0"},
            {"@path": "0/title"},
            {"@path": "12/items/0"},
            "$49.99",
            "$1,500",
        ]

        # Verify decompile emits `$0` and `$0/title` inline and round-trips strictly
        decompiled = parser.decompile(msgs)
        assert 'text="$0"' in decompiled
        assert 'text="$0/title"' in decompiled
        recompiled = parser.compile(decompiled)
        assert to_message_dicts(recompiled) == to_message_dicts(msgs)

    def test_check_with_unconstrained_empty_schema_accepts_strings_and_roundtrips_types(
        self,
    ) -> None:
        cat = _make_collision_catalog()
        parser = A2uiXmlFormat([cat], strict=True).create_parser()

        # `<Check>` whose `value` schema is `{}` accepts non-numeric string literals
        msgs = parser.compile("""<CheckBoxInput value="$/val">
  <Check call="anyCheck" value="literal_str" message="Must pass" />
</CheckBoxInput>""")
        comp = to_message_dicts(msgs)[0]["createSurface"]["components"][0]
        assert comp["checks"] == [{
            "condition": {"@call": "anyCheck", "args": {"value": "literal_str"}},
            "message": "Must pass",
        }]

        # Tuned mode does NOT auto-bind `label="$/lbl"` into check `value` when `value` is static
        tuned_parser = A2uiXmlFormat([cat], tuned=True).create_parser()
        msgs_lbl = tuned_parser.compile("""<CheckBoxInput label="$/lbl" value="fixed">
  <Check call="anyCheck" value="explicit_str" message="Ok" />
</CheckBoxInput>""")
        comp_lbl = to_message_dicts(msgs_lbl)[0]["createSurface"]["components"][0]
        assert comp_lbl["checks"][0]["condition"]["args"]["value"] == "explicit_str"

        # Round-trip preserves bool/int vs str on DynamicValue & unconstrained `{}` args
        wire = to_message_models([
            {
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "main",
                    "catalogId": cat.catalog_id,
                    "components": [{
                        "id": "root",
                        "component": "CheckBoxInput",
                        "checks": [
                            {
                                "condition": {
                                    "@call": "anyCheck",
                                    "args": {"value": True},
                                },
                                "message": "Bool true",
                            },
                            {
                                "condition": {
                                    "@call": "anyCheck",
                                    "args": {"value": "true"},
                                },
                                "message": "Str true",
                            },
                        ],
                    }],
                },
            },
            {
                "version": "1.0",
                "callRendererFunction": {
                    "functionCallId": "call_1",
                    "callFunction": {
                        "catalogId": cat.catalog_id,
                        "@call": "dynFn",
                        "args": {"payload": 42},
                    },
                },
            },
        ])
        decompiled = parser.decompile(wire)
        recompiled = parser.compile(decompiled)
        assert to_message_dicts(recompiled) == to_message_dicts(wire)

    def test_scanner_trailing_double_backslash_and_backslash_roundtrips(self) -> None:
        cat = BasicCatalog("1.0")
        parser = A2uiXmlFormat([cat]).create_parser()

        # Direct XML with `\\` right before closing quote does not treat quote as escaped
        msgs = parser.compile(r'<Text id="root" text="C:\\" />')
        comp = to_message_dicts(msgs)[0]["createSurface"]["components"][0]
        assert comp["component"] == "Text"
        assert comp["text"].startswith("C:\\")

        # Arbitrary trailing backslash counts round-trip 1-to-1 via decompile -> strict compile
        strict_parser = A2uiXmlFormat([cat], strict=True).create_parser()
        for text_val in [
            "C:\\",
            "C:\\\\",
            "C:\\\\\\",
            r"quote\"and\\",
        ]:
            wire = to_message_models({
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "main",
                    "catalogId": cat.catalog_id,
                    "components": [
                        {"id": "root", "component": "Text", "text": text_val}
                    ],
                },
            })
            xml = strict_parser.decompile(wire)
            recompiled = strict_parser.compile(xml)
            assert (
                to_message_dicts(recompiled)[0]["createSurface"]["components"][0][
                    "text"
                ]
                == text_val
            )

    @pytest.mark.parametrize("tuned", [False, True])
    @pytest.mark.parametrize(
        "literal_str",
        [
            " $formatString('a')",
            "$formatString('a') ",
            " Event('go')",
            "Event('go')",
            "formatString('a')",
            "$foo",
            r"\$foo",
            r"\\$foo",
            r"\\\$foo",
            "{$/a}",
            "{true}",
            "{2}",
            "{?required}",
            '{"Quarterly Report"}',
        ],
    )
    def test_literal_string_escaping_whitespace_and_braces_roundtrip(
        self, tuned: bool, literal_str: str
    ) -> None:
        cat = BasicCatalog("1.0")
        parser = A2uiXmlFormat([cat], tuned=tuned).create_parser()
        strict_compiler = A2uiXmlCompiler([cat], strict=True, tuned=tuned)

        wire = to_message_models({
            "version": "1.0",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": cat.catalog_id,
                "components": [
                    {"id": "root", "component": "Text", "text": literal_str}
                ],
            },
        })
        xml = parser.decompile(wire)
        recompiled = strict_compiler.compile(xml)
        assert (
            to_message_dicts(recompiled)[0]["createSurface"]["components"][0]["text"]
            == literal_str
        )

    def test_empty_children_and_structured_items_roundtrip_strictly(self) -> None:
        cat = BasicCatalog("1.0")
        strict_parser = A2uiXmlFormat([cat], strict=True).create_parser()

        for comp_dict, expected_attr in [
            ({"id": "root", "component": "Column", "children": []}, 'children="[]"'),
            ({"id": "root", "component": "Tabs", "tabs": []}, 'tabs="[]"'),
        ]:
            wire = to_message_models({
                "version": "1.0",
                "createSurface": {
                    "surfaceId": "main",
                    "catalogId": cat.catalog_id,
                    "components": [comp_dict],
                },
            })
            xml = strict_parser.decompile(wire)
            assert expected_attr in xml
            diag = strict_parser.compile_with_diagnostics(xml, strict=True)
            assert diag.strict_valid is True
            assert diag.strict_violations == ()
            assert to_message_dicts(diag.messages) == to_message_dicts(wire)


class TestCatalogIdEventValidationProseAndSdkParity:
    """Items 8, 9, 10, 11, 12, and 13: catalogId, Event kwargs, prose, progressive_keys, SDK."""

    def test_v09_rejects_per_component_function_and_check_catalog_id(self) -> None:
        cat_v09 = BasicCatalog("0.9")
        compiler = A2uiXmlCompiler([cat_v09])
        cid = cat_v09.catalog_id

        with pytest.raises(
            a2ui_xml.A2uiXmlValidationError, match="v0.9 only allows catalogId"
        ):
            compiler.compile(f'<Text catalogId="{cid}" text="Hi" />')

        with pytest.raises(
            a2ui_xml.A2uiXmlValidationError, match="v0.9 only allows catalogId"
        ):
            compiler.compile(
                f"""<Text text="$formatString('Hi', catalogId='{cid}')" />"""
            )

        with pytest.raises(
            a2ui_xml.A2uiXmlValidationError, match="v0.9 only allows catalogId"
        ):
            compiler.compile(f"""<TextField label="Name" value="$/name">
  <Check call="required" catalogId="{cid}" />
</TextField>""")

        with pytest.raises(
            a2ui_xml.A2uiXmlValidationError, match="v0.9 only allows catalogId"
        ):
            compiler.compile(
                f"""<TextField label="Name" value="$/name" checks="?required(catalogId='{cid}')" />"""
            )

    def test_v10_single_catalog_preserves_explicit_catalog_id(self) -> None:
        cat_v10 = BasicCatalog("1.0")
        cid = cat_v10.catalog_id
        compiler = A2uiXmlCompiler([cat_v10], strict=True)

        source = f"""<Column catalogId="{cid}">
  <Text catalogId="{cid}" text="$formatString('Hello', catalogId='{cid}')" />
  <TextField label="Email" value="$/email">
    <Check call="required" catalogId="{cid}" />
  </TextField>
</Column>"""
        msgs = to_message_dicts(compiler.compile(source))
        comps = {c["id"]: c for c in msgs[0]["createSurface"]["components"]}
        assert comps["root"]["catalogId"] == cid
        assert comps["c1"]["catalogId"] == cid
        assert comps["c1"]["text"]["catalogId"] == cid
        assert comps["c2"]["checks"][0]["condition"]["catalogId"] == cid

    def test_event_rejects_invalid_kwargs_and_missing_name(self) -> None:
        cat = BasicCatalog("1.0")
        compiler = A2uiXmlCompiler([cat])

        for bad_event in [
            "Event()",
            "Event('submit', catalogId='bad')",
            "Event('submit', message='wrong_kwarg')",
            "Event('submit', extraField=123)",
            "Event('submit', name='dup')",
        ]:
            with pytest.raises(a2ui_xml.A2uiXmlValidationError):
                compiler.compile(
                    f'<Button action="{bad_event}">\n  <Text text="Go" />\n</Button>'
                )

        # Valid `context=` and `userMessage=` succeed
        msgs = to_message_dicts(
            compiler.compile(
                """<Button action="Event('submit', context={id: 1}, userMessage='Sending')">
  <Text text="Go" />
</Button>"""
            )
        )
        assert msgs[0]["createSurface"]["components"][0]["action"] == {
            "event": {
                "name": "submit",
                "context": {"id": 1},
                "userMessage": "Sending",
            }
        }

    def test_conversational_prose_mentioning_close_tag_stays_text(self) -> None:
        cat = BasicCatalog("1.0")
        parser = A2uiXmlFormat([cat]).create_parser()

        prose = "In A2UI XML, blocks end with the </a2ui> closing sentinel tag."
        assert parser.has_format_content(prose) is False
        unwrapped = parser.unwrap(prose)
        assert len(unwrapped) == 1
        assert isinstance(unwrapped[0].part, TextPart)
        assert unwrapped[0].part.text == prose

        parsed = parser.parse_response(prose)
        assert parsed == [TextPart(text=prose)]

        # Actual tag content before `</a2ui>` still recovers leniently when `<a2ui>` was omitted
        orphan_xml = '<Text text="Recovered UI" />\n</a2ui>\nTrailing prose.'
        assert parser.has_format_content(orphan_xml) is True
        orphan_unwrapped = parser.unwrap(orphan_xml)
        assert isinstance(orphan_unwrapped[0].part, RawA2uiPart)

    def test_progressive_keys_version_error_hierarchy_and_surface_catalog_id(
        self,
    ) -> None:
        cat_v10 = BasicCatalog("1.0")
        cat_v09 = BasicCatalog("0.9")

        # 1. `version` property and `progressive_keys` forwarding
        default_fmt = A2uiXmlFormat([cat_v10])
        assert default_fmt.version == "1.0"
        assert (
            default_fmt.progressive_keys == a2ui_xml.DEFAULT_A2UI_XML_PROGRESSIVE_KEYS
        )

        v09_fmt = A2uiXmlFormat([cat_v09])
        assert v09_fmt.version == "v0.9"

        factory = A2uiXmlFormatFactory(progressive_keys=["label", "caption"])
        assert factory.progressive_keys == frozenset({"label", "caption"})
        bound_fmt = factory.bind([cat_v10])
        assert bound_fmt.progressive_keys == frozenset({"label", "caption"})
        parser = bound_fmt.create_parser()
        assert parser.progressive_keys == frozenset({"label", "caption"})
        stream = parser.open_stream()
        assert isinstance(stream, A2uiXmlResponseStream)
        assert stream.progressive_keys == frozenset({"label", "caption"})
        override_stream: A2uiXmlResponseStream[ResponsePart] = A2uiXmlResponseStream(
            parser, progressive_keys=["custom"]
        )
        assert override_stream.progressive_keys == frozenset({"custom"})

        # 2. Error hierarchy inherits from `A2uiCompilationError`
        assert issubclass(a2ui_xml.A2uiXmlError, A2uiCompilationError)
        assert issubclass(a2ui_xml.A2uiXmlParseError, A2uiCompilationParseError)
        assert issubclass(a2ui_xml.A2uiXmlParseError, A2uiParseError)
        assert issubclass(
            a2ui_xml.A2uiXmlValidationError, A2uiCompilationValidationError
        )
        assert issubclass(a2ui_xml.A2uiXmlValidationError, A2uiValidationError)

        with pytest.raises(A2uiCompilationValidationError):
            parser.compile("<NonExistentTag />")
        with pytest.raises(A2uiCompilationParseError):
            parser.compile('<Text text="unterminated />')

        # 3. `<Surface catalogId="...">` validation in single-catalog & multi-catalog modes
        valid_surf = parser.compile(
            f'<Surface id="s1" catalogId="{cat_v10.catalog_id}">\n'
            '  <Text text="Ok" />\n'
            "</Surface>"
        )
        assert (
            to_message_dicts(valid_surf)[0]["createSurface"]["catalogId"]
            == cat_v10.catalog_id
        )

        with pytest.raises(a2ui_xml.A2uiXmlValidationError, match="Unknown catalogId"):
            parser.compile(
                '<Surface id="s1" catalogId="https://wrong/catalog">\n'
                '  <Text text="Bad" />\n'
                "</Surface>"
            )

        extra_cat = _make_collision_catalog(ProtocolVersion.V1_0)
        multi_parser = A2uiXmlFormat([cat_v10, extra_cat]).create_parser()
        with pytest.raises(a2ui_xml.A2uiXmlValidationError, match="multiple catalogs"):
            multi_parser.compile(
                f'<Surface id="s1" catalogId="{cat_v10.catalog_id}">\n'
                '  <Text text="Bad" />\n'
                "</Surface>"
            )

    def test_express_to_a2ui_xml_full_feature_equivalence(self) -> None:
        """Any rich Express block compiles to wire JSON that decompiles to XML and recompiles identically."""
        cat = BasicCatalog("1.0")
        express_parser = ExpressFormat([cat]).create_parser()
        xml_decompiler = A2uiXmlDecompiler([cat])
        xml_compiler = A2uiXmlCompiler([cat], strict=True)

        express_block = """surface("checkout", sendDataModel=true)
$/order/email = "ada@example.com"
$/order/items = [{"title": "Widget"}]
root = Card(Column([
  Text(formatString("Email: ${/order/email}")),
  TextField(label="Email", value=$/order/email, checks=[?required("Email required")]),
  List(_template($/order/items, Text($0/title))),
  Column([]),
  Button(Text("Pay $49.99"), action=Event("pay", {"email": $/order/email}, userMessage="Paying now"))
]))
openUrl("https://a2ui.org", functionCallId="open_docs")
deleteSurface("legacy_surface")"""

        express_msgs = express_parser.compile(express_block)
        xml_text = xml_decompiler.decompile(express_msgs, preserve_ids=True)
        recompiled_msgs = xml_compiler.compile(xml_text)

        # Compare surface state & standalone messages
        exp_dicts = to_message_dicts(express_msgs)
        xml_dicts = to_message_dicts(recompiled_msgs)
        assert len(xml_dicts) == len(exp_dicts)
        assert xml_dicts[0]["createSurface"]["surfaceId"] == "checkout"
        assert xml_dicts[0]["createSurface"]["sendDataModel"] is True
        assert (
            xml_dicts[0]["createSurface"]["dataModel"]
            == exp_dicts[0]["createSurface"]["dataModel"]
        )
        assert {c["id"]: c for c in xml_dicts[0]["createSurface"]["components"]} == {
            c["id"]: c for c in exp_dicts[0]["createSurface"]["components"]
        }
        assert xml_dicts[1:] == exp_dicts[1:]
