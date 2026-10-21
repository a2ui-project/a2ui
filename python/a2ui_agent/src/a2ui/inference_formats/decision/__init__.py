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
from .models import (
    CalibrationPoint,
    CalibrationResult,
    ComponentNodeSpec,
    ComponentSlot,
    DecisionDistribution,
    DecisionQuery,
    SlotKind,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
)
from .payload_inspector import (
    PointerSummary,
    PointerValueType,
    inspect_payload_pointers,
)
from .synthesizer import DecisionSynthesizer
from .template_registry import SurfaceTemplate, TemplateRegistry

__all__ = [
    "CalibrationPoint",
    "CalibrationResult",
    "CatalogDecisionGraph",
    "ComponentNodeSpec",
    "ComponentSlot",
    "DecisionBackend",
    "DecisionDistribution",
    "DecisionQuery",
    "DecisionSynthesizer",
    "DeterministicMockBackend",
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
    "compute_bayes_optimal_threshold",
    "create_decision_backend",
    "inspect_payload_pointers",
]
