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

"""Public facade for catalog-agnostic local decision-model A2UI synthesis."""

from __future__ import annotations

from .backends import (
    DecisionBackend,
    DeterministicMockBackend,
    JevHttpBackend,
    PredictOnlyBackend,
    StepZeroLogprobBackend,
    create_decision_backend,
    ensure_batch_backend,
)
from .batching import BatchingDecisionBackend
from .calibration import (
    LabeledDecisionExample,
    SynthesizerLike,
    calibrate_thresholds,
    compute_bayes_optimal_threshold,
)
from .catalog_graph import CatalogDecisionGraph
from .models import (
    MAX_BRIEF_SECTIONS,
    AuthoredCopy,
    BlockBindings,
    BriefSection,
    CalibrationPoint,
    CalibrationResult,
    ComponentNodeSpec,
    DecisionAnswer,
    DecisionBackendType,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuery,
    DecisionQuestion,
    DecisionRecord,
    DecisionTask,
    DecisionWireFormat,
    FallbackSource,
    LayoutBrief,
    LayoutPlan,
    PageBindings,
    PatternCapabilities,
    PlannedBlock,
    PlanOutcome,
    PlanReason,
    QuestionKind,
    Requirement,
    SemanticType,
    SlotBinding,
    SlotKind,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    VarietyMode,
    coerce_decision_payload,
)
from .payload_inspector import (
    PointerSummary,
    inspect_payload_pointers,
)
from .semantic_types import classify_scalar, humanize_key
from .template_registry import SurfaceTemplate, TemplateRegistry

__all__ = [
    "MAX_BRIEF_SECTIONS",
    "AuthoredCopy",
    "BatchingDecisionBackend",
    "BlockBindings",
    "BriefSection",
    "CalibrationPoint",
    "CalibrationResult",
    "CatalogDecisionGraph",
    "ComponentNodeSpec",
    "DecisionAnswer",
    "DecisionBackend",
    "DecisionBackendType",
    "DecisionBatch",
    "DecisionDistribution",
    "DecisionQuery",
    "DecisionQuestion",
    "DecisionRecord",
    "DecisionTask",
    "DecisionWireFormat",
    "DeterministicMockBackend",
    "FallbackSource",
    "JevHttpBackend",
    "LabeledDecisionExample",
    "LayoutBrief",
    "LayoutPlan",
    "PageBindings",
    "PatternCapabilities",
    "PlanOutcome",
    "PlanReason",
    "PlannedBlock",
    "PointerSummary",
    "PredictOnlyBackend",
    "QuestionKind",
    "Requirement",
    "SemanticType",
    "SlotBinding",
    "SlotKind",
    "StepZeroLogprobBackend",
    "SurfaceTemplate",
    "SynthesisConfig",
    "SynthesisOutput",
    "SynthesisStage",
    "SynthesizerLike",
    "TemplateRegistry",
    "VarietyMode",
    "calibrate_thresholds",
    "classify_scalar",
    "coerce_decision_payload",
    "compute_bayes_optimal_threshold",
    "create_decision_backend",
    "ensure_batch_backend",
    "humanize_key",
    "inspect_payload_pointers",
]
