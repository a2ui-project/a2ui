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

"""Unit tests for incremental streaming of A2UI Express DSL responses."""

import pytest

from a2ui.core import A2uiIntegrityError
from a2ui.core import A2uiParseError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.express import DEFAULT_EXPRESS_PROGRESSIVE_KEYS
from a2ui.inference_formats.express import ExpressFormat
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.inference_formats.express import ExpressParser
from a2ui.inference_formats.express.response_stream import heal_progressive_fragment
from a2ui.inference_formats.express.response_stream import split_complete_statements
from a2ui.parser import A2uiCompilationError
from a2ui.parser import A2uiCompilationParseError
from a2ui.parser import TextPart
from a2ui.utils import RendererState


def _dump(parts):
    return [
        part.text
        if isinstance(part, TextPart)
        else [m.model_dump(by_alias=True, exclude_none=True) for m in part.a2ui]
        for part in parts
    ]


def test_split_complete_statements_handles_multiline_and_semicolons():
    buffer = (
        'surface("main")\n'
        "root = Column(\n"
        "  [t1, t2]\n"
        ")\n"
        't1 = Text("a"); t2 = Text("b")\n'
        't3 = Text("unclosed'
    )
    prefix, remainder = split_complete_statements(buffer)
    assert prefix == (
        'surface("main")\n'
        "root = Column(\n"
        "  [t1, t2]\n"
        ")\n"
        't1 = Text("a"); t2 = Text("b")\n'
    )
    assert remainder == 't3 = Text("unclosed'


def test_heal_progressive_fragment_heals_positional_keyword_and_path():
    from a2ui.inference_formats.express.compiler import ExpressCompiler

    catalog = BasicCatalog(ProtocolVersion.V0_9)
    helpers = ExpressCompiler([catalog]).helpers
    keys = DEFAULT_EXPRESS_PROGRESSIVE_KEYS
    assert (
        heal_progressive_fragment('  t1 = Text("Hel', helpers, keys)
        == '  t1 = Text("Hel")'
    )
    assert (
        heal_progressive_fragment(
            '  t1 = Text(usageHint="h1", text="Hel\\', helpers, keys
        )
        == '  t1 = Text(usageHint="h1", text="Hel")'
    )
    assert (
        heal_progressive_fragment('  $/text = "Dra', helpers, keys)
        == '  $/text = "Dra"'
    )
    # A data path whose last segment is not a progressive key is not healed.
    assert heal_progressive_fragment('  $/status = "act', helpers, keys) is None
    # Non-progressive key is not healed.
    assert (
        heal_progressive_fragment('  b = Button("Save", id="bt', helpers, keys) is None
    )
    # Disabled progressive keys heal nothing.
    assert heal_progressive_fragment('  t1 = Text("Hel', helpers, frozenset()) is None
    # Triple-quoted string ending with a quote escapes the trailing quote before closing.
    assert heal_progressive_fragment(
        '  t1 = Text("""Hello "', helpers, keys
    ) == '  t1 = Text("""Hello \\"""" )'.replace(" )", ")")
    # Standalone function call keyword argument is not healed as a component slot.
    assert (
        heal_progressive_fragment(
            '  openUrl(url="tel:+1555', helpers, frozenset({"url"})
        )
        is None
    )


def test_express_format_and_factory_expose_progressive_keys():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    factory = ExpressFormatFactory(progressive_keys={"text"})
    assert factory.progressive_keys == frozenset({"text"})
    fmt = factory.create_format([catalog])
    assert fmt.progressive_keys == frozenset({"text"})
    assert fmt.supports_streaming is True
    parser = fmt.create_parser()
    assert parser.progressive_keys == frozenset({"text"})
    assert parser.supports_streaming is True


def test_express_stream_unwrapped_mode():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    parser = ExpressParser([catalog], surface_id="s1")
    stream = parser.open_stream(wrapped=False)

    parts1 = stream.feed("root = Column([t1])\n")
    assert len(parts1) == 1
    msgs1 = [m.model_dump(by_alias=True, exclude_none=True) for m in parts1[0].a2ui]
    assert len(msgs1) == 2
    assert "createSurface" in msgs1[0]
    assert msgs1[1]["updateComponents"]["components"] == [
        {"id": "root", "component": "Column", "children": ["t1"]}
    ]

    parts2 = stream.feed('t1 = Text("Hello")\n')
    assert len(parts2) == 1
    msgs2 = [m.model_dump(by_alias=True, exclude_none=True) for m in parts2[0].a2ui]
    assert msgs2 == [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "t1", "component": "Text", "text": "Hello"}],
        },
    }]
    assert stream.close() == []


def test_express_stream_rolls_back_unemitted_chunk_and_marks_emitted_checked():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    state = RendererState([catalog])
    parser = ExpressParser([catalog], surface_id="s1")
    stream = parser.open_stream(state=state)

    parts1 = stream.feed('<a2ui>\nsurface("s1")\nroot = Column([missing])\n')
    assert len(parts1) == 1
    assert state.get_surface("s1") is not None

    with pytest.raises(A2uiIntegrityError):
        stream.feed('surface("s2")\nroot = Text("Unemitted")\n</a2ui>')

    # Emitted surface s1 stays in state, while unemitted surface s2 from the
    # failing chunk is rolled back by the transaction.
    assert state.get_surface("s1") is not None
    assert state.get_surface("s2") is None


def test_express_stream_closes_after_mid_block_parse_error():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    parser = ExpressParser([catalog], surface_id="s1")
    stream = parser.open_stream()

    with pytest.raises(A2uiCompilationParseError):
        stream.feed("<a2ui>\nroot = (\n</a2ui>")

    with pytest.raises(ValueError, match="closed"):
        stream.feed('After <a2ui>\nroot = Text("ok")\n</a2ui>')
    assert stream.close() == []


def test_express_stream_coalesces_complete_and_healed_component_updates():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    parser = ExpressParser([catalog], surface_id="s1")
    stream = parser.open_stream()

    stream.feed('<a2ui>\nsurface("s1")\nroot = Column([t1, t2])\n')
    parts = stream.feed('t1 = Text("First")\nt2 = Text("Sec')
    assert len(parts) == 1
    msgs = [m.model_dump(by_alias=True, exclude_none=True) for m in parts[0].a2ui]
    assert msgs == [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [
                {"id": "t1", "component": "Text", "text": "First"},
                {"id": "t2", "component": "Text", "text": "Sec"},
            ],
        },
    }]
    stream.feed('ond")\n</a2ui>')
    assert stream.close() == []


def test_express_stream_discards_speculative_healed_update_rejected_by_renderer_state():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    parser = ExpressParser([catalog], surface_id="s1", progressive_keys={"variant"})
    stream = parser.open_stream()

    # "h" is not a valid variant enum value, so RendererState rejects the
    # speculative healed update without aborting the stream or losing t1.
    parts1 = stream.feed(
        '<a2ui>\nsurface("s1")\nroot = Column([t1, t2])\n'
        't1 = Text("First")\nt2 = Text("Second", variant="h'
    )
    assert len(parts1) == 1
    msgs1 = [m.model_dump(by_alias=True, exclude_none=True) for m in parts1[0].a2ui]
    assert len(msgs1) == 2
    assert "createSurface" in msgs1[0]
    assert msgs1[1]["updateComponents"]["components"] == [
        {"id": "root", "component": "Column", "children": ["t1", "t2"]},
        {"id": "t1", "component": "Text", "text": "First"},
    ]

    parts2 = stream.feed('1")\n</a2ui>')
    assert len(parts2) == 1
    msgs2 = [m.model_dump(by_alias=True, exclude_none=True) for m in parts2[0].a2ui]
    assert msgs2 == [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{
                "id": "t2",
                "component": "Text",
                "text": "Second",
                "variant": "h1",
            }],
        },
    }]
    assert stream.close() == []


def test_express_stream_unclosed_wrapped_block_raises_parse_error_on_close():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    state = RendererState([catalog])
    parser = ExpressParser([catalog], surface_id="s1")
    stream = parser.open_stream(state=state)

    parts = stream.feed('<a2ui>\nsurface("s1")\nroot = Text("Ready")\n')
    assert len(parts) == 1
    assert state.get_surface("s1") is not None

    with pytest.raises(A2uiParseError):
        stream.close()
    assert state.get_surface("s1") is not None


def _stream_by_size(parser: ExpressParser, response: str, size: int):
    stream = parser.open_stream()
    out = []
    for i in range(0, len(response), size):
        out.extend(stream.feed(response[i : i + size]))
    out.extend(stream.close())
    return out


def _coalesce_text(parts):
    from a2ui.parser import TextPart

    out = []
    for part in parts:
        if isinstance(part, TextPart) and out and isinstance(out[-1], TextPart):
            out[-1] = TextPart(text=out[-1].text + part.text)
        else:
            out.append(part)
    return out


def test_express_stream_outer_fences_and_inline_backticks_chunk_invariance():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    parser = ExpressParser([catalog], surface_id="s1", progressive_keys=frozenset())
    response = (
        'Intro with `inline` code:\n```a2ui\n<a2ui>\nsurface("s1")\nroot ='
        ' Text("One")\n</a2ui>\n```\n`<a2ui>`\nsurface("s1",'
        " update=true)\n$/title ="
        ' "Two"\n`</a2ui>`\n```a2ui\n<a2ui>\nsurface("s1", update=true)\n$/title'
        ' = "Three"\n</a2ui>\n```\nDone.'
    )
    expected = _dump(parser.parse_response(response))
    for size in (1, 2, 3, 5, 11, len(response)):
        streamed = _dump(_coalesce_text(_stream_by_size(parser, response, size)))
        assert streamed == expected


def test_express_stream_keeps_prose_code_block_before_a2ui_block():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    parser = ExpressParser([catalog], surface_id="s1", progressive_keys=frozenset())
    response = (
        'Run:\n```sh\nls\n```\nAnd UI:\n<a2ui>\nsurface("s1")\nroot ='
        ' Text("Hi")\n</a2ui>'
    )
    assert _dump(_coalesce_text(_stream_by_size(parser, response, 2))) == _dump(
        parser.parse_response(response)
    )


def test_express_stream_holds_partial_open_tag_with_angle_bracket_in_attribute():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    parser = ExpressParser([catalog], surface_id="s1", progressive_keys=frozenset())
    stream = parser.open_stream()
    assert _dump(stream.feed('Before <a2ui x="1 < 2"')) == ["Before"]
    assert len(stream.feed('>\nsurface("s1")\nroot = Text("Hi")\n</a2ui>')) == 1
    assert stream.close() == []


def test_express_stream_wraps_non_a2ui_error_from_compile():
    catalog = BasicCatalog(ProtocolVersion.V0_9)

    class BrokenParser(ExpressParser):

        def compile(self, format_content: str, *, is_final: bool = True):
            raise TypeError("unexpected")

    broken = BrokenParser([catalog], surface_id="s1", progressive_keys=frozenset())
    stream = broken.open_stream()
    with pytest.raises(A2uiCompilationError):
        stream.feed('<a2ui>surface("s1")</a2ui>')
