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

"""Parser utilities to extract and compile A2UI Express DSL from LLM responses."""

from collections.abc import Sequence
from typing import Type

from google.adk.utils.feature_decorator import experimental

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import check_mixed_catalogs
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    Parser,
    ResponsePart,
)
from a2ui.schema.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG

from .compiler import ExpressCompiler
from .decompiler import ExpressDecompiler
from .errors import ExpressParseError, ExpressValidationError


def _compilation_error_class(error: BaseException) -> Type[A2uiCompilationError]:
    """Picks the compilation error the compiler's failure belongs under.

    The compiler sorts its own failures into two families, so the choice is a
    type test rather than a reading of the message. A failure in neither family
    has no category to carry, and is reported as a plain compilation error.

    Args:
        error: The exception the compiler raised.

    Returns:
        The A2uiCompilationError subclass to raise in its place.
    """
    if isinstance(error, ExpressValidationError):
        return A2uiCompilationValidationError
    if isinstance(error, (SyntaxError, ExpressParseError)) or isinstance(
        error.__cause__, SyntaxError
    ):
        return A2uiCompilationParseError
    return A2uiCompilationError


@experimental
class ExpressParser(Parser):
    """Concrete parser implementation for A2UI Express DSL responses."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
        version: str | None = None,
    ):
        """Initializes the Express parser with one or more catalogs and target version.

        Args:
            catalogs: A sequence of catalogs.
            surface_id: Surface identifier for compiled messages.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
                Defaults to the version that the catalogs target.
        """
        self._catalogs = check_mixed_catalogs(catalogs)
        self.surface_id = surface_id
        self.version = version

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs the parser holds, in the order it received them."""
        return list(self._catalogs)

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        """Checks whether the given content string contains A2UI Express sentinel tags.

        Args:
            content: The text content to inspect.
            complete: Whether to require both opening and closing sentinel tags.

        Returns:
            True if Express format tags are detected; False otherwise.
        """
        if complete:
            return (
                A2UI_INFERENCE_OPEN_TAG in content
                and A2UI_INFERENCE_CLOSE_TAG in content
            )
        return A2UI_INFERENCE_OPEN_TAG[:-1] in content

    def unwrap(self, content: str) -> list[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Express DSL parts."""
        from a2ui.parser.lexer import BlockLexer

        lexer = BlockLexer(
            open_tag=A2UI_INFERENCE_OPEN_TAG,
            close_tag=A2UI_INFERENCE_CLOSE_TAG,
            string_delimiters={"'", '"'},
            single_line_comments={"#"},
        )
        return lexer.tokenize(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> list[AgentToRendererMessage]:
        """Compiles raw Express DSL to structured A2UI messages."""
        compiler = ExpressCompiler(self._catalogs, version=self.version)
        try:
            return compiler.compile(
                format_content, surface_id=self.surface_id, is_final=is_final
            )
        except (SyntaxError, ValueError) as e:
            orig_err = e
            if isinstance(e, ValueError) and isinstance(e.__cause__, SyntaxError):
                orig_err = e.__cause__
            line = getattr(orig_err, "lineno", None)
            column = getattr(orig_err, "offset", None)
            help_msg = (
                getattr(e, "help_message", None)
                or "Please correct the syntax error in your Express DSL."
            )
            details = getattr(e, "details", None)
            raise _compilation_error_class(e)(
                message=str(e),
                raw_content=format_content,
                line=line,
                column=column,
                help_message=help_msg,
                details=details,
            ) from e

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles structured A2UI payload messages into this format's raw notation."""
        return ExpressDecompiler(self._catalogs).decompile(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps multiple decompiled blocks with the format's enclosing tags/markers."""
        return ExpressDecompiler(self._catalogs).wrap_decompiled_blocks(blocks)
