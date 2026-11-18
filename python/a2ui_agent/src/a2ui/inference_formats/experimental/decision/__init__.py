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

from .archetypes import (
    ArchetypeGrammar,
    BlockSpec,
    GrammarError,
    LayoutArchetype,
    SlotSpec,
)
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
from .decision_block import DecisionBlock, decision_block_from_messages
from .format import DecisionFormat, DecisionFormatFactory
from .layout_lint import LintCode, LintFinding, LintSeverity, lint_components
from .layout_planner import LayoutPlanner
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
from .parser import DecisionParser, surface_operation_for
from .patterns import (
    CatalogPattern,
    Expansion,
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
    inspect_payload_pointers,
)
from .plan_cache import CachedPlan, PlanCache
from .prompt_generator import DecisionPromptGenerator, decision_rules
from .semantic_types import classify_scalar, humanize_key
from .synthesizer import (
    DecisionSynthesizer,
    FallbackCallback,
    resolve_surface_operation,
)
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
    "DECISION_RULES",
    "DEFAULT_GEMINI_DECISION_MODEL",
    "DEFAULT_TIMEOUT_SECONDS",
    "DEFAULT_TYPESAFE_MODEL",
    "MAX_BRIEF_SECTIONS",
    "ActionSpec",
    "ActionStyle",
    "ArchetypeGrammar",
    "AuthoredCopy",
    "BackendCapabilities",
    "BlockBindings",
    "BlockSpec",
    "BriefSection",
    "CachedPlan",
    "Calibration",
    "CatalogDecisionGraph",
    "CatalogPattern",
    "ComponentNodeSpec",
    "ComponentSlot",
    "DecisionAnswer",
    "DecisionBackend",
    "DecisionBackendError",
    "DecisionBackendType",
    "DecisionBatch",
    "DecisionBlock",
    "DecisionDistribution",
    "DecisionFormat",
    "DecisionFormatFactory",
    "DecisionParser",
    "DecisionPromptGenerator",
    "DecisionQuestion",
    "DecisionRecord",
    "DecisionRenderTool",
    "DecisionSynthesizer",
    "DecisionTask",
    "DecisionWireFormat",
    "DeterministicMockBackend",
    "Expansion",
    "FallbackCallback",
    "FallbackSource",
    "GrammarError",
    "JevHttpBackend",
    "LayoutArchetype",
    "LayoutBrief",
    "LayoutPlan",
    "LayoutPlanner",
    "LintCode",
    "LintFinding",
    "LintSeverity",
    "MergedPatternLibrary",
    "PageBindings",
    "PatternCapabilities",
    "PatternError",
    "PatternExpander",
    "PatternLibrary",
    "PatternRef",
    "PlanCache",
    "PlanCacheKey",
    "PlanOutcome",
    "PlanReason",
    "PlannedBlock",
    "PointerSummary",
    "QuestionKind",
    "Requirement",
    "ResolvedPattern",
    "SemanticType",
    "SlotBinding",
    "SlotKind",
    "SlotSpec",
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
    "decision_block_from_messages",
    "decision_rules",
    "eligible_archetypes",
    "humanize_key",
    "inspect_payload_pointers",
    "lint_components",
    "plan_shape_signature",
    "resolve_fallback_pattern",
    "resolve_surface_operation",
    "shape_signature",
    "surface_operation_for",
]
