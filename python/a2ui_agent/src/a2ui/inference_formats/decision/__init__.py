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
    PredictOnlyBackend,
    StepZeroLogprobBackend,
    answer_from_distribution,
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
from .decision_block import DecisionBlock, decision_block_from_messages
from .format import DecisionFormat, DecisionFormatFactory
from .layout_lint import LintCode, LintFinding, LintSeverity, lint_components
from .layout_planner import LayoutPlanner, PlannerState
from .models import (
    BRIEF_ITEM_PATTERN,
    MAX_BRIEF_SECTIONS,
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
    PlanReason,
    QuestionKind,
    Requirement,
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
    PatternRef,
    ResolvedPattern,
    eligible_archetypes,
    resolve_fallback_pattern,
    shape_signature,
)
from .payload_inspector import (
    PointerSummary,
    PointerValueType,
    inspect_payload_pointers,
)
from .prompt_generator import DecisionPromptGenerator, decision_rules
from .semantic_types import classify_array_field, classify_scalar, humanize_key
from .synthesizer import DecisionSynthesizer, FallbackCallback
from .template_registry import SurfaceTemplate, TemplateRegistry
from .tool import DecisionRenderTool


def __getattr__(name: str) -> object:
    # `DECISION_RULES` renders the bundled grammar's roles into the prompt
    # contract; resolve it lazily so importing the package stays cheap.
    if name == "DECISION_RULES":
        from . import prompt_generator

        return prompt_generator.DECISION_RULES
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "BRIEF_ITEM_PATTERN",
    "DECISION_RULES",
    "MAX_BRIEF_SECTIONS",
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
    "LintCode",
    "LintFinding",
    "LintSeverity",
    "LocalCrossEncoderBackend",
    "MergedPatternLibrary",
    "PageBindings",
    "PatternCapabilities",
    "PatternError",
    "PatternExpander",
    "PatternLibrary",
    "PatternRef",
    "PlanOutcome",
    "PlanReason",
    "PlannedBlock",
    "PlannerState",
    "PointerSummary",
    "PointerValueType",
    "PredictOnlyBackend",
    "QuestionKind",
    "Requirement",
    "ResolvedPattern",
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
    "classify_array_field",
    "classify_scalar",
    "coerce_decision_payload",
    "compute_bayes_optimal_threshold",
    "create_decision_backend",
    "decision_block_from_messages",
    "decision_rules",
    "eligible_archetypes",
    "ensure_batch_backend",
    "humanize_key",
    "inspect_payload_pointers",
    "lint_components",
    "resolve_fallback_pattern",
    "shape_signature",
]
