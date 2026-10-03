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

"""Parser utilities to extract and compile A2UI Atom S-Expressions from LLM responses."""

from collections.abc import Sequence
from typing import Any, cast

try:
    from google.adk.utils.feature_decorator import experimental
except ImportError:

    def experimental(cls):
        return cls


from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import (
    Parser,
    RawA2uiPart,
    RawResponsePart,
    TextPart,
)
from a2ui.schema.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG


from .compiler import AtomCompiler
from .decompiler import AtomDecompiler


@experimental
class AtomParser(Parser):
    """Parses, unwraps, compiles, and decompiles A2UI Atom S-expression responses.

    Attributes:
        catalog: The component catalog containing element definitions.
        surface_id: The target surface identifier.
    """

    def __init__(self, catalog: CatalogApi, surface_id: str = "main"):
        """Initializes an AtomParser instance.

        Args:
            catalog: The component catalog containing element definitions.
            surface_id: The target surface identifier. Defaults to "main".
        """
        self.catalog = catalog
        self.surface_id = surface_id

    def has_format_content(self, content: str, complete: bool = False) -> bool:
        """Determines whether content contains Atom format sentinel tags.

        Args:
            content: The text response content to inspect.
            complete: Whether to require both open and close sentinel tags.

        Returns:
            True if format content is detected, False otherwise.
        """
        if complete:
            return (
                A2UI_INFERENCE_OPEN_TAG in content
                and A2UI_INFERENCE_CLOSE_TAG in content
            )
        return A2UI_INFERENCE_OPEN_TAG[:-1] in content

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Wraps interleaved text and raw A2UI blocks into a unified response string."""
        out: list[str] = []
        for block in blocks:
            inner = block.part if isinstance(block, RawResponsePart) else block
            if isinstance(inner, RawA2uiPart):
                out.append(
                    f"{A2UI_INFERENCE_OPEN_TAG}\n{inner.a2ui_raw}\n{A2UI_INFERENCE_CLOSE_TAG}"
                )
            elif isinstance(inner, TextPart):
                out.append(inner.text or "")
            elif isinstance(inner, str):
                out.append(inner)
        return "\n".join(out)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        """Tokenizes response content into raw Atom blocks and text parts.

        Args:
            content: The raw LLM text response.

        Returns:
            A list of tokenized response parts.
        """
        from a2ui.parser.lexer import BlockLexer

        lexer = BlockLexer(
            open_tag=A2UI_INFERENCE_OPEN_TAG,
            close_tag=A2UI_INFERENCE_CLOSE_TAG,
            string_delimiters={"'": "'", '"': '"'},
            single_line_comments={";;", "#"},
        )
        return cast(list[RawResponsePart], lexer.tokenize(content))

    def compile(self, format_content: str) -> list[AgentToRendererMessage]:
        """Compiles raw Atom S-expression syntax into structured A2UI JSON messages.

        Args:
            format_content: The raw Atom format text string to compile.

        Returns:
            A list of compiled A2UI JSON surface update payloads.

        Raises:
            A2uiCompilationError: If compilation or token parsing fails.
        """
        from a2ui.parser.errors import A2uiCompilationError

        compiler = AtomCompiler(self.catalog)
        try:
            compiled_json = compiler.compile(format_content, surface_id=self.surface_id)
            return cast(list[AgentToRendererMessage], [compiled_json])
        except Exception as e:
            raise A2uiCompilationError(
                message=str(e),
                raw_content=format_content,
                help_message=(
                    "Please correct the syntax error in your Atom S-Expression."
                ),
            ) from e

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles a structured A2UI JSON payload into Atom S-expression syntax.

        Args:
            a2ui_payload: The A2UI JSON message payload sequence.

        Returns:
            The decompiled Atom S-expression text.
        """
        return AtomDecompiler(self.catalog).decompile(a2ui_payload)
