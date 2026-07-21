# Copyright 2026 Google LLC
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

from typing import Any, List, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.parser.parser import Parser

try:
    from google.adk.utils.feature_decorator import experimental
except ImportError:

    def experimental(cls):
        return cls


from a2ui.schema.constants import A2UI_INFERENCE_OPEN_TAG, A2UI_INFERENCE_CLOSE_TAG
from .compiler import AtomCompiler
from .decompiler import AtomDecompiler


@experimental
class AtomParser(Parser):
    """Parses, unwraps, compiles, and decompiles A2UI Atom S-expression responses.

    Attributes:
        catalog: The component catalog containing element definitions.
        surface_id: The target surface identifier.
    """

    def __init__(
        self, catalog: Union[Catalog[Any, Any], A2uiCatalog], surface_id: str = "main"
    ):
        """Initializes an AtomParser instance.

        Args:
            catalog: The component catalog containing element definitions.
            surface_id: The target surface identifier. Defaults to "main".
        """
        self.catalog = catalog
        self.surface_id = surface_id

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

    def unwrap(self, content: str) -> List[ResponsePart]:
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
        return lexer.tokenize(content)

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> List[dict[str, Any]]:
        """Compiles raw Atom S-expression syntax into structured A2UI JSON messages.

        Args:
            format_content: The raw Atom format text string to compile.
            is_final: Whether this is the final stream chunk.

        Returns:
            A list of compiled A2UI JSON surface update payloads.

        Raises:
            A2uiCompilationError: If compilation or token parsing fails.
        """
        from a2ui.parser.errors import A2uiCompilationError

        compiler = AtomCompiler(self.catalog)
        try:
            compiled_json = compiler.compile(
                format_content, surface_id=self.surface_id, is_final=is_final
            )
            return [compiled_json]
        except Exception as e:
            raise A2uiCompilationError(
                message=str(e),
                raw_content=format_content,
                help_message=(
                    "Please correct the syntax error in your Atom S-Expression."
                ),
            ) from e

    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles a structured A2UI JSON payload into Atom S-expression syntax.

        Args:
            val: The A2UI JSON message payload dictionary.

        Returns:
            The decompiled Atom S-expression text.
        """
        return AtomDecompiler(self.catalog).decompile(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps decompiled Atom S-expression blocks within <a2ui> sentinel tags.

        Args:
            blocks: A list of decompiled S-expression string blocks.

        Returns:
            The formatted text block enclosed in sentinel tags.
        """
        return AtomDecompiler(self.catalog).wrap_decompiled_blocks(blocks)
