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

"""Parser that turns decision blocks in LLM output into A2UI messages."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import A2uiError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    BlockLexer,
    Parser,
    RawA2uiPart,
    RawResponsePart,
    TextPart,
    parse_and_fix,
)

from .decision_block import DecisionBlock, decision_block_from_messages
from .models import SynthesisStage
from .prompt_generator import DecisionPromptGenerator
from .synthesizer import DecisionSynthesizer


class DecisionParser(Parser):
    """Compiles `<a2ui>` decision blocks through a `DecisionSynthesizer`.

    `compile` is synchronous by the `Parser` contract, so synthesis runs via
    `DecisionSynthesizer.synthesize_sync`, which works with or without a
    running event loop on the calling thread.
    """

    def __init__(
        self,
        synthesizer: DecisionSynthesizer,
        surface_id: str = "main",
    ) -> None:
        """Creates a parser.

        Args:
            synthesizer: The synthesizer that renders each block.
            surface_id: Surface used when a block names none. A block's own
                `surfaceId` wins; `SynthesisConfig.default_surface_id` is not
                consulted on this path.
        """
        self._synthesizer = synthesizer
        self.surface_id = surface_id

    @property
    def synthesizer(self) -> DecisionSynthesizer:
        """The synthesizer this parser renders blocks with."""
        return self._synthesizer

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs the synthesizer selects from."""
        return list(self._synthesizer.graph.catalogs)

    def has_format_content(self, content: str, complete: bool = False) -> bool:
        """Checks whether `content` contains a decision block."""
        for part in self.unwrap(content):
            if isinstance(part.part, RawA2uiPart) and (not complete or part.is_final):
                return True
        return False

    def wrap(self, blocks: Sequence[RawResponsePart]) -> str:
        """Wraps text and raw decision blocks into one LLM-formatted string."""
        parts: list[str] = []
        for block in blocks:
            inner = block.part if isinstance(block, RawResponsePart) else block
            if isinstance(inner, TextPart):
                parts.append(inner.text)
            elif isinstance(inner, RawA2uiPart):
                parts.append(
                    f"{A2UI_INFERENCE_OPEN_TAG}\n{inner.a2ui_raw}\n{A2UI_INFERENCE_CLOSE_TAG}"
                )
        return "\n".join(parts)

    def unwrap(self, content: str) -> list[RawResponsePart]:
        """Splits LLM output into text and raw decision block parts."""
        lexer = BlockLexer(
            open_tag=A2UI_INFERENCE_OPEN_TAG,
            close_tag=A2UI_INFERENCE_CLOSE_TAG,
            string_delimiters={'"'},
        )
        return lexer.tokenize(content)

    def _read_blocks(self, format_content: str) -> list[DecisionBlock]:
        """Parses the JSON body of a block into one or more decision blocks."""
        try:
            parsed: Any = parse_and_fix(format_content)
        except Exception as exc:
            raise A2uiCompilationParseError(
                message=f"Decision block is not valid JSON: {exc}",
                raw_content=format_content,
                help_message=(
                    "Emit one JSON object with 'intent' and 'payload' fields inside"
                    " the <a2ui> tags."
                ),
            ) from exc
        items = parsed if isinstance(parsed, list) else [parsed]
        blocks: list[DecisionBlock] = []
        for item in items:
            if not isinstance(item, Mapping):
                raise A2uiCompilationValidationError(
                    message="Each decision block must be a JSON object.",
                    raw_content=format_content,
                )
            try:
                blocks.append(DecisionBlock.from_mapping(item))
            except (TypeError, ValueError) as exc:
                raise A2uiCompilationValidationError(
                    message=str(exc), raw_content=format_content
                ) from exc
        return blocks

    def compile(self, format_content: str) -> list[AgentToRendererMessage]:
        """Synthesizes the messages for every decision block in `format_content`.

        Raises:
            A2uiCompilationParseError: If the block is not valid JSON.
            A2uiCompilationValidationError: If a block lacks required fields or
                the synthesizer rejects it.
            A2uiCompilationError: If the decision model abstains and no
                fallback produced any messages.
        """
        messages: list[AgentToRendererMessage] = []
        for block in self._read_blocks(format_content):
            try:
                output = self._synthesizer.synthesize_sync(
                    block.intent,
                    block.payload,
                    surface_id=block.surface_id or self.surface_id,
                    template_id=block.template_id,
                    fallback_dsl=block.fallback_dsl,
                )
            except A2uiError:
                raise
            except (TypeError, ValueError) as exc:
                raise A2uiCompilationValidationError(
                    message=str(exc), raw_content=format_content
                ) from exc
            if not output.messages:
                raise A2uiCompilationError(
                    message=(
                        "The decision model abstained"
                        f" (confidence {output.confidence:.2f}) and no fallback"
                        " produced messages."
                    ),
                    raw_content=format_content,
                    help_message=(
                        "Add a 'fallbackDsl' field, name a 'template', or enable"
                        " fallback_card on the synthesizer."
                    ),
                )
            assert output.stage in SynthesisStage
            messages.extend(output.messages)
        return messages

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Renders messages as a wrapped decision block.

        Lossy: messages carry no intent, so the block's `intent` is empty and
        only the data model and surface id are recovered.
        """
        return DecisionPromptGenerator.wrap_block(
            decision_block_from_messages(a2ui_payload)
        )


__all__ = ["DecisionParser"]
