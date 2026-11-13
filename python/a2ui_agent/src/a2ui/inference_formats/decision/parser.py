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
from typing import TYPE_CHECKING, Any

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import A2uiError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats.direct_json.blocks import clean
from a2ui.inference_formats.direct_json.json_reader import read_json
from a2ui.parser import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
    BlockLexer,
    Parser,
    RawA2uiPart,
    RawResponsePart,
    TextPart,
)
from a2ui.parser.messages import to_message_models

from .decision_block import DecisionBlock, decision_block_from_messages
from .models import DecisionBackendError, SurfaceOperation, SynthesisOutput
from .prompt_generator import DecisionPromptGenerator
from .synthesizer import DecisionSynthesizer

if TYPE_CHECKING:
    from a2ui.utils import RendererState

_ABSTAIN_HELP = "Add a 'fallbackDsl' field or configure fallback_fn on the synthesizer."


def surface_operation_for(
    block: DecisionBlock, state: RendererState | None, surface_id: str
) -> tuple[SurfaceOperation, bool]:
    """Decides how a block changes `surface_id`, from the renderer state.

    Returns:
        The operation (`REPLACE` when the block asks for it and the surface
        exists, `UPDATE_ROOT` when the surface exists, else `CREATE`) and
        whether the existing surface was created with `sendDataModel`.
    """
    surface = state.get_surface(surface_id) if state is not None else None
    if surface is None:
        return SurfaceOperation.CREATE, False
    operation = (
        SurfaceOperation.REPLACE if block.replace else SurfaceOperation.UPDATE_ROOT
    )
    return operation, bool(surface.send_data_model)


class DecisionParser(Parser):
    """Compiles `<a2ui>` decision blocks through a `DecisionSynthesizer`.

    `compile` is synchronous by the `Parser` contract, so synthesis runs via
    `DecisionSynthesizer.synthesize_sync`, which works with or without a
    running event loop on the calling thread.

    `parse_response` and `open_stream` go through `_apply_block`, which this
    parser overrides to read the `RendererState` before synthesis: a block
    whose surface already exists updates its root in place, or replaces it
    when the block sets `replace`. `compile` has no state and always creates.

    Multiple blocks without `surfaceId` behave according to how they are
    grouped: a JSON array of `N` blocks inside a single `<a2ui>` tag auto-numbers
    its default surface IDs as ``<surface_id>_1`` through ``<surface_id>_N``,
    whereas separate `<a2ui>` tags in the same response each target
    `<surface_id>` sequentially (creating on the first tag and updating in
    place on subsequent tags).

    Attributes:
        surface_id: Default surface identifier when a block omits `surfaceId`.
    """

    def __init__(
        self,
        synthesizer: DecisionSynthesizer,
        surface_id: str = "main",
        *,
        conversation_state: RendererState | None = None,
    ) -> None:
        """Creates a parser.

        Args:
            synthesizer: The synthesizer that renders each block.
            surface_id: Surface used when a block names none. A block's own
                `surfaceId` wins; `SynthesisConfig.default_surface_id` is not
                consulted on this path.
            conversation_state: State used when a call passes none, so
                surfaces persist across turns of one conversation. When None,
                such calls get a new empty state, as with other formats.
        """
        self._synthesizer = synthesizer
        self.surface_id = surface_id
        self._conversation_state = conversation_state
        self._last_output: SynthesisOutput | None = None

    @property
    def last_output(self) -> SynthesisOutput | None:
        """The `SynthesisOutput` of the most recently synthesized block, if any."""
        return self._last_output

    @property
    def synthesizer(self) -> DecisionSynthesizer:
        """The synthesizer this parser renders blocks with."""
        return self._synthesizer

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs the synthesizer selects from."""
        return list(self._synthesizer.graph.catalogs)

    def _empty_state(self) -> RendererState:
        """Returns the conversation's state, or a new empty one."""
        if self._conversation_state is not None:
            return self._conversation_state
        return super()._empty_state()

    def _default_surface_id(self, idx: int, count: int) -> str:
        """Returns `surface_id` for a single block or ``<surface_id>_<idx>`` for an array."""
        return self.surface_id if count == 1 else f"{self.surface_id}_{idx}"

    def _synthesize_block_sync(
        self,
        block: DecisionBlock,
        default_id: str,
        format_content: str,
        state: RendererState | None,
    ) -> SynthesisOutput:
        """Synthesizes one block, mapping failures to compilation errors."""
        target = block.surface_id or default_id
        if block.replace and state is not None:
            self._synthesizer.plan_cache.invalidate(state, target)
        operation, sends_data_model = surface_operation_for(block, state, target)
        try:
            output = self._synthesizer.synthesize_sync(
                block.intent,
                block.payload,
                operation=operation,
                surface_sends_data_model=sends_data_model,
                state=state,
                **block.to_synthesis_kwargs(default_surface_id=default_id),
            )
        except DecisionBackendError as exc:
            raise _as_compilation_error(exc, format_content) from exc
        except A2uiError:
            raise
        except Exception as exc:
            raise _as_compilation_error(exc, format_content) from exc
        _require_messages(output, format_content)
        self._last_output = output
        return output

    def _apply_block(
        self, format_content: str, is_final: bool, state: RendererState
    ) -> tuple[list[AgentToRendererMessage], list[str]]:
        """Synthesizes each block against `state`, then applies its messages.

        Each block's surface is looked up in `state` before synthesis (see
        `surface_operation_for`), and its messages are applied before the
        next block is synthesized.
        """
        del is_final
        messages: list[AgentToRendererMessage] = []
        touched: list[str] = []
        blocks = self._extract_blocks(format_content)
        for idx, block in enumerate(blocks, start=1):
            default_id = self._default_surface_id(idx, len(blocks))
            output = self._synthesize_block_sync(
                block, default_id, format_content, state
            )
            for surface_id in state.apply(output.messages):
                if surface_id not in touched:
                    touched.append(surface_id)
            messages.extend(output.messages)
        return to_message_models(messages), touched

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

    def read_blocks(self, format_content: str) -> list[DecisionBlock]:
        """Parses the JSON body of a block into one or more decision blocks."""
        try:
            parsed: Any = read_json(clean(format_content))
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

    _read_blocks = read_blocks

    def _extract_blocks(self, format_content: str) -> list[DecisionBlock]:
        """Extracts `DecisionBlock`s from `<a2ui>` tags or raw JSON content."""
        raw_parts = [
            part.part.a2ui_raw
            for part in self.unwrap(format_content)
            if isinstance(part.part, RawA2uiPart)
        ]
        if not raw_parts:
            return self.read_blocks(format_content)
        blocks: list[DecisionBlock] = []
        for raw in raw_parts:
            blocks.extend(self.read_blocks(raw))
        return blocks

    async def synthesize_blocks(
        self, format_content: str, *, default_surface_id: str | None = None
    ) -> list[SynthesisOutput]:
        """Synthesizes `SynthesisOutput`s for every decision block in `format_content`.

        Accepts either raw block JSON or text containing `<a2ui>` decision tags.

        Raises:
            A2uiCompilationParseError: If the block is not valid JSON.
            A2uiCompilationValidationError: If a block lacks required fields or
                the synthesizer rejects it.
            A2uiCompilationError: If the decision model abstains and no
                fallback produced any messages, or the decision backend
                fails or times out.
        """
        blocks = self._extract_blocks(format_content)
        outputs: list[SynthesisOutput] = []
        base_surface_id = (
            default_surface_id if default_surface_id is not None else self.surface_id
        )
        for idx, block in enumerate(blocks, start=1):
            default_id = (
                base_surface_id if len(blocks) == 1 else f"{base_surface_id}_{idx}"
            )
            try:
                output = await self._synthesizer.synthesize(
                    block.intent,
                    block.payload,
                    **block.to_synthesis_kwargs(default_surface_id=default_id),
                )
            except A2uiError:
                raise
            except Exception as exc:
                raise _as_compilation_error(exc, format_content) from exc
            _require_messages(output, format_content)
            outputs.append(output)
        return outputs

    def compile(
        self, format_content: str, *, is_final: bool = True
    ) -> list[AgentToRendererMessage]:
        """Synthesizes the messages for every decision block in `format_content`.

        With no renderer state, every block creates its surface.

        Raises:
            A2uiCompilationParseError: If the block is not valid JSON.
            A2uiCompilationValidationError: If a block lacks required fields or
                the synthesizer rejects it.
            A2uiCompilationError: If the decision model abstains and no
                fallback produced any messages.
        """
        del is_final
        messages_by_surface: dict[str, list[AgentToRendererMessage]] = {}
        blocks = self._extract_blocks(format_content)
        for idx, block in enumerate(blocks, start=1):
            default_id = self._default_surface_id(idx, len(blocks))
            output = self._synthesize_block_sync(
                block, default_id, format_content, None
            )
            messages_by_surface[block.surface_id or default_id] = list(output.messages)
        return [
            msg for surface_msgs in messages_by_surface.values() for msg in surface_msgs
        ]

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Renders messages as a wrapped decision block.

        Lossy: messages carry no intent, so a synthetic `Render <surface>`
        intent is used and only the data model and surface id are recovered.
        """
        return DecisionPromptGenerator.wrap_block(
            decision_block_from_messages(a2ui_payload)
        )


def _as_compilation_error(exc: Exception, format_content: str) -> A2uiError:
    """Maps a non-A2UI synthesis failure to the error the parser raises.

    Bad block values become validation errors. A
    `DecisionBackendError` (timeout or transport failure) becomes a
    compilation error naming the backend; no fallback runs for it.
    """
    if isinstance(exc, DecisionBackendError):
        return A2uiCompilationError(
            message=(
                f"The decision backend {exc.backend_kind!r} (model"
                f" {exc.model_id!r}) failed: {exc}"
            ),
            raw_content=format_content,
            help_message="Check the decision backend's endpoint and timeout.",
        )
    if isinstance(exc, (TypeError, ValueError)):
        return A2uiCompilationValidationError(
            message=str(exc), raw_content=format_content
        )
    return A2uiCompilationError(f"Failed to compile A2UI block: {exc}", format_content)


def _require_messages(output: SynthesisOutput, format_content: str) -> None:
    """Raises when synthesis produced no messages (abstention with no fallback)."""
    if output.messages:
        return
    raise A2uiCompilationError(
        message=(
            "The decision model abstained"
            f" (confidence {output.confidence:.2f}) and no fallback produced"
            " messages."
        ),
        raw_content=format_content,
        help_message=_ABSTAIN_HELP,
    )


__all__ = ["DecisionParser", "surface_operation_for"]
