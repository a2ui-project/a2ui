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

"""Shared experimental decision-model kernel for A2UI.

Exports the question/answer/batch data models, decision backends (Jev,
SystemOne, Gemini Decisions, Step-Zero, and mock), catalog decision graph,
payload pointer inspector, and stateless transport lowering helper.
"""

from __future__ import annotations

from .backends import (
    DEFAULT_GEMINI_DECISION_MODEL,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_TYPESAFE_MODEL,
    BackendCapabilities,
    Calibration,
    DecisionBackend,
    DeterministicMockBackend,
    JevHttpBackend,
    StepZeroLogprobBackend,
    answer_from_distribution,
    create_decision_backend,
)
from .catalog_graph import CatalogDecisionGraph
from .models import (
    ActionSpec,
    ComponentKey,
    ComponentNodeSpec,
    ComponentSlot,
    DecisionAnswer,
    DecisionBackendError,
    DecisionBackendType,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuestion,
    DecisionWireFormat,
    ExpressSurfaceSpec,
    InputPart,
    MediaInputPart,
    MediaModality,
    QuestionKind,
    SemanticType,
    SlotKind,
    TextInputPart,
    coerce_decision_payload,
)
from .payload_inspector import (
    PointerSummary,
    inspect_payload_pointers,
    inspect_pointers,
    is_secret_pointer,
)
from .semantic_types import classify_scalar, humanize_key
from .transport import build_inference_catalogs, lower_for_transport

__all__ = [
    "DEFAULT_GEMINI_DECISION_MODEL",
    "DEFAULT_TIMEOUT_SECONDS",
    "DEFAULT_TYPESAFE_MODEL",
    "ActionSpec",
    "BackendCapabilities",
    "Calibration",
    "CatalogDecisionGraph",
    "ComponentKey",
    "ComponentNodeSpec",
    "ComponentSlot",
    "DecisionAnswer",
    "DecisionBackend",
    "DecisionBackendError",
    "DecisionBackendType",
    "DecisionBatch",
    "DecisionDistribution",
    "DecisionQuestion",
    "DecisionWireFormat",
    "DeterministicMockBackend",
    "ExpressSurfaceSpec",
    "InputPart",
    "JevHttpBackend",
    "MediaInputPart",
    "MediaModality",
    "PointerSummary",
    "QuestionKind",
    "SemanticType",
    "SlotKind",
    "StepZeroLogprobBackend",
    "TextInputPart",
    "answer_from_distribution",
    "build_inference_catalogs",
    "classify_scalar",
    "coerce_decision_payload",
    "create_decision_backend",
    "humanize_key",
    "inspect_payload_pointers",
    "inspect_pointers",
    "is_secret_pointer",
    "lower_for_transport",
]
