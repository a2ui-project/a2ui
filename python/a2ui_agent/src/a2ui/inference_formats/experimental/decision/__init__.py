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

"""Public facade for catalog-agnostic local decision-model A2UI synthesis.

Exports the data models, payload pointer inspector, semantic detectors,
catalog decision graph, surface template registry, and inference backends.
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
    MAX_BRIEF_SECTIONS,
    ActionSpec,
    ActionStyle,
    AuthoredCopy,
    BlockBindings,
    BriefSection,
    ComponentNodeSpec,
    ComponentSlot,
    DecisionAnswer,
    DecisionBackendError,
    DecisionBackendType,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuestion,
    DecisionRecord,
    DecisionTask,
    DecisionWireFormat,
    FallbackSource,
    LayoutBrief,
    LayoutPlan,
    PageBindings,
    PatternCapabilities,
    PlanCacheKey,
    PlannedBlock,
    PlanOutcome,
    PlanReason,
    QuestionKind,
    Requirement,
    SemanticType,
    SlotBinding,
    SlotKind,
    SurfaceOperation,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    coerce_decision_payload,
    plan_shape_signature,
)
from .payload_inspector import (
    PointerSummary,
    inspect_payload_pointers,
)
from .semantic_types import classify_scalar, humanize_key
from .template_registry import SurfaceTemplate, TemplateRegistry

__all__ = [
    "DEFAULT_GEMINI_DECISION_MODEL",
    "DEFAULT_TIMEOUT_SECONDS",
    "DEFAULT_TYPESAFE_MODEL",
    "MAX_BRIEF_SECTIONS",
    "ActionSpec",
    "ActionStyle",
    "AuthoredCopy",
    "BackendCapabilities",
    "BlockBindings",
    "BriefSection",
    "Calibration",
    "CatalogDecisionGraph",
    "ComponentNodeSpec",
    "ComponentSlot",
    "DecisionAnswer",
    "DecisionBackend",
    "DecisionBackendError",
    "DecisionBackendType",
    "DecisionBatch",
    "DecisionDistribution",
    "DecisionQuestion",
    "DecisionRecord",
    "DecisionTask",
    "DecisionWireFormat",
    "DeterministicMockBackend",
    "FallbackSource",
    "JevHttpBackend",
    "LayoutBrief",
    "LayoutPlan",
    "PageBindings",
    "PatternCapabilities",
    "PlanCacheKey",
    "PlanOutcome",
    "PlanReason",
    "PlannedBlock",
    "PointerSummary",
    "QuestionKind",
    "Requirement",
    "SemanticType",
    "SlotBinding",
    "SlotKind",
    "StepZeroLogprobBackend",
    "SurfaceOperation",
    "SurfaceTemplate",
    "SynthesisConfig",
    "SynthesisOutput",
    "SynthesisStage",
    "TemplateRegistry",
    "answer_from_distribution",
    "classify_scalar",
    "coerce_decision_payload",
    "create_decision_backend",
    "humanize_key",
    "inspect_payload_pointers",
    "plan_shape_signature",
]
