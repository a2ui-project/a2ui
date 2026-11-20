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

"""Experimental decision-model gated templates for A2UI v1.0 surfaces."""

from __future__ import annotations

from .evaluator import DEFAULT_MAX_PAIRS, DEFAULT_MIN_CONFIDENCE, GatedTemplateEvaluator
from .models import (
    GATE_EXTENSION_KEY,
    VARIANT_EXTENSION_KEY,
    GatedTemplateResult,
    GatedTemplateSpec,
    GateDecisionRecord,
    GateSpec,
    VariantGroupSpec,
    VariantOption,
)
from .pruner import extract_gates_and_variants, prune_components

__all__ = [
    "DEFAULT_MAX_PAIRS",
    "DEFAULT_MIN_CONFIDENCE",
    "GATE_EXTENSION_KEY",
    "VARIANT_EXTENSION_KEY",
    "GateDecisionRecord",
    "GateSpec",
    "GatedTemplateEvaluator",
    "GatedTemplateResult",
    "GatedTemplateSpec",
    "VariantGroupSpec",
    "VariantOption",
    "extract_gates_and_variants",
    "prune_components",
]
