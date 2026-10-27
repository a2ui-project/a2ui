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
from typing import Any

from a2ui.inference_formats.decision import (
    DecisionBackend,
    DecisionBlock,
    DeterministicMockBackend,
    JevHttpBackend,
    SynthesisOutput,
    create_decision_backend,
)

DECISION_BACKEND_NAMES: tuple[str, ...] = ("mock", "jev", "step0")

DECISION_METADATA_KEYS: tuple[str, ...] = (
    "decision_backend",
    "decision_latency_ms",
    "decision_calls",
    "decision_confidence",
    "decision_archetype",
    "decision_answers",
    "decision_fallback_source",
)


def build_decision_backend(
    name: str | None = None,
    *,
    endpoint_url: str | None = None,
) -> DecisionBackend:
    """Instantiates a DecisionBackend by short name ('mock', 'jev', 'step0').

    When `name` is None, `create_decision_backend()` reads from the environment.

    Raises:
        ValueError: If `name` is not in `DECISION_BACKEND_NAMES`.
    """
    if name is None:
        return create_decision_backend()
    if name == "mock":
        return DeterministicMockBackend()
    if name == "jev":
        import os

        if not os.environ.get("JEV_API_KEY") and not os.environ.get("TYPESAFE_API_KEY"):
            raise ValueError(
                "JEV_API_KEY or TYPESAFE_API_KEY must be set in the environment"
                " to use the jev decision backend"
            )
        return create_decision_backend(
            "jev",
            endpoint_url=endpoint_url or "https://api.typesafe.ai/v1/systemone",
        )
    if name == "step0":
        return create_decision_backend("step0", endpoint_url=endpoint_url)
    raise ValueError(
        f"Unknown decision backend: {name}. Expected one of {DECISION_BACKEND_NAMES}"
    )


def decision_metadata(
    outputs: Sequence[SynthesisOutput],
    *,
    backend_name: str,
    block: DecisionBlock | None = None,
) -> dict[str, Any]:
    """Aggregates metrics and diagnostics from synthesized outputs into task metadata.

    Args:
        outputs: Sequence of `SynthesisOutput` instances from synthesizing blocks.
        backend_name: Short name of the decision backend ('mock', 'local', 'jev').
        block: Optional parsed `DecisionBlock` for additional context.

    Returns:
        Mapping of metadata keys conforming to `DECISION_METADATA_KEYS`.
    """
    del block
    latency_ms = sum(out.decision_latency_ms for out in outputs)
    calls = sum(out.decision_calls for out in outputs)
    confidence = min((out.confidence for out in outputs), default=0.0)
    archetype: str | None = None
    fallback_source: str | None = None
    answers_count = 0
    for out in outputs:
        answers_count += len(out.decision_answers)
        if archetype is None and out.layout_plan is not None:
            archetype = out.layout_plan.archetype
        elif (
            archetype is None
            and out.component_tree_spec
            and "archetype" in out.component_tree_spec
        ):
            archetype = str(out.component_tree_spec["archetype"])
        if fallback_source is None and out.fallback_source is not None:
            fallback_source = str(out.fallback_source)
    return {
        "decision_backend": backend_name,
        "decision_latency_ms": latency_ms,
        "decision_calls": calls,
        "decision_confidence": confidence,
        "decision_archetype": archetype,
        "decision_answers": answers_count,
        "decision_fallback_source": fallback_source,
    }
