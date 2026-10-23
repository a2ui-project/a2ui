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

"""Stage 2 of the playground: render one decision block through a mode.

`decision` compiles the block through `DecisionSynthesizer` with no further
model call. `express` and `direct` ask a model for that format's source with
the same intent and payload, then validate it through the format's processor.
`status_surface` turns footer and help text into a small A2UI surface, because
the sample clients render surfaces only.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
import json
import logging
import time
from typing import Any

from a2a.types import Part

from a2ui.a2a import create_a2ui_part
from a2ui.core import A2uiError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    DecisionBackend,
    DecisionBackendType,
    DecisionBlock,
    DecisionFormat,
    DecisionFormatFactory,
    DecisionRecord,
    DecisionSynthesizer,
    DeterministicMockBackend,
    JevHttpBackend,
    LocalCrossEncoderBackend,
    QuestionKind,
    StepZeroLogprobBackend,
    SynthesisConfig,
    SynthesisOutput,
)
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.parser import A2uiPart
from a2ui.parser.messages import to_message_dicts
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import to_version_number
from modes import LlmCaller, LlmTurn, RenderMode, RenderResult, TurnMetrics

logger = logging.getLogger(__name__)

_BACKEND_NAMES: dict[type, DecisionBackendType] = {
    DeterministicMockBackend: DecisionBackendType.MOCK,
    LocalCrossEncoderBackend: DecisionBackendType.LOCAL,
    JevHttpBackend: DecisionBackendType.JEV,
    StepZeroLogprobBackend: DecisionBackendType.STEP_ZERO,
}
_STAGE2_RETRIES = 1


def backend_display_name(backend: DecisionBackend) -> str:
    """The short name of a bundled backend (`mock`, `local`, ...) or its class name."""
    for cls, kind in _BACKEND_NAMES.items():
        if isinstance(backend, cls):
            return kind.value
    return type(backend).__name__


def stage2_user_text(block: DecisionBlock, surface_id: str) -> str:
    """The user message for an `express` or `direct` render of `block`."""
    payload = json.dumps(block.payload, indent=2)
    return (
        "Render this interface using the format rules in your instructions.\n"
        f"Intent: {block.intent}\n"
        f'Use surface id "{surface_id}".\n'
        "Bind only to the JSON pointers in this data model; do not invent other"
        " data:\n"
        f"```json\n{payload}\n```"
    )


def _record_line(record: DecisionRecord) -> str:
    """Formats one planner `DecisionRecord` as a single status line."""
    question = record.question
    if record.answer is None:
        winner = "unanswered"
    elif question.kind is QuestionKind.BOOLEAN:
        winner = f"yes p={record.answer.yes:.2f}"
    else:
        option, prob = record.answer.top()
        winner = f"{option} p={prob:.2f}"
    pieces = [f"`{question.id}`", winner]
    if record.threshold is not None:
        pieces.append(f"threshold {record.threshold:.2f}")
    if record.outcome:
        pieces.append(record.outcome)
    return " · ".join(pieces)


def trace_lines(output: SynthesisOutput) -> tuple[str, ...]:
    """One line per planner question in `output.trace` (empty when there is none)."""
    return tuple(_record_line(record) for record in output.trace)


def _express_literal(text: str) -> str:
    """Quotes `text` as an Express string literal (non-ASCII kept as is)."""
    return json.dumps(text, ensure_ascii=False)


@dataclass
class _Stage2Attempt:
    """One stage-2 model call and its validated result."""

    turn: LlmTurn
    parts: list[Part]
    error: str | None


class Renderers:
    """Renders decision blocks through every mode for a set of protocol versions."""

    def __init__(
        self,
        *,
        versions: Sequence[str],
        backend: DecisionBackend,
        config: SynthesisConfig | None = None,
    ) -> None:
        self._raw_backend = backend
        self._decision_factory = DecisionFormatFactory(
            backend=backend, config=config, fallback_card=True
        )
        self._processors: dict[tuple[RenderMode, str], A2uiRequestProcessor] = {}
        for version in versions:
            key = to_version_number(version)
            self._processors[(RenderMode.DECISION, key)] = self._build_processor(
                version, self._decision_factory
            )
            self._processors[(RenderMode.EXPRESS, key)] = self._build_processor(
                version, ExpressFormatFactory()
            )
            self._processors[(RenderMode.DIRECT, key)] = self._build_processor(
                version, DirectJsonFormatFactory()
            )

    @staticmethod
    def _build_processor(version: str, factory: Any) -> A2uiRequestProcessor:
        generator = A2uiGenerator(
            [CatalogConfig(BasicCatalog(version))], inference_format_factory=factory
        )
        return generator.create_processor({
            f"v{to_version_number(version)}": {
                "supportedCatalogIds": [
                    c.transformed_catalog.catalog_id for c in generator.catalogs
                ]
            }
        })

    @property
    def backend_name(self) -> str:
        """The decision backend's short name, from the backend passed in."""
        return backend_display_name(self._raw_backend)

    @property
    def versions(self) -> tuple[str, ...]:
        """Protocol version numbers this instance renders for."""
        return tuple(sorted({v for _, v in self._processors}))

    def processor(self, mode: RenderMode, version: str) -> A2uiRequestProcessor:
        """The processor for `mode` and `version`.

        Raises:
            KeyError: If `version` was not configured.
        """
        return self._processors[(mode, to_version_number(version))]

    def prompt_for(self, mode: RenderMode, version: str) -> str:
        """The stage-2 system instruction for `mode` (the format's own prompt)."""
        return self.processor(mode, version).prompt_snippet

    def _synthesizer(self, version: str) -> DecisionSynthesizer:
        fmt = self.processor(RenderMode.DECISION, version).format
        if not isinstance(fmt, DecisionFormat):
            raise TypeError(f"Expected a DecisionFormat, got {type(fmt).__name__}.")
        return fmt.synthesizer

    async def render_decision(
        self, block: DecisionBlock, *, surface_id: str, version: str
    ) -> RenderResult:
        """Compiles `block` with the decision synthesizer; no model call."""
        started = time.perf_counter()
        try:
            output = await self._synthesizer(version).synthesize(
                block.intent,
                block.payload,
                surface_id=surface_id,
                layout=block.layout or None,
            )
        except (A2uiError, ValueError) as exc:
            logger.warning("Decision render failed: %s", exc)
            return RenderResult(
                metrics=self._decision_metrics(None, started), error=str(exc)
            )
        parts = [
            create_a2ui_part(message, version=version)
            for message in to_message_dicts(output.messages)
        ]
        return RenderResult(
            parts=parts,
            metrics=self._decision_metrics(output, started),
            trace_lines=trace_lines(output),
            error=None if parts else "The decision model produced no surface.",
        )

    def _decision_metrics(
        self, output: SynthesisOutput | None, started: float
    ) -> TurnMetrics:
        plan = output.layout_plan if output is not None else None
        return TurnMetrics(
            mode=RenderMode.DECISION,
            backend=self.backend_name,
            llm_calls=0,
            latency_ms=(time.perf_counter() - started) * 1000.0,
            archetype=plan.archetype if plan is not None else None,
            confidence=output.confidence if output is not None else None,
            block_count=len(plan.blocks) if plan is not None else None,
            fallback=(
                str(output.fallback_source)
                if output is not None and output.fallback_source is not None
                else None
            ),
        )

    async def _call_and_parse(
        self,
        mode: RenderMode,
        version: str,
        llm: LlmCaller,
        user_text: str,
    ) -> _Stage2Attempt:
        """Makes one stage-2 call and validates its reply through the processor."""
        processor = self.processor(mode, version)
        turn = await llm(
            instruction_key=f"{mode}:{to_version_number(version)}",
            instruction=processor.prompt_snippet,
            user_text=user_text,
            session_id=None,
        )
        try:
            response_parts = processor.parse_response(turn.text)
        except (A2uiError, ValueError, json.JSONDecodeError) as exc:
            return _Stage2Attempt(turn=turn, parts=[], error=str(exc))
        parts = [
            create_a2ui_part(message, version=version)
            for part in response_parts
            if isinstance(part, A2uiPart)
            for message in to_message_dicts(part.a2ui)
        ]
        error = None if parts else "The reply contained no A2UI block."
        return _Stage2Attempt(turn=turn, parts=parts, error=error)

    async def render_with_llm(
        self,
        mode: RenderMode,
        block: DecisionBlock,
        *,
        surface_id: str,
        version: str,
        llm: LlmCaller,
    ) -> RenderResult:
        """Asks the model for `mode` source for `block`, retrying once on invalid output."""
        if mode is RenderMode.DECISION:
            raise ValueError("render_with_llm renders express or direct, not decision.")
        user_text = stage2_user_text(block, surface_id)
        attempts: list[_Stage2Attempt] = []
        for _ in range(_STAGE2_RETRIES + 1):
            attempt = await self._call_and_parse(mode, version, llm, user_text)
            attempts.append(attempt)
            if attempt.error is None:
                break
            user_text = (
                f"{stage2_user_text(block, surface_id)}\n\nYour previous reply was"
                f" invalid: {attempt.error} Reply again following the format rules"
                " exactly."
            )
        last = attempts[-1]
        metrics = TurnMetrics(
            mode=mode,
            backend="llm",
            llm_calls=len(attempts),
            latency_ms=sum(a.turn.latency_ms for a in attempts),
            prompt_tokens=sum(a.turn.prompt_tokens for a in attempts),
            output_tokens=sum(a.turn.output_tokens for a in attempts),
            fallback="validation_retry" if len(attempts) > 1 else None,
        )
        return RenderResult(parts=last.parts, metrics=metrics, error=last.error)

    def status_surface(
        self, lines: Sequence[str], *, surface_id: str, version: str
    ) -> list[Part]:
        """Renders `lines` as a small A2UI surface (a column of Markdown text)."""
        texts = ", ".join(f"Text({_express_literal(line)})" for line in lines) or (
            'Text("")'
        )
        source = f'surface("{surface_id}")\nroot = Column([{texts}])'
        parser = self.processor(RenderMode.EXPRESS, version).create_parser()
        messages = parser.compile(source)
        return [
            create_a2ui_part(message, version=version)
            for message in to_message_dicts(messages)
        ]

    async def aclose(self) -> None:
        """Closes the shared decision backend."""
        await self._decision_factory.aclose()
