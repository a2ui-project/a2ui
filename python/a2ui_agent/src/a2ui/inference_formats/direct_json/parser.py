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

"""Parser and compiler implementation for standard A2UI JSON schema responses."""

from collections.abc import Sequence
from typing import Any, cast

from a2ui.core import A2uiCatalogError, A2uiParseError, Catalog, CatalogApi
from a2ui.core.schema import AgentToRendererMessage


from a2ui.inference_formats.direct_json.decompiler import _DirectJsonDecompiler
from a2ui.parser.parser import Parser
from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.parser.response_part import (
    RawA2uiPart,
    RawResponsePart,
    ResponsePart,
    TextPart,
)
from a2ui.schema.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG


def unwrap_response(content: str) -> list[ResponsePart]:
    """Tokenizes the LLM response into a list of ResponsePart objects, extracting raw format content.

    Args:
        content: The raw LLM response.

    Returns:
        A list of ResponsePart objects.
    """
    from a2ui.parser.lexer import BlockLexer

    lexer = BlockLexer(
        open_tag=A2UI_OPEN_TAG,
        close_tag=A2UI_CLOSE_TAG,
        string_delimiters={'"', "'"},
        single_line_comments=None,  # Standard JSON doesn't support comments
    )
    parts = lexer.tokenize(content)

    has_blocks = False
    valid_parts: list[ResponsePart] = []

    for part in parts:
        if part.a2ui_raw is not None:
            if not part.is_final:
                raise A2uiParseError(
                    f"A2UI close tag '{A2UI_CLOSE_TAG}' not found in response."
                )
            if not part.a2ui_raw:
                raise A2uiParseError("A2UI JSON part is empty.")

            valid_parts.append(part)
            has_blocks = True
        else:
            if part.text:
                valid_parts.append(part)

    if not has_blocks:
        raise A2uiParseError(
            f"A2UI tags '{A2UI_OPEN_TAG}' and '{A2UI_CLOSE_TAG}' not found in response."
        )

    return valid_parts


class DirectJsonParser(Parser):
    """Concrete parser implementation for standard A2UI JSON schema responses (Direct JSON Format)."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi] | CatalogApi,
        validator: Any = None,
    ):
        """Initializes the DirectJsonParser.

        Args:
            catalogs: A CatalogApi or sequence of CatalogApi instances mapping schema identifiers.
            validator: Optional callable invoked with the parsed payload. It may
                return a list of `A2uiErrorDetail`, which `compile` raises as an
                `A2uiValidationError`, or raise on its own.
        """
        if isinstance(catalogs, (Sequence, set)) and not isinstance(
            catalogs, (str, bytes)
        ):
            catalog_list = list(catalogs)
        else:
            catalog_list = [catalogs]

        if not catalog_list:
            raise A2uiCatalogError("At least one catalog must be provided.")

        if len(catalog_list) > 1:
            for c in catalog_list:
                ver = str(getattr(c, "protocol_version", "")).removeprefix("v")
                if ver in ("0.8", "0.9", "0.9.1") or (ver and ver < "1.0"):
                    raise A2uiCatalogError(
                        "Only a single catalog is supported for protocol version"
                        f" v{ver}. Multiple catalogs are supported in v1.0 and later."
                    )

        self.catalogs = catalog_list
        self._catalogs = self.catalogs
        self._catalog = self._catalogs[0]
        self._validator = validator
        self._stream_parser: Any | None = None

    def has_format_content(self, content: str, complete: bool = False) -> bool:
        if complete:
            return A2UI_OPEN_TAG in content and A2UI_CLOSE_TAG in content
        return A2UI_OPEN_TAG in content

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Converts a sequence of RawResponseParts to a string with enclosing tags."""
        out: list[str] = []
        for block in blocks:
            if isinstance(block, RawResponsePart):
                if isinstance(block.part, TextPart):
                    out.append(block.part.text)
                elif isinstance(block.part, RawA2uiPart):
                    out.append(f"{A2UI_OPEN_TAG}{block.part.a2ui_raw}{A2UI_CLOSE_TAG}")
        return "".join(out)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        """Tokenizes response content into raw format-content parts.

        Args:
            content: The raw response content.

        Returns:
            A list of unwrapped RawResponsePart objects.
        """
        return cast(list[RawResponsePart], unwrap_response(content))

    def compile(self, format_content: str) -> list[AgentToRendererMessage]:
        """Validates and compiles raw A2UI JSON schema content.

        Args:
            format_content: The raw A2UI JSON string.

        Returns:
            A list of compiled A2UI messages.
        """
        json_data = parse_and_fix(format_content)
        # TODO: Leverage MessageProcessor to validate the json data.
        if self._validator:
            from a2ui.core import A2uiValidationError

            errs = self._validator(json_data)
            if isinstance(errs, list) and errs:
                raise A2uiValidationError(
                    f"Validation failed with {len(errs)} error(s)",
                    details=errs,
                )
        return cast(list[AgentToRendererMessage], json_data)

    @property
    def supports_streaming(self) -> bool:
        return True

    def parse_chunk(self, chunk: str, wrapped: bool = True) -> list[ResponsePart]:
        """Processes streamed token chunks incrementally."""
        from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser

        if not self._stream_parser:
            self._stream_parser = DirectJsonStreamParser(self._catalogs)
        return self._stream_parser.parse_chunk(chunk, wrapped=wrapped)

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles a structured A2UI payload into this format's raw notation."""
        return _DirectJsonDecompiler().decompile(a2ui_payload)
