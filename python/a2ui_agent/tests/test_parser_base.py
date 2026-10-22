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

"""Unit tests for base Parser, ResponsePart, PromptGenerator, and InferenceFormat ABCs."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import pytest

from a2ui.core import Catalog, CatalogApi
from a2ui.core.schema import ProtocolVersion
from a2ui.core.schema.v1_0 import DeleteSurface, DeleteSurfaceMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.parser import (
    A2uiPart,
    Parser,
    RawA2uiPart,
    RawResponsePart,
    ResponsePart,
    TextPart,
)
from a2ui.prompt import PromptGenerator


def _make_delete_message(surface_id: str = "main") -> DeleteSurfaceMessage:
    return DeleteSurfaceMessage(
        version="v1.0",
        deleteSurface=DeleteSurface(surfaceId=surface_id),
    )


class _MockParser(Parser):
    """Minimal concrete Parser implementation for testing base Parser methods."""

    def has_format_content(self, content: str, complete: bool = False) -> bool:
        if complete:
            return "<mock>" in content and "</mock>" in content
        return "<mock>" in content

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        parts: list[str] = []
        for block in blocks:
            if isinstance(block.part, TextPart):
                parts.append(block.part.text)
            elif isinstance(block.part, RawA2uiPart):
                parts.append(f"<mock>{block.part.a2ui_raw}</mock>")
        return "".join(parts)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        result: list[RawResponsePart] = []
        remaining = content
        while "<mock>" in remaining:
            before, _, after_open = remaining.partition("<mock>")
            if before:
                result.append(RawResponsePart(part=TextPart(text=before)))
            raw_body, sep, remaining = after_open.partition("</mock>")
            if not sep:
                result.append(
                    RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_body), is_final=False)
                )
                return result
            result.append(RawResponsePart(part=RawA2uiPart(a2ui_raw=raw_body)))
        if remaining:
            result.append(RawResponsePart(part=TextPart(text=remaining)))
        return result

    def compile(self, format_content: str) -> list[Any]:
        surface_ids = [s.strip() for s in format_content.split(",") if s.strip()]
        return [_make_delete_message(sid) for sid in surface_ids]

    def decompile(self, a2ui_payload: Sequence[Any]) -> str:
        return ",".join(m.delete_surface.surface_id for m in a2ui_payload)


def test_response_part_dataclasses_and_types() -> None:
    """Verifies TextPart, RawA2uiPart, RawResponsePart, and A2uiPart structure and equality."""
    text_part = TextPart(text="Hello world")
    assert text_part.text == "Hello world"
    assert text_part == TextPart("Hello world")
    assert isinstance(text_part, ResponsePart)

    raw_part = RawA2uiPart(a2ui_raw="surface_1")
    assert raw_part.a2ui_raw == "surface_1"
    assert raw_part == RawA2uiPart("surface_1")

    raw_resp_part = RawResponsePart(part=raw_part)
    assert raw_resp_part.part == raw_part
    assert raw_resp_part.is_final is True
    partial_raw_resp = RawResponsePart(part=raw_part, is_final=False)
    assert partial_raw_resp.is_final is False

    msg = _make_delete_message("surface_1")
    a2ui_part = A2uiPart(a2ui=[msg])
    assert a2ui_part.a2ui == [msg]
    assert a2ui_part == A2uiPart([msg])
    assert isinstance(a2ui_part, ResponsePart)


def test_parser_abc_cannot_be_instantiated_directly() -> None:
    """Verifies Parser ABC enforces implementation of abstract methods."""
    with pytest.raises(TypeError):
        Parser()  # type: ignore[abstract]


def test_parser_parse_response_wrapped_preserves_order() -> None:
    """Verifies parse_response(wrapped=True) unwraps and compiles A2UI parts in order."""
    parser = _MockParser()
    content = "Intro text <mock>s1,s2</mock> middle text <mock>s3</mock> outro"

    parts = parser.parse_response(content, wrapped=True)

    assert parts == [
        TextPart(text="Intro text "),
        A2uiPart(a2ui=[_make_delete_message("s1"), _make_delete_message("s2")]),
        TextPart(text=" middle text "),
        A2uiPart(a2ui=[_make_delete_message("s3")]),
        TextPart(text=" outro"),
    ]


def test_parser_parse_response_unwrapped_compiles_directly() -> None:
    """Verifies parse_response(wrapped=False) compiles the entire content without unwrapping."""
    parser = _MockParser()
    parts = parser.parse_response("s1, s2", wrapped=False)

    assert parts == [
        A2uiPart(a2ui=[_make_delete_message("s1"), _make_delete_message("s2")])
    ]


def test_parser_wrap_and_decompile_roundtrip() -> None:
    """Verifies wrap() and decompile() on a concrete Parser."""
    parser = _MockParser()
    msg = _make_delete_message("main")
    raw_str = parser.decompile([msg])
    assert raw_str == "main"

    wrapped = parser.wrap([
        RawResponsePart(part=TextPart("Before ")),
        RawResponsePart(part=RawA2uiPart(raw_str)),
        RawResponsePart(part=TextPart(" After")),
    ])
    assert wrapped == "Before <mock>main</mock> After"


def test_parser_streaming_defaults() -> None:
    """Verifies supports_streaming is False by default and parse_chunk raises NotImplementedError."""
    parser = _MockParser()
    assert parser.supports_streaming is False
    with pytest.raises(
        NotImplementedError, match="Streaming is not supported by _MockParser"
    ):
        parser.parse_chunk("<mock>main</mock>")


def test_prompt_generator_abc() -> None:
    """Verifies PromptGenerator is abstract and requires generate()."""
    with pytest.raises(TypeError):
        PromptGenerator()  # type: ignore[abstract]

    class ConcretePromptGenerator(PromptGenerator):

        def generate(self, *args: Any, **kwargs: Any) -> str:
            return "system prompt"

    gen = ConcretePromptGenerator()
    assert gen.generate() == "system prompt"


def test_inference_format_and_factory_abcs() -> None:
    """Verifies InferenceFormat and InferenceFormatFactory abstract contracts."""
    with pytest.raises(TypeError):
        InferenceFormat()  # type: ignore[abstract]
    with pytest.raises(TypeError):
        InferenceFormatFactory()  # type: ignore[abstract]

    class ConcretePromptGenerator(PromptGenerator):

        def __init__(self, catalog: CatalogApi) -> None:
            self.catalog = catalog

        def generate(self, *args: Any, **kwargs: Any) -> str:
            return f"Prompt for {self.catalog.catalog_id}"

    class ConcreteFormat(InferenceFormat):

        def __init__(self, catalog: CatalogApi) -> None:
            self._prompt_generator = ConcretePromptGenerator(catalog)

        @property
        def prompt_generator(self) -> PromptGenerator:
            return self._prompt_generator

        def create_parser(self) -> Parser:
            return _MockParser()

    class ConcreteFormatFactory(InferenceFormatFactory):

        def create_format(
            self,
            catalogs: Sequence[CatalogApi],
            examples: Sequence[Sequence[Any]] | None = None,
        ) -> InferenceFormat:
            del examples
            return ConcreteFormat(catalogs[0])

    cat = Catalog(
        catalog_id="test/fmt",
        protocol_version=ProtocolVersion.V1_0,
        components=[],
        functions=[],
    )
    factory = ConcreteFormatFactory()
    fmt = factory.create_format([cat])
    assert fmt.prompt_generator.generate() == "Prompt for test/fmt"
    parser = fmt.create_parser()
    assert isinstance(parser, _MockParser)
    assert fmt.create_parser() is not parser
