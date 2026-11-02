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

from .events import AbortSignal, EventSource, Signal, Subscription
from .metadata import (
    A2uiMetadata,
    clone_metadata,
    json_equals,
    metadata_equals,
    normalize_metadata,
    validate_metadata,
)
from .regex_subset import (
    MAX_REGEX_PATTERN_CODE_POINTS,
    MAX_REGEX_VALUE_CODE_POINTS,
    AltNode,
    AnchorKind,
    AnchorNode,
    CharSetNode,
    CodePointRange,
    ConcatNode,
    EmptyNode,
    GroupNode,
    LookaheadNode,
    RegexAnalysisResult,
    RegexNode,
    RegexRejection,
    RegexSyntaxError,
    RepeatNode,
    analyze_regex,
    chars,
    check_regex_safety,
    compile_guarded,
    complement_ranges,
    count_code_points,
    first,
    has_unbounded,
    normalize_ranges,
    nullable,
    parse_regex_subset,
    ranges_overlap,
    regex_test,
    translate_to_python,
    unwrap,
)
from .semver import (
    SemVer,
    compare_semver,
    is_at_least_version,
    normalize_version_string,
    parse_semver,
    to_canonical_version,
    to_protocol_version,
    to_semver,
)
from .uax31 import assert_uax31_identifier, is_valid_uax31_identifier

__all__ = [
    "A2uiMetadata",
    "AbortSignal",
    "AltNode",
    "AnchorKind",
    "AnchorNode",
    "CharSetNode",
    "CodePointRange",
    "ConcatNode",
    "EmptyNode",
    "EventSource",
    "GroupNode",
    "LookaheadNode",
    "MAX_REGEX_PATTERN_CODE_POINTS",
    "MAX_REGEX_VALUE_CODE_POINTS",
    "RegexAnalysisResult",
    "RegexNode",
    "RegexRejection",
    "RegexSyntaxError",
    "RepeatNode",
    "SemVer",
    "Signal",
    "Subscription",
    "analyze_regex",
    "assert_uax31_identifier",
    "chars",
    "check_regex_safety",
    "clone_metadata",
    "compare_semver",
    "compile_guarded",
    "complement_ranges",
    "count_code_points",
    "first",
    "has_unbounded",
    "is_at_least_version",
    "is_valid_uax31_identifier",
    "json_equals",
    "metadata_equals",
    "normalize_metadata",
    "normalize_ranges",
    "normalize_version_string",
    "nullable",
    "parse_regex_subset",
    "parse_semver",
    "ranges_overlap",
    "regex_test",
    "to_canonical_version",
    "to_protocol_version",
    "to_semver",
    "translate_to_python",
    "unwrap",
    "validate_metadata",
]
