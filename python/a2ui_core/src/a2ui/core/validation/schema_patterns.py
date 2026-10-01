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

JSON schema patterns are ECMA-262 regular expressions. Two differences from
Python's `re` matter for A2UI schemas:

- A2UI uses the Unicode identifier pattern
  `^[\\p{XID_Start}_][\\p{XID_Continue}]*$` (UAX #31), for example for
  extension keys, and Python's `re` module has no `\\p{...}` classes. Python
  defines identifiers by these two properties (PEP 3131), so
  `str.isidentifier` yields their exact character sets. Other `\\p{...}`
  classes are left as is, so compiling them fails loudly.
- Python's `$` also matches before a trailing newline, while ECMA's `$` (without
  the multiline flag) matches only at the end of the input. Unescaped `$`
  anchors outside character classes are rewritten to `\\Z`.

Validation error messages quote the translated pattern; use
`restore_original_patterns` to show the schema's own pattern instead.
"""

from __future__ import annotations

import copy
import functools
import re
from collections.abc import Mapping, Sequence
from typing import Any, Callable, Final

# Code point ranges that contain identifier characters: planes 0 to 3 without
# the surrogates, and plane 14 (variation selectors). The other planes are
# unassigned or private use, so scanning them would only cost time.
_SCANNED_RANGES: Final[tuple[tuple[int, int], ...]] = (
    (0x0, 0xD7FF),
    (0xE000, 0x3FFFF),
    (0xE0000, 0xEFFFF),
)

# Unicode properties that Python's identifier rules define.
_PROPERTY_PREDICATES: Final[dict[str, Callable[[str], bool]]] = {
    # Python also accepts `_` as a first character; XID_Start does not.
    "XID_Start": lambda char: char != "_" and char.isidentifier(),
    "XID_Continue": lambda char: ("a" + char).isidentifier(),
}

_PROPERTY_ESCAPE: Final[re.Pattern[str]] = re.compile(r"\\p\{(\w+)\}")

# Keywords whose values are instance data rather than schemas, so their
# contents are never rewritten (a `const` may well hold a "pattern" key).
_DATA_KEYWORDS: Final[frozenset[str]] = frozenset({
    "const",
    "default",
    "enum",
    "examples",
})

# Keywords whose values map names to schemas. Their keys are names, not
# keywords, so a property called `default` is still a schema.
_SCHEMA_MAP_KEYWORDS: Final[frozenset[str]] = frozenset({
    "$defs",
    "components",
    "definitions",
    "dependentSchemas",
    "functions",
    "properties",
})

# Translated pattern -> (repr of translated, original, repr of original), for
# every pattern that translation changed.
_ORIGINAL_PATTERNS: dict[str, tuple[str, str, str]] = {}


@functools.cache
def _class_body(property_name: str) -> str:
    """Returns the character class contents (without brackets) of a property."""
    predicate = _PROPERTY_PREDICATES[property_name]
    parts: list[str] = []
    for first, last in _SCANNED_RANGES:
        start: int | None = None
        for code_point in range(first, last + 2):
            matches = code_point <= last and predicate(chr(code_point))
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


@functools.cache
def translate_pattern(pattern: str) -> str:
    """Rewrites an ECMA-262 pattern for Python's `re` module.

    Expands the `\\p{XID_Start}` and `\\p{XID_Continue}` classes and rewrites
    unescaped `$` anchors outside character classes to `\\Z`.

    Returns:
        A pattern that Python's `re` module compiles to the same matches.
    """
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
        elif char == "$" and not in_class:
            result.append("\\Z")
            index += 1
            continue
        result.append(char)
        index += 1
    translated = "".join(result)
    if translated != pattern:
        _ORIGINAL_PATTERNS[translated] = (repr(translated), pattern, repr(pattern))
    return translated


def restore_original_patterns(message: str) -> str:
    """Replaces translated patterns quoted in a message with the original ones.

    `jsonschema` error messages quote the pattern that failed to match. For a
    schema passed through `translate_schema_patterns`, that is the translated
    pattern, which can be kilobytes long; this restores the schema's own.

    Returns:
        The message with every translated pattern replaced by its original.
    """
    for translated, (translated_repr, original, original_repr) in list(
        _ORIGINAL_PATTERNS.items()
    ):
        if translated_repr in message:
            message = message.replace(translated_repr, original_repr)
        if translated in message:
            message = message.replace(translated, original)
    return message


def _translate_schema_map(node: Any) -> Any:
    if not isinstance(node, Mapping):
        return _translate_node(node)
    return {name: _translate_node(subschema) for name, subschema in node.items()}


def _translate_node(node: Any) -> Any:
    if isinstance(node, Sequence) and not isinstance(node, (str, bytes)):
        return [_translate_node(item) for item in node]
    if not isinstance(node, Mapping):
        return node
    translated: dict[str, Any] = {}
    for key, value in node.items():
        if key in _DATA_KEYWORDS:
            translated[key] = copy.deepcopy(value)
        elif key == "pattern" and isinstance(value, str):
            translated[key] = translate_pattern(value)
        elif key == "patternProperties" and isinstance(value, Mapping):
            translated[key] = {
                translate_pattern(pattern): _translate_node(subschema)
                for pattern, subschema in value.items()
            }
        elif key in _SCHEMA_MAP_KEYWORDS:
            translated[key] = _translate_schema_map(value)
        else:
            translated[key] = _translate_node(value)
    return translated


def translate_schema_patterns(schema: Any) -> Any:
    """Returns a schema whose regular expressions Python's `re` module supports.

    Use it on schemas and registry resources before handing them to a
    `jsonschema` validator, which compiles patterns with `re`. Data-valued
    keywords (`const`, `default`, `enum`, `examples`) are copied unchanged.

    Returns:
        A copy of `schema` with translated patterns; the input is unchanged.
    """
    return _translate_node(schema)
