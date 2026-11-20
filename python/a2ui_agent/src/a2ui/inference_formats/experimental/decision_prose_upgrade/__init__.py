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

"""Experimental decision-gated prose-to-surface upgrade for A2UI v1.0."""

from __future__ import annotations

from .extractors import (
    DeterministicMockExtractor,
    FieldExtractor,
    StructuredJsonCaller,
    StructuredOutputExtractor,
    build_extraction_json_schema,
    build_extraction_prompt,
)
from .models import (
    ExtractedField,
    ExtractionResult,
    ExtractionThresholds,
    FieldExtractionError,
    FieldType,
    ProseTemplateSpec,
    ProseUpgradeResult,
    TypedFieldSpec,
)
from .upgrader import (
    DEFAULT_GATE_THRESHOLD,
    DEFAULT_MIN_TEMPLATE_CONFIDENCE,
    ProseSurfaceUpgrader,
)

__all__ = [
    "DEFAULT_GATE_THRESHOLD",
    "DEFAULT_MIN_TEMPLATE_CONFIDENCE",
    "DeterministicMockExtractor",
    "ExtractedField",
    "ExtractionResult",
    "ExtractionThresholds",
    "FieldExtractionError",
    "FieldExtractor",
    "FieldType",
    "ProseSurfaceUpgrader",
    "ProseTemplateSpec",
    "ProseUpgradeResult",
    "StructuredJsonCaller",
    "StructuredOutputExtractor",
    "TypedFieldSpec",
    "build_extraction_json_schema",
    "build_extraction_prompt",
]
