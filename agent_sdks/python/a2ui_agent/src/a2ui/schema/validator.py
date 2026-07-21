# Copyright 2026 Google LLC
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

"""Deprecated compatibility redirect for A2uiValidator."""

import warnings
from a2ui.validation.validator import (
    A2uiValidator,
    extract_component_ref_fields,
    extract_component_required_fields,
)
from a2ui.core.validating import analyze_topology
from a2ui.core.validating.integrity_checker import get_component_references

warnings.warn(
    "a2ui.schema.validator is deprecated and will be removed. "
    "Please import from a2ui.validation.validator instead.",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = [
    "A2uiValidator",
    "extract_component_ref_fields",
    "extract_component_required_fields",
    "analyze_topology",
    "get_component_references",
]
