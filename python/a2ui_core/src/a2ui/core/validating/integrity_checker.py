# Copyright 2024 Google LLC
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

"""Deprecated shim for a2ui.core.validating.integrity_checker."""

from a2ui.core._compat import warn_moved as _warn_moved
from a2ui.core.state.validation_helpers import (
    MAX_FUNC_CALL_DEPTH,
    MAX_GLOBAL_DEPTH,
    RELAXED_PATH_PATTERN,
    ROOT_ID,
    validate_recursion_and_paths,
)

_warn_moved(
    "a2ui.core.validating.integrity_checker",
    "a2ui.core.state.validation_helpers",
)

__all__ = [
    "ROOT_ID",
    "MAX_GLOBAL_DEPTH",
    "MAX_FUNC_CALL_DEPTH",
    "RELAXED_PATH_PATTERN",
    "validate_recursion_and_paths",
]
