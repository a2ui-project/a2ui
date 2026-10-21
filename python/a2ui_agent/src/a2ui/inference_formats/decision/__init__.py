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
    LocalCrossEncoderBackend,
    StepZeroLogprobBackend,
    create_decision_backend,
)
from .calibration import (
    LabeledDecisionExample,
    SynthesizerLike,
    calibrate_thresholds,
    compute_bayes_optimal_threshold,
)
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock, decision_block_from_messages
from .format import DecisionFormat, DecisionFormatFactory
from .models import (
    CalibrationPoint,
    CalibrationResult,
    ComponentNodeSpec,
    ComponentSlot,
    DecisionBackendType,
    DecisionDistribution,
    DecisionQuery,
    DecisionTask,
    DecisionWireFormat,
    FallbackSource,
    SlotKind,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    coerce_decision_payload,
)
from .parser import DecisionParser
from .payload_inspector import (
    PointerSummary,
    PointerValueType,
    inspect_payload_pointers,
)
from .prompt_generator import DECISION_RULES, DecisionPromptGenerator
from .synthesizer import DecisionSynthesizer, FallbackCallback
from .template_registry import SurfaceTemplate, TemplateRegistry
from .tool import DecisionRenderTool

__all__ = [
    "DECISION_RULES",
    "CalibrationPoint",
    "CalibrationResult",
    "CatalogDecisionGraph",
    "ComponentNodeSpec",
    "ComponentSlot",
    "DecisionBackend",
    "DecisionBackendType",
    "DecisionBlock",
    "DecisionDistribution",
    "DecisionFormat",
    "DecisionFormatFactory",
    "DecisionParser",
    "DecisionPromptGenerator",
    "DecisionQuery",
    "DecisionRenderTool",
    "DecisionSynthesizer",
    "DecisionTask",
    "DecisionWireFormat",
    "DeterministicMockBackend",
    "FallbackCallback",
    "FallbackSource",
    "JevHttpBackend",
    "LabeledDecisionExample",
    "LocalCrossEncoderBackend",
    "PointerSummary",
    "PointerValueType",
    "SlotKind",
    "StepZeroLogprobBackend",
    "SurfaceTemplate",
    "SynthesisConfig",
    "SynthesisOutput",
    "SynthesisStage",
    "SynthesizerLike",
    "TemplateRegistry",
    "calibrate_thresholds",
    "coerce_decision_payload",
    "compute_bayes_optimal_threshold",
    "create_decision_backend",
    "decision_block_from_messages",
    "inspect_payload_pointers",
]
