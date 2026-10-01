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

"""Translates JSON schema regular expressions for Python's `re` module.

JSON schema patterns are ECMA-262 regular expressions. A2UI uses the Unicode
identifier pattern `^[\\p{XID_Start}_][\\p{XID_Continue}]*$` (UAX #31), for
example for extension keys, and Python's `re` module has no `\\p{...}`
classes. Python defines identifiers by these two properties (PEP 3131), so
`str.isidentifier` yields their exact character sets. Other `\\p{...}` classes
are left as is, so compiling them fails loudly.
"""

from __future__ import annotations

import functools
import re
from typing import Any, Callable, Final

_UNICODE_MAX: Final[int] = 0x10FFFF

# Unicode properties that Python's identifier rules define.
_PROPERTY_PREDICATES: Final[dict[str, Callable[[str], bool]]] = {
    # Python also accepts `_` as a first character; XID_Start does not.
    "XID_Start": lambda char: char != "_" and char.isidentifier(),
    "XID_Continue": lambda char: ("a" + char).isidentifier(),
}

_PROPERTY_ESCAPE: Final[re.Pattern[str]] = re.compile(r"\\p\{(\w+)\}")


@functools.cache
def _class_body(property_name: str) -> str:
    """Returns the character class contents (without brackets) of a property."""
    predicate = _PROPERTY_PREDICATES[property_name]
    parts: list[str] = []
    start: int | None = None
    for code_point in range(_UNICODE_MAX + 2):
        matches = code_point <= _UNICODE_MAX and predicate(chr(code_point))
        if matches and start is None:
            start = code_point
        elif not matches and start is not None:
            end = code_point - 1
            parts.append(
                re.escape(chr(start))
                if start == end
                else f"{re.escape(chr(start))}-{re.escape(chr(end))}"
            )
            start = None
    return "".join(parts)


def translate_pattern(pattern: str) -> str:
    """Rewrites the `\\p{XID_Start}` and `\\p{XID_Continue}` classes of a pattern.

    Returns:
        A pattern that Python's `re` module compiles to the same matches.
    """
    if "\\p{" not in pattern:
        return pattern
    result: list[str] = []
    in_class = False
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "\\":
            match = _PROPERTY_ESCAPE.match(pattern, index)
            if match and match.group(1) in _PROPERTY_PREDICATES:
                body = _class_body(match.group(1))
                result.append(body if in_class else f"[{body}]")
                index = match.end()
                continue
            result.append(pattern[index : index + 2])
            index += 2
            continue
        if char == "[" and not in_class:
            in_class = True
        elif char == "]" and in_class:
            in_class = False
        result.append(char)
        index += 1
    return "".join(result)


def _translate_node(node: Any) -> Any:
    if isinstance(node, list):
        return [_translate_node(item) for item in node]
    if not isinstance(node, dict):
        return node
    translated: dict[str, Any] = {}
    for key, value in node.items():
        if key == "pattern" and isinstance(value, str):
            translated[key] = translate_pattern(value)
        elif key == "patternProperties" and isinstance(value, dict):
            translated[key] = {
                translate_pattern(pattern): _translate_node(subschema)
                for pattern, subschema in value.items()
            }
        else:
            translated[key] = _translate_node(value)
    return translated


def translate_schema_patterns(schema: Any) -> Any:
    """Returns a schema whose regular expressions Python's `re` module supports.

    Use it on schemas and registry resources before handing them to a
    `jsonschema` validator, which compiles patterns with `re`.

    Returns:
        A copy of `schema` with translated patterns; the input is unchanged.
    """
    return _translate_node(schema)
