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

"""JSON Pointer (RFC 6901) parsing, unescaping, and validation utilities."""

import re
from typing import List

# Regex to check if path segment is numeric (representing array index)
NUMERIC_PATTERN = re.compile(r"^(?:0|[1-9][0-9]*)$")

# Keys forbidden in path resolution to prevent prototype pollution vulnerabilities.
FORBIDDEN_PATH_SEGMENTS = frozenset({"__proto__", "constructor", "prototype"})
UNESCAPE_PATTERN = re.compile(r"~([01])")


def _unescape_match(m: re.Match[str]) -> str:
    return "/" if m.group(1) == "1" else "~"


def unescape_json_pointer(token: str) -> str:
    """Unescapes a single RFC 6901 JSON Pointer token ('~1' -> '/', '~0' -> '~')."""
    return UNESCAPE_PATTERN.sub(_unescape_match, token)


def split_json_pointer(path: str) -> List[str]:
    """Splits a JSON Pointer path into individual unescaped tokens."""
    if not path or path == "/":
        return []
    raw_tokens = path[1:].split("/") if path.startswith("/") else path.split("/")
    return [unescape_json_pointer(t) for t in raw_tokens]
