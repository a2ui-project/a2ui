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

from google.adk.utils.feature_decorator import experimental

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_dsl_catalogs
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    Parser,
    ResponsePart,
)
from a2ui.parser.lexer import BlockLexer
from a2ui.schema.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG

from .compiler import AtomCompiler
from .decompiler import AtomDecompiler


@experimental
class AtomParser(Parser):
    """Parses, unwraps, compiles, and decompiles A2UI Atom S-expression responses.

    Attributes:
        catalogs: The sequence of active catalogs.
        surface_id: The target surface identifier.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
    ):
        """Initializes an AtomParser instance.

        Args:
            catalogs: A sequence of catalogs containing element definitions.
            surface_id: The target surface identifier. Defaults to "main".

        Raises:
            A2uiCatalogError: If no catalog is given, two catalogs share an
                ID, the catalogs target different protocol versions, or there
                are several catalogs and they target a version before v1.0.
        """
        self._catalogs = check_dsl_catalogs(catalogs)
        self.surface_id = surface_id

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs the parser holds, in the order it received them."""
        return list(self._catalogs)

    @catalogs.setter
    def catalogs(self, value: Sequence[CatalogApi]) -> None:
        self._catalogs = check_dsl_catalogs(value)

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
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

    def unwrap(self, content: str) -> list[ResponsePart]:
        """Tokenizes response content into raw Atom blocks and text parts.

        Args:
            content: The raw LLM text response.

        Returns:
            A list of tokenized response parts.
        """
        lexer = BlockLexer(
            open_tag=A2UI_INFERENCE_OPEN_TAG,
            close_tag=A2UI_INFERENCE_CLOSE_TAG,
            string_delimiters={"'": "'", '"': '"'},
            single_line_comments={";;", "#"},
        )
        return lexer.tokenize(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> list[AgentToRendererMessage]:
        """Compiles raw Atom S-expression syntax into structured A2UI messages.

        Args:
            format_content: The raw Atom format text string to compile.
            is_final: Whether this is the final stream chunk. Atom compiles
                each complete block, so the flag does not change the result.

        Returns:
            A list of compiled AgentToRendererMessage payloads.

        Raises:
            A2uiCompilationError: If compilation or token parsing fails.
        """
        del is_final  # Part of the Parser interface; see Args.
        try:
            return AtomCompiler(self._catalogs).compile(
                format_content, surface_id=self.surface_id
            )
        except Exception as e:
            err_cls = A2uiCompilationError
            if isinstance(e, SyntaxError):
                err_cls = A2uiCompilationParseError
            elif isinstance(e, ValueError):
                err_cls = A2uiCompilationValidationError
            raise err_cls(
                message=str(e),
                raw_content=format_content,
                help_message=(
                    "Please correct the syntax error in your Atom S-Expression."
                ),
            ) from e

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles structured A2UI messages into Atom S-expression syntax.

        Args:
            a2ui_payload: A sequence of A2UI AgentToRendererMessage payloads.

        Returns:
            The decompiled Atom S-expression text.
        """
        return AtomDecompiler(self._catalogs).decompile(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps decompiled Atom S-expression blocks within <a2ui> sentinel tags.

        Args:
            blocks: A list of decompiled S-expression string blocks.

        Returns:
            The formatted text block enclosed in sentinel tags.
        """
        return AtomDecompiler(self._catalogs).wrap_decompiled_blocks(blocks)
