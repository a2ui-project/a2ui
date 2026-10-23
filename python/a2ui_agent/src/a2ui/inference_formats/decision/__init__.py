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

from .archetypes import (
    ArchetypeGrammar,
    BlockSpec,
    GrammarError,
    LayoutArchetype,
)
from .backends import (
    DecisionBackend,
    DeterministicMockBackend,
    JevHttpBackend,
    LocalCrossEncoderBackend,
    StepZeroLogprobBackend,
    answer_from_distribution,
    create_decision_backend,
)
from .batching import BatchingDecisionBackend
from .calibration import (
    LabeledDecisionExample,
    SynthesizerLike,
    calibrate_thresholds,
    compute_bayes_optimal_threshold,
)
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock, decision_block_from_messages
from .format import DecisionFormat, DecisionFormatFactory
from .layout_lint import LintFinding, lint_components
from .layout_planner import LayoutPlanner
from .models import (
    BlockBindings,
    BriefSection,
    CalibrationPoint,
    CalibrationResult,
    ComponentNodeSpec,
    ComponentSlot,
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
    QuestionKind,
    SemanticType,
    SlotBinding,
    SlotKind,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    coerce_decision_payload,
)
from .parser import DecisionParser
from .patterns import (
    MergedPatternLibrary,
    PatternError,
    PatternExpander,
    PatternLibrary,
    eligible_archetypes,
)
from .payload_inspector import (
    PointerSummary,
    PointerValueType,
    inspect_payload_pointers,
)
from .prompt_generator import DECISION_RULES, DecisionPromptGenerator
from .semantic_types import classify_scalar
from .synthesizer import DecisionSynthesizer, FallbackCallback
from .template_registry import SurfaceTemplate, TemplateRegistry
from .tool import DecisionRenderTool

__all__ = [
    "DECISION_RULES",
    "ArchetypeGrammar",
    "BatchingDecisionBackend",
    "BlockBindings",
    "BlockSpec",
    "BriefSection",
    "CalibrationPoint",
    "CalibrationResult",
    "CatalogDecisionGraph",
    "ComponentNodeSpec",
    "ComponentSlot",
    "DecisionAnswer",
    "DecisionBackend",
    "DecisionBackendType",
    "DecisionBatch",
    "DecisionBlock",
    "DecisionDistribution",
    "DecisionFormat",
    "DecisionFormatFactory",
    "DecisionParser",
    "DecisionPromptGenerator",
    "DecisionQuery",
    "DecisionQuestion",
    "DecisionRecord",
    "DecisionRenderTool",
    "DecisionSynthesizer",
    "DecisionTask",
    "DecisionWireFormat",
    "DeterministicMockBackend",
    "FallbackCallback",
    "FallbackSource",
    "GrammarError",
    "JevHttpBackend",
    "LabeledDecisionExample",
    "LayoutArchetype",
    "LayoutBrief",
    "LayoutPlan",
    "LayoutPlanner",
    "LintFinding",
    "LocalCrossEncoderBackend",
    "MergedPatternLibrary",
    "PageBindings",
    "PatternCapabilities",
    "PatternError",
    "PatternExpander",
    "PatternLibrary",
    "PlanOutcome",
    "PlannedBlock",
    "PointerSummary",
    "PointerValueType",
    "QuestionKind",
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
    "answer_from_distribution",
    "calibrate_thresholds",
    "classify_scalar",
    "coerce_decision_payload",
    "compute_bayes_optimal_threshold",
    "create_decision_backend",
    "decision_block_from_messages",
    "eligible_archetypes",
    "inspect_payload_pointers",
    "lint_components",
]
