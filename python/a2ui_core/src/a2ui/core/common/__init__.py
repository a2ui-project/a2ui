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
"""Common utilities for A2UI core, including event handling and SemVer parsing."""

from .events import Subscription, EventSource, Signal, AbortSignal
from .semver import (
    SemVer,
    compare_semver,
    is_at_least_version,
    normalize_version_string,
    parse_semver,
    to_canonical_version,
)

__all__ = [
    "Subscription",
    "EventSource",
    "Signal",
    "AbortSignal",
    "SemVer",
    "normalize_version_string",
    "parse_semver",
    "to_canonical_version",
    "compare_semver",
    "is_at_least_version",
]
