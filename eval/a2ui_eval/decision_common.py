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

"""Common utilities, backend factories, and metadata aggregation for decision eval."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
import os
from pathlib import Path
from typing import Any

from a2ui.inference_formats.decision import (
    ActionSpec,
    BackendCapabilities,
    Calibration,
    DecisionAnswer,
    DecisionBackend,
    DecisionBatch,
    DecisionBlock,
    DeterministicMockBackend,
    SynthesisOutput,
    create_decision_backend,
)

DECISION_BACKEND_NAMES: tuple[str, ...] = (
    "mock",
    "jev",
    "gemini",
    "systemone",
    "step0",
)

DECISION_CLI_BACKEND_CHOICES: tuple[str, ...] = (
    "mock",
    "jev",
    "gemini",
    "systemone",
    "step0",
)

DEFAULT_P95_TARGETS_MS: dict[str, float] = {
    "systemone": 250.0,
    "jev": 250.0,
    "gemini": 500.0,
    "step0": 1500.0,
    "mock": 25.0,
}

FORCED_FIT_TARGET: float = 0.05
FALSE_NO_FIT_TARGET: float = 0.10

PARAPHRASE_PROMPT_TABLE: tuple[tuple[str, str], ...] = (
    (
        "What job is this surface doing for the person?",
        "Choose the primary user goal for this interface:",
    ),
    (
        "How costly is a mistake on this surface?",
        "Rate the consequence of an erroneous action here:",
    ),
    (
        "How urgently does the person need to act or notice?",
        "Score the time sensitivity of this information:",
    ),
    (
        (
            "Which registered template best fits this surface, or should a layout"
            " be composed?"
        ),
        "Select a matching static surface template or compose dynamically:",
    ),
    ("Which ", "Select the "),
    (" archetype best fits this surface?", " layout pattern for this payload:"),
    ("How prominent should ", "Rate the visual priority of "),
    ("Is there ", "Does the payload contain "),
    ("Should this surface ", "Does this view need to "),
    ("What tone fits ", "Pick the semantic tone for "),
    ("Which button is ", "Identify which action button is "),
    ("How should ", "Choose the presentation style for "),
    ("For the person looking at this, is ", "Determine whether "),
)

DECISION_METADATA_KEYS: tuple[str, ...] = (
    "decision_backend",
    "decision_backend_kind",
    "decision_model_id",
    "decision_stage",
    "decision_operation",
    "decision_latency_ms",
    "decision_calls",
    "decision_confidence",
    "decision_fit_score",
    "decision_cache_hit",
    "decision_family",
    "decision_archetype",
    "decision_template_id",
    "decision_block",
    "decision_blocks",
    "decision_answers",
    "decision_fallback_source",
    "decision_fallback_reason",
)

DEFAULT_DECISION_BLOCK_EXAMPLES: tuple[DecisionBlock, ...] = (
    DecisionBlock(
        surface_id="main",
        intent="Show host health metrics for prod-1",
        payload={
            "host": "prod-1",
            "cpu": 0.78,
            "cpuDelta": 0.12,
            "status": "degraded",
            "uptimeHours": 412,
        },
        layout=("headline:cpu,cpuDelta,status", "facts:host,uptimeHours"),
    ),
    DecisionBlock(
        surface_id="main",
        intent="Confirm wire transfer to Acme Corp before sending",
        payload={
            "recipient": "Acme Corp",
            "amount": 1500.0,
            "currency": "USD",
            "sourceAccount": "Checking ...4821",
        },
        actions=(
            ActionSpec(id="confirm_transfer", label="Confirm Transfer"),
            ActionSpec(id="cancel", label="Cancel"),
        ),
        layout=("facts:recipient,amount,sourceAccount", "actions:confirm_transfer"),
    ),
)


def is_transcrypt_ciphertext(path: str | Path) -> bool:
    """Returns whether `path` appears to hold encrypted Transcrypt ciphertext.

    Args:
        path: File path to inspect for OpenSSL salted ciphertext prefixes or
            non-UTF-8 binary header bytes.

    Returns:
        Whether the file exists and starts with a Transcrypt ciphertext header.
    """
    file_path = Path(path)
    if not file_path.is_file():
        return False
    try:
        prefix = file_path.read_bytes()[:16]
    except OSError:
        return False
    # OpenSSL salted ciphertexts start with base64 'U2FsdGVkX1' or raw 'Salted__'.
    if prefix.startswith(b"U2FsdGVkX1") or prefix.startswith(b"Salted__"):
        return True
    try:
        prefix.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def p95_target_for_backend(backend_kind: str) -> float:
    """Returns the default P95 latency target in milliseconds for `backend_kind`.

    Args:
        backend_kind: Canonical decision backend kind name.

    Returns:
        Target 95th-percentile latency in milliseconds.
    """
    return DEFAULT_P95_TARGETS_MS.get(backend_kind.strip().lower(), 250.0)


def rewrite_question_prompt(prompt: str) -> str:
    """Rewrites `prompt` deterministically using `PARAPHRASE_PROMPT_TABLE`.

    Args:
        prompt: Original decision question prompt text.

    Returns:
        Deterministically paraphrased question prompt text.
    """
    stripped = prompt.strip()
    if not stripped:
        return prompt
    updated = stripped
    for src, dst in PARAPHRASE_PROMPT_TABLE:
        if src in updated:
            updated = updated.replace(src, dst)
    # Fall back to a deterministic prefix when no table entry matched.
    if updated == stripped:
        body = stripped.rstrip("?.:")
        return f"Evaluate question: {body}."
    return updated


class ParaphraseDecisionBackend(DecisionBackend):
    """Wraps a `DecisionBackend` and rewrites every question prompt before scoring."""

    def __init__(self, inner: DecisionBackend) -> None:
        """Initializes the paraphrase wrapper around `inner`.

        Args:
            inner: Underlying decision backend that scores rewritten batches.
        """
        self._inner = inner

    @property
    def backend_kind(self) -> str:
        """Returns the underlying backend kind identifier."""
        return self._inner.backend_kind

    @property
    def model_id(self) -> str:
        """Returns the underlying backend model identifier."""
        return self._inner.model_id

    @property
    def capabilities(self) -> BackendCapabilities:
        """Returns the underlying backend capabilities."""
        return self._inner.capabilities

    @property
    def last_call_latency_ms(self) -> float | None:
        """Returns the most recent call latency in milliseconds, if recorded."""
        val = getattr(self._inner, "last_call_latency_ms", None)
        return float(val) if isinstance(val, (int, float)) else None

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Rewrites all question prompts in `batch` and delegates to `_inner`.

        Args:
            batch: Decision batch containing shared context and questions.

        Returns:
            Tuple of decision answers returned by the wrapped backend.
        """
        rewritten = tuple(
            replace(q, prompt=rewrite_question_prompt(q.prompt))
            for q in batch.questions
        )
        paraphrased_batch = DecisionBatch(
            shared_context=batch.shared_context,
            questions=rewritten,
        )
        return await self._inner.answer(paraphrased_batch)

    async def aclose(self) -> None:
        """Closes the wrapped backend across all event loops."""
        await self._inner.aclose()

    async def aclose_current_loop(self) -> None:
        """Closes resources bound to the active event loop on `_inner`."""
        await self._inner.aclose_current_loop()

    async def __aenter__(self) -> ParaphraseDecisionBackend:
        """Enters the async context manager."""
        return self

    async def __aexit__(self, *_: object) -> None:
        """Closes the wrapped backend on context exit."""
        await self.aclose()


def _has_jev_credentials(endpoint_url: str | None) -> bool:
    """Checks whether Jev credentials or an explicit endpoint URL exist.

    Args:
        endpoint_url: Optional explicit HTTP endpoint URL override.

    Returns:
        Whether sufficient endpoint or API key configuration is present.
    """
    if endpoint_url or os.environ.get("A2UI_DECISION_URL"):
        return True
    return bool(
        os.environ.get("JEV_API_KEY")
        or os.environ.get("TYPESAFE_API_KEY")
        or os.environ.get("A2UI_DECISION_AUTH")
        or os.environ.get("A2UI_DECISION_TOKEN")
    )


def _has_gemini_credentials(endpoint_url: str | None) -> bool:
    """Checks whether Gemini Decisions API credentials or an endpoint URL exist.

    Args:
        endpoint_url: Optional explicit HTTP endpoint URL override.

    Returns:
        Whether sufficient endpoint or API key configuration is present.
    """
    if endpoint_url or os.environ.get("A2UI_DECISION_URL"):
        return True
    return bool(
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("A2UI_DECISION_AUTH")
        or os.environ.get("A2UI_DECISION_TOKEN")
    )


def build_decision_backend(
    name: str | None = None,
    *,
    endpoint_url: str | None = None,
    model: str | None = None,
    calibration: Calibration | Path | None = None,
) -> DecisionBackend:
    """Instantiates a `DecisionBackend` explicitly or from `A2UI_DECISION_BACKEND`.

    Args:
        name: Optional backend preset name (`mock`, `jev`, `gemini`,
            `systemone`, or `step0`).
        endpoint_url: Optional endpoint URL override for HTTP backends.
        model: Optional model identifier override.
        calibration: Optional calibration profile instance or JSON path.

    Returns:
        Configured `DecisionBackend` instance.

    Raises:
        ValueError: If no backend is specified (neither `name` nor
            `A2UI_DECISION_BACKEND`), if `name` is unknown, or if required
            credentials are missing.
    """
    if name is None:
        return create_decision_backend(
            endpoint_url=endpoint_url,
            model=model,
            calibration=calibration,
        )
    clean = name.strip().lower()
    if clean not in DECISION_CLI_BACKEND_CHOICES:
        raise ValueError(
            f"Unknown decision backend: {name}. Expected one of"
            f" {DECISION_BACKEND_NAMES}"
        )
    if clean == "mock":
        return DeterministicMockBackend(model_id=model or "mock")
    if clean == "gemini":
        if not _has_gemini_credentials(endpoint_url):
            raise ValueError(
                "GEMINI_API_KEY or GOOGLE_API_KEY must be set in the environment"
                " to use the gemini decision backend"
            )
        return create_decision_backend(
            "gemini",
            endpoint_url=endpoint_url,
            model=model,
            calibration=calibration,
        )
    if clean in {"jev", "systemone"}:
        if not _has_jev_credentials(endpoint_url):
            raise ValueError(
                "JEV_API_KEY or TYPESAFE_API_KEY must be set in the environment"
                " to use the jev decision backend"
            )
        return create_decision_backend(
            clean,
            endpoint_url=endpoint_url,
            model=model,
            calibration=calibration,
        )
    return create_decision_backend(
        "step0",
        endpoint_url=endpoint_url,
        model=model,
        calibration=calibration,
    )


def _first_plan_info(
    outputs: Sequence[SynthesisOutput],
) -> tuple[str | None, str | None, str | None, list[str], float | None]:
    """Extracts `(family, archetype, template_id, block_ids, fit_score)` from `outputs`.

    Args:
        outputs: Sequence of synthesis outputs produced for a turn.

    Returns:
        Tuple of `(family, archetype, template_id, block_ids, fit_score)` from
        the first output with a template or layout plan.
    """
    for out in outputs:
        fit = out.layout_plan.fit_score if out.layout_plan is not None else None
        fam = out.layout_plan.family or None if out.layout_plan is not None else None
        if out.selected_template_id is not None:
            return fam, None, out.selected_template_id, [], fit
        if out.layout_plan is not None:
            return (
                fam,
                out.layout_plan.archetype or None,
                out.layout_plan.template_id,
                list(out.layout_plan.block_ids()),
                fit,
            )
    return None, None, None, [], None


def _first_fallback_info(
    outputs: Sequence[SynthesisOutput],
) -> tuple[str | None, str | None]:
    """Extracts `(fallback_source, fallback_reason)` from `outputs`.

    Args:
        outputs: Sequence of synthesis outputs produced for a turn.

    Returns:
        Tuple of `(fallback_source, fallback_reason)` for the first output
        that triggered a fallback, or `(None, None)`.
    """
    for out in outputs:
        if out.fallback_source is not None or out.fallback_reason is not None:
            source = (
                getattr(out.fallback_source, "value", str(out.fallback_source))
                if out.fallback_source is not None
                else None
            )
            return source, out.fallback_reason
    return None, None


def decision_metadata(
    outputs: Sequence[SynthesisOutput],
    *,
    backend_name: str,
    block: DecisionBlock | None = None,
) -> dict[str, Any]:
    """Aggregates metrics and diagnostics from synthesized outputs into task metadata.

    Args:
        outputs: Sequence of synthesis outputs produced for a turn.
        backend_name: Logical backend label configured for the evaluation run.
        block: Optional parsed `DecisionBlock` from the first `<a2ui>` fence.

    Returns:
        Dictionary mapping `DECISION_METADATA_KEYS` to aggregated turn metrics.
    """
    latency_ms = sum(out.decision_latency_ms for out in outputs)
    calls = sum(out.decision_calls for out in outputs)
    confidence = min((out.confidence for out in outputs), default=0.0)
    first = outputs[0] if outputs else None
    stage = first.stage.value if first is not None else None
    operation = first.operation.value if first is not None else None
    cache_hit = any(out.cache_hit for out in outputs)
    backend_kind = (
        first.backend_kind if first is not None and first.backend_kind else ""
    ) or backend_name
    model_id = first.model_id if first is not None else ""
    family, archetype, template_id, blocks, fit_score = _first_plan_info(outputs)
    fallback_source, fallback_reason = _first_fallback_info(outputs)
    answers_count = sum(len(out.decision_answers) for out in outputs)
    block_dict = block.to_json() if block is not None else None
    return {
        "decision_backend": backend_name,
        "decision_backend_kind": backend_kind,
        "decision_model_id": model_id,
        "decision_stage": stage,
        "decision_operation": operation,
        "decision_latency_ms": latency_ms,
        "decision_calls": calls,
        "decision_confidence": confidence,
        "decision_fit_score": fit_score,
        "decision_cache_hit": cache_hit,
        "decision_family": family,
        "decision_archetype": archetype,
        "decision_template_id": template_id,
        "decision_block": block_dict,
        "decision_blocks": blocks,
        "decision_answers": answers_count,
        "decision_fallback_source": fallback_source,
        "decision_fallback_reason": fallback_reason,
    }
