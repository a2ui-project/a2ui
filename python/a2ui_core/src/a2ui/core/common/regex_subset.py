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

"""Portable A2UI regex subset parser, static safety guard, and Python translator."""

from __future__ import annotations

from collections.abc import Sequence
import dataclasses
import functools
import re
from typing import Literal

from ..exceptions import A2uiExpressionError

MAX_REGEX_PATTERN_CODE_POINTS = 256
MAX_REGEX_VALUE_CODE_POINTS = 4096

AnchorKind = Literal["start", "end", "wordBoundary", "notWordBoundary"]
RegexRejection = Literal[
    "UNSUPPORTED_SYNTAX",
    "PATTERN_TOO_LONG",
    "NESTED_QUANTIFIER",
    "OVERLAPPING_ALTERNATION",
    "ADJACENT_OVERLAP",
]


@dataclasses.dataclass(frozen=True)
class CodePointRange:
    """Closed inclusive Unicode scalar range `[start, end]`."""

    start: int
    end: int


@dataclasses.dataclass(frozen=True)
class EmptyNode:
    """Empty pattern node."""

    kind: Literal["empty"] = "empty"


@dataclasses.dataclass(frozen=True)
class CharSetNode:
    """Character set node represented by normalized code-point intervals."""

    ranges: tuple[CodePointRange, ...]
    kind: Literal["charSet"] = "charSet"


@dataclasses.dataclass(frozen=True)
class GroupNode:
    """Capturing or non-capturing group node."""

    capturing: bool
    child: RegexNode
    kind: Literal["group"] = "group"


@dataclasses.dataclass(frozen=True)
class LookaheadNode:
    """Positive or negative lookahead assertion node."""

    negated: bool
    child: RegexNode
    kind: Literal["lookahead"] = "lookahead"


@dataclasses.dataclass(frozen=True)
class AnchorNode:
    """Zero-width boundary assertion node."""

    anchor: AnchorKind
    kind: Literal["anchor"] = "anchor"


@dataclasses.dataclass(frozen=True)
class ConcatNode:
    """Sequence concatenation node."""

    items: tuple[RegexNode, ...]
    kind: Literal["concat"] = "concat"


@dataclasses.dataclass(frozen=True)
class AltNode:
    """Disjunction alternation node."""

    branches: tuple[RegexNode, ...]
    kind: Literal["alt"] = "alt"


@dataclasses.dataclass(frozen=True)
class RepeatNode:
    """Quantified repetition node."""

    child: RegexNode
    min: int
    max: int | None
    lazy: bool
    kind: Literal["repeat"] = "repeat"


RegexNode = (
    EmptyNode
    | CharSetNode
    | GroupNode
    | LookaheadNode
    | AnchorNode
    | ConcatNode
    | AltNode
    | RepeatNode
)


@dataclasses.dataclass(frozen=True)
class RegexAnalysisResult:
    """Result of parsing and checking an A2UI regex pattern."""

    ok: bool
    tree: RegexNode | None = None
    reason: RegexRejection | Literal["SYNTAX"] | None = None
    detail: str | None = None


class RegexSyntaxError(ValueError):
    """Raised when a pattern fails A2UI regex subset parsing."""

    def __init__(self, message: str, unsupported: bool = False) -> None:
        super().__init__(message)
        self.unsupported = unsupported


_SURROGATE_START = 0xD800
_SURROGATE_END = 0xDFFF
_SURROGATE_RANGE = CodePointRange(_SURROGATE_START, _SURROGATE_END)
_MAX_CODE_POINT = 0x10FFFF

_DIGIT_RANGES: tuple[CodePointRange, ...] = (CodePointRange(0x30, 0x39),)
_WORD_RANGES: tuple[CodePointRange, ...] = (
    CodePointRange(0x30, 0x39),
    CodePointRange(0x41, 0x5A),
    CodePointRange(0x5F, 0x5F),
    CodePointRange(0x61, 0x7A),
)
_SPACE_RANGES: tuple[CodePointRange, ...] = (
    CodePointRange(0x09, 0x0D),
    CodePointRange(0x20, 0x20),
    CodePointRange(0xA0, 0xA0),
    CodePointRange(0x1680, 0x1680),
    CodePointRange(0x2000, 0x200A),
    CodePointRange(0x2028, 0x2029),
    CodePointRange(0x202F, 0x202F),
    CodePointRange(0x205F, 0x205F),
    CodePointRange(0x3000, 0x3000),
    CodePointRange(0xFEFF, 0xFEFF),
)
_LINE_TERMINATOR_RANGES: tuple[CodePointRange, ...] = (
    CodePointRange(0x0A, 0x0A),
    CodePointRange(0x0D, 0x0D),
    CodePointRange(0x2028, 0x2029),
)

_SYNTAX_CHARS: frozenset[int] = frozenset({
    0x5E,  # ^
    0x24,  # $
    0x5C,  # \
    0x2E,  # .
    0x2A,  # *
    0x2B,  # +
    0x3F,  # ?
    0x28,  # (
    0x29,  # )
    0x5B,  # [
    0x5D,  # ]
    0x7B,  # {
    0x7D,  # }
    0x7C,  # |
    0x2F,  # /
    0x2D,  # -
})

_CONTROL_ESCAPES: dict[int, int] = {
    0x74: 0x09,  # \t
    0x6E: 0x0A,  # \n
    0x76: 0x0B,  # \v
    0x66: 0x0C,  # \f
    0x72: 0x0D,  # \r
}


def _exclude_surrogates(r: CodePointRange) -> list[CodePointRange]:
    if r.start > r.end:
        return []
    if r.end < _SURROGATE_START or r.start > _SURROGATE_END:
        return [r]
    out: list[CodePointRange] = []
    if r.start < _SURROGATE_START:
        out.append(CodePointRange(r.start, _SURROGATE_START - 1))
    if r.end > _SURROGATE_END:
        out.append(CodePointRange(_SURROGATE_END + 1, r.end))
    return out


def normalize_ranges(
    ranges: Sequence[CodePointRange],
) -> tuple[CodePointRange, ...]:
    """Normalizes, sorts, merges, and strips UTF-16 surrogates from intervals."""
    split: list[CodePointRange] = []
    for r in ranges:
        split.extend(_exclude_surrogates(r))
    if len(split) <= 1:
        return tuple(split)
    split.sort(key=lambda item: (item.start, item.end))
    merged: list[CodePointRange] = [split[0]]
    for curr in split[1:]:
        prev = merged[-1]
        if curr.start <= prev.end + 1:
            merged[-1] = CodePointRange(prev.start, max(prev.end, curr.end))
        else:
            merged.append(curr)
    return tuple(merged)


def complement_ranges(
    ranges: Sequence[CodePointRange],
) -> tuple[CodePointRange, ...]:
    """Computes the complement of `ranges` over all Unicode scalar values."""
    excluded = normalize_ranges([*ranges, _SURROGATE_RANGE])
    result: list[CodePointRange] = []
    cursor = 0
    for r in excluded:
        if r.start > cursor:
            result.extend(_exclude_surrogates(CodePointRange(cursor, r.start - 1)))
        cursor = r.end + 1
    if cursor <= _MAX_CODE_POINT:
        result.extend(_exclude_surrogates(CodePointRange(cursor, _MAX_CODE_POINT)))
    return tuple(result)


_NOT_DIGIT_RANGES = complement_ranges(_DIGIT_RANGES)
_NOT_WORD_RANGES = complement_ranges(_WORD_RANGES)
_NOT_SPACE_RANGES = complement_ranges(_SPACE_RANGES)
_DOT_RANGES = complement_ranges(_LINE_TERMINATOR_RANGES)

_CLASS_ESCAPES: dict[int, tuple[CodePointRange, ...]] = {
    0x64: _DIGIT_RANGES,  # \d
    0x44: _NOT_DIGIT_RANGES,  # \D
    0x77: _WORD_RANGES,  # \w
    0x57: _NOT_WORD_RANGES,  # \W
    0x73: _SPACE_RANGES,  # \s
    0x53: _NOT_SPACE_RANGES,  # \S
}


def ranges_overlap(a: Sequence[CodePointRange], b: Sequence[CodePointRange]) -> bool:
    """Returns True if two normalized `CodePointRange` sequences overlap."""
    i = 0
    j = 0
    while i < len(a) and j < len(b):
        if a[i].end < b[j].start:
            i += 1
        elif b[j].end < a[i].start:
            j += 1
        else:
            return True
    return False


def count_code_points(text: str) -> int:
    """Counts Unicode code points in `text`, merging UTF-16 surrogate pairs."""
    count = 0
    i = 0
    n = len(text)
    while i < n:
        cu = ord(text[i])
        if 0xD800 <= cu <= 0xDBFF and i + 1 < n:
            low = ord(text[i + 1])
            if 0xDC00 <= low <= 0xDFFF:
                i += 1
        count += 1
        i += 1
    return count


def _to_code_points(pattern: str) -> list[int]:
    cps: list[int] = []
    i = 0
    n = len(pattern)
    while i < n:
        cu = ord(pattern[i])
        if 0xD800 <= cu <= 0xDBFF:
            low = ord(pattern[i + 1]) if i + 1 < n else 0
            if low < 0xDC00 or low > 0xDFFF:
                raise RegexSyntaxError(
                    "Lone high surrogate in pattern", unsupported=True
                )
            cps.append(0x10000 + ((cu - 0xD800) << 10) + (low - 0xDC00))
            i += 2
        elif 0xDC00 <= cu <= 0xDFFF:
            raise RegexSyntaxError("Lone low surrogate in pattern", unsupported=True)
        else:
            cps.append(cu)
            i += 1
    return cps


class _Scanner:
    """Code-point scanner over a regex pattern."""

    def __init__(self, cps: Sequence[int]) -> None:
        self._cps = cps
        self._pos = 0

    def eof(self) -> bool:
        return self._pos >= len(self._cps)

    def peek(self, offset: int = 0) -> int | None:
        idx = self._pos + offset
        return self._cps[idx] if 0 <= idx < len(self._cps) else None

    def next(self) -> int:
        if self._pos >= len(self._cps):
            raise RegexSyntaxError("Unexpected end of pattern", False)
        cp = self._cps[self._pos]
        self._pos += 1
        return cp

    def eat(self, cp: int) -> bool:
        if self._pos < len(self._cps) and self._cps[self._pos] == cp:
            self._pos += 1
            return True
        return False


def _is_ascii_digit(cp: int | None) -> bool:
    return cp is not None and 0x30 <= cp <= 0x39


def _hex_value(cp: int | None) -> int:
    if cp is None:
        return -1
    if 0x30 <= cp <= 0x39:
        return cp - 0x30
    if 0x41 <= cp <= 0x46:
        return cp - 0x41 + 10
    if 0x61 <= cp <= 0x66:
        return cp - 0x61 + 10
    return -1


def _parse_fixed_hex(s: _Scanner, digits: int) -> int:
    value = 0
    for _ in range(digits):
        hv = _hex_value(s.peek())
        if hv < 0:
            raise RegexSyntaxError("Invalid hexadecimal escape", False)
        s.next()
        value = (value << 4) | hv
    return value


def _reject_if_surrogate(cp: int) -> int:
    if _SURROGATE_START <= cp <= _SURROGATE_END:
        raise RegexSyntaxError("Surrogate code point escape is not supported", True)
    return cp


def _parse_braced_hex(s: _Scanner) -> int:
    value = 0
    count = 0
    while not s.eof() and s.peek() != 0x7D:
        hv = _hex_value(s.peek())
        if hv < 0:
            raise RegexSyntaxError("Invalid braced Unicode escape", False)
        s.next()
        value = value * 16 + hv
        count += 1
        if value > _MAX_CODE_POINT:
            raise RegexSyntaxError("Unicode escape exceeds U+10FFFF", False)
    if count == 0 or not s.eat(0x7D):
        raise RegexSyntaxError("Malformed braced Unicode escape", False)
    return _reject_if_surrogate(value)


def _parse_unicode_escape(s: _Scanner) -> int:
    if not s.eat(0x7B):
        return _reject_if_surrogate(_parse_fixed_hex(s, 4))
    return _parse_braced_hex(s)


@dataclasses.dataclass(frozen=True)
class _EscapeResult:
    kind: Literal["single", "ranges", "anchor"]
    cp: int = 0
    ranges: tuple[CodePointRange, ...] = ()
    anchor: AnchorKind = "start"


def _parse_numeric_or_hex_escape(s: _Scanner, cp: int) -> int | None:
    if cp == 0x30:
        if _is_ascii_digit(s.peek()):
            raise RegexSyntaxError("Octal escape is not supported", True)
        return 0x00
    if 0x31 <= cp <= 0x39:
        raise RegexSyntaxError("Backreference or octal escape is not supported", True)
    if cp == 0x78:
        return _parse_fixed_hex(s, 2)
    if cp == 0x75:
        return _parse_unicode_escape(s)
    return None


def _parse_escape(s: _Scanner, in_class: bool) -> _EscapeResult:
    if s.eof():
        raise RegexSyntaxError("Trailing backslash in pattern", False)
    cp = s.next()
    if cp == 0x62:
        if in_class:
            return _EscapeResult(kind="single", cp=0x08)
        return _EscapeResult(kind="anchor", anchor="wordBoundary")
    if cp == 0x42:
        if in_class:
            raise RegexSyntaxError(
                "\\B is not supported inside a character class", True
            )
        return _EscapeResult(kind="anchor", anchor="notWordBoundary")
    class_ranges = _CLASS_ESCAPES.get(cp)
    if class_ranges is not None:
        return _EscapeResult(kind="ranges", ranges=class_ranges)
    control_cp = _CONTROL_ESCAPES.get(cp)
    if control_cp is not None:
        return _EscapeResult(kind="single", cp=control_cp)
    num_or_hex = _parse_numeric_or_hex_escape(s, cp)
    if num_or_hex is not None:
        return _EscapeResult(kind="single", cp=num_or_hex)
    if cp in _SYNTAX_CHARS:
        return _EscapeResult(kind="single", cp=cp)
    raise RegexSyntaxError("Unsupported escape sequence", True)


def _parse_class_atom(
    s: _Scanner,
) -> tuple[int | None, tuple[CodePointRange, ...]]:
    cp = s.peek()
    if cp == 0x5C:
        s.next()
        esc = _parse_escape(s, True)
        if esc.kind == "single":
            return esc.cp, (CodePointRange(esc.cp, esc.cp),)
        return None, esc.ranges
    if cp == 0x5B:
        raise RegexSyntaxError("Nested character class is not supported", True)
    if cp == 0x26 and s.peek(1) == 0x26:
        raise RegexSyntaxError("Character class intersection is not supported", True)
    lit = s.next()
    return lit, (CodePointRange(lit, lit),)


def _parse_class_item(s: _Scanner) -> tuple[CodePointRange, ...]:
    first_single, first_ranges = _parse_class_atom(s)
    if s.peek() != 0x2D or s.peek(1) == 0x5D:
        return first_ranges
    s.next()
    if s.peek() == 0x2D:
        raise RegexSyntaxError("Character class subtraction is not supported", True)
    second_single, _ = _parse_class_atom(s)
    if first_single is None or second_single is None:
        raise RegexSyntaxError("Character class escape cannot form a range", False)
    if first_single > second_single:
        raise RegexSyntaxError("Character class range out of order", False)
    return (CodePointRange(first_single, second_single),)


def _parse_class(s: _Scanner) -> CharSetNode:
    negated = s.eat(0x5E)
    ranges: list[CodePointRange] = []
    while not s.eof() and s.peek() != 0x5D:
        ranges.extend(_parse_class_item(s))
    if not s.eat(0x5D):
        raise RegexSyntaxError("Unclosed character class", False)
    normalized = normalize_ranges(ranges)
    return CharSetNode(ranges=complement_ranges(normalized) if negated else normalized)


def _parse_decimal_int(s: _Scanner) -> int | None:
    if not _is_ascii_digit(s.peek()):
        return None
    value = 0
    while _is_ascii_digit(s.peek()):
        value = value * 10 + (s.next() - 0x30)
    return value


def _parse_braced_bounds(s: _Scanner) -> tuple[int, int | None]:
    min_val = _parse_decimal_int(s)
    if min_val is None:
        raise RegexSyntaxError("Malformed brace quantifier", True)
    if s.eat(0x7D):
        return min_val, min_val
    if not s.eat(0x2C):
        raise RegexSyntaxError("Malformed brace quantifier", True)
    if s.eat(0x7D):
        return min_val, None
    max_val = _parse_decimal_int(s)
    if max_val is None or not s.eat(0x7D):
        raise RegexSyntaxError("Malformed brace quantifier", True)
    if max_val < min_val:
        raise RegexSyntaxError("Quantifier minimum exceeds maximum", False)
    return min_val, max_val


def _is_quantifier_start(cp: int | None) -> bool:
    return cp in (0x2A, 0x2B, 0x3F, 0x7B)


def _parse_quantifier(s: _Scanner, child: RegexNode) -> RepeatNode:
    q = s.next()
    if q == 0x2A:
        min_val, max_val = 0, None
    elif q == 0x2B:
        min_val, max_val = 1, None
    elif q == 0x3F:
        min_val, max_val = 0, 1
    else:
        min_val, max_val = _parse_braced_bounds(s)
    lazy = s.eat(0x3F)
    if _is_quantifier_start(s.peek()):
        raise RegexSyntaxError(
            "Possessive or chained quantifiers are not supported", True
        )
    return RepeatNode(child=child, min=min_val, max=max_val, lazy=lazy)


def _parse_group(s: _Scanner) -> RegexNode:
    if not s.eat(0x3F):
        body = _parse_disjunction(s)
        if not s.eat(0x29):
            raise RegexSyntaxError("Unclosed group", False)
        return GroupNode(capturing=True, child=body)
    modifier = s.peek()
    if modifier not in (0x3A, 0x3D, 0x21):
        raise RegexSyntaxError("Unsupported group extension", True)
    s.next()
    body = _parse_disjunction(s)
    if not s.eat(0x29):
        raise RegexSyntaxError("Unclosed group", False)
    if modifier == 0x3A:
        return GroupNode(capturing=False, child=body)
    return LookaheadNode(negated=(modifier == 0x21), child=body)


def _parse_escaped_atom(s: _Scanner) -> RegexNode:
    esc = _parse_escape(s, False)
    if esc.kind == "anchor":
        return AnchorNode(anchor=esc.anchor)
    if esc.kind == "ranges":
        return CharSetNode(ranges=esc.ranges)
    return CharSetNode(ranges=(CodePointRange(esc.cp, esc.cp),))


def _parse_atom(s: _Scanner) -> RegexNode:
    cp = s.next()
    if cp == 0x5E:
        return AnchorNode(anchor="start")
    if cp == 0x24:
        return AnchorNode(anchor="end")
    if cp == 0x2E:
        return CharSetNode(ranges=_DOT_RANGES)
    if cp == 0x5B:
        return _parse_class(s)
    if cp == 0x28:
        return _parse_group(s)
    if cp == 0x5C:
        return _parse_escaped_atom(s)
    if cp in (0x7B, 0x7D, 0x5D):
        raise RegexSyntaxError("Unescaped brace or bracket is not supported", True)
    if cp in (0x2A, 0x2B, 0x3F):
        raise RegexSyntaxError("Nothing to repeat", False)
    return CharSetNode(ranges=(CodePointRange(cp, cp),))


def _parse_term(s: _Scanner) -> RegexNode:
    atom = _parse_atom(s)
    if not _is_quantifier_start(s.peek()):
        return atom
    if isinstance(atom, (AnchorNode, LookaheadNode)):
        raise RegexSyntaxError("Quantifier on an assertion is not supported", True)
    return _parse_quantifier(s, atom)


def _parse_alternative(s: _Scanner) -> RegexNode:
    items: list[RegexNode] = []
    while not s.eof() and s.peek() not in (0x7C, 0x29):
        items.append(_parse_term(s))
    if not items:
        return EmptyNode()
    if len(items) == 1:
        return items[0]
    return ConcatNode(items=tuple(items))


def _parse_disjunction(s: _Scanner) -> RegexNode:
    branches: list[RegexNode] = [_parse_alternative(s)]
    while s.eat(0x7C):
        branches.append(_parse_alternative(s))
    if len(branches) == 1:
        return branches[0]
    return AltNode(branches=tuple(branches))


def parse_regex_subset(pattern: str) -> RegexNode:
    """Parses an A2UI regex pattern into a `RegexNode` AST or raises `RegexSyntaxError`."""
    s = _Scanner(_to_code_points(pattern))
    tree = _parse_disjunction(s)
    if not s.eof():
        raise RegexSyntaxError("Unmatched closing parenthesis", False)
    return tree


def unwrap(node: RegexNode) -> RegexNode:
    """Strips outer `GroupNode` wrappers from `node`."""
    curr = node
    while isinstance(curr, GroupNode):
        curr = curr.child
    return curr


def _children_of(node: RegexNode) -> tuple[RegexNode, ...]:
    if isinstance(node, (GroupNode, LookaheadNode, RepeatNode)):
        return (node.child,)
    if isinstance(node, ConcatNode):
        return node.items
    if isinstance(node, AltNode):
        return node.branches
    return ()


def nullable(node: RegexNode) -> bool:
    """Returns True if `node` can match the empty string (`""`)."""
    if isinstance(node, (EmptyNode, AnchorNode, LookaheadNode)):
        return True
    if isinstance(node, CharSetNode):
        return False
    if isinstance(node, RepeatNode) and node.min == 0:
        return True
    if isinstance(node, AltNode):
        return any(nullable(branch) for branch in node.branches)
    return all(nullable(child) for child in _children_of(node))


def _first_concat(items: Sequence[RegexNode]) -> tuple[CodePointRange, ...]:
    acc: list[CodePointRange] = []
    for item in items:
        acc.extend(first(item))
        if not nullable(item):
            break
    return normalize_ranges(acc)


def first(node: RegexNode) -> tuple[CodePointRange, ...]:
    """Returns the normalized set of code points that can start a non-empty match of `node`."""
    if isinstance(node, CharSetNode):
        return node.ranges
    if isinstance(node, GroupNode):
        return first(node.child)
    if isinstance(node, RepeatNode):
        return () if node.max == 0 else first(node.child)
    if isinstance(node, AltNode):
        return normalize_ranges([r for b in node.branches for r in first(b)])
    if isinstance(node, ConcatNode):
        return _first_concat(node.items)
    return ()


def _consumed_children(node: RegexNode) -> tuple[RegexNode, ...]:
    if isinstance(node, GroupNode):
        return (node.child,)
    if isinstance(node, RepeatNode):
        return () if node.max == 0 else (node.child,)
    if isinstance(node, ConcatNode):
        return node.items
    if isinstance(node, AltNode):
        return node.branches
    return ()


def chars(node: RegexNode) -> tuple[CodePointRange, ...]:
    """Returns the normalized union of all character sets consumed in `node` outside lookaheads."""
    if isinstance(node, CharSetNode):
        return node.ranges
    children = _consumed_children(node)
    if not children:
        return ()
    return normalize_ranges([r for child in children for r in chars(child)])


def has_unbounded(node: RegexNode) -> bool:
    """Returns True if `node` or any descendant contains a quantifier with `max is None`."""
    if isinstance(node, RepeatNode) and node.max is None:
        return True
    return any(has_unbounded(child) for child in _children_of(node))


def _is_multi_repeat(node: RegexNode) -> bool:
    return isinstance(node, RepeatNode) and (node.max is None or node.max > 1)


def _has_nested_quantifier(node: RegexNode) -> bool:
    if (
        _is_multi_repeat(node)
        and isinstance(node, RepeatNode)
        and has_unbounded(node.child)
    ):
        return True
    return any(_has_nested_quantifier(child) for child in _children_of(node))


def _branches_overlap(branches: Sequence[RegexNode]) -> bool:
    first_sets = [first(unwrap(b)) for b in branches]
    for i, left in enumerate(first_sets):
        for right in first_sets[i + 1 :]:
            if ranges_overlap(left, right):
                return True
    return False


def _is_unbounded_overlapping_alt(node: RegexNode) -> bool:
    if not isinstance(node, RepeatNode) or node.max is not None:
        return False
    inner = unwrap(node.child)
    return isinstance(inner, AltNode) and _branches_overlap(inner.branches)


def _has_overlapping_alternation(node: RegexNode) -> bool:
    if _is_unbounded_overlapping_alt(node):
        return True
    return any(_has_overlapping_alternation(child) for child in _children_of(node))


def _follows_with_overlapping_unbounded(
    x_chars: Sequence[CodePointRange], tail: Sequence[RegexNode]
) -> bool:
    for item in tail:
        uy = unwrap(item)
        if (
            isinstance(uy, RepeatNode)
            and uy.max is None
            and ranges_overlap(x_chars, chars(uy.child))
        ):
            return True
        if not nullable(item):
            break
    return False


def _concat_has_adjacent_overlap(items: Sequence[RegexNode]) -> bool:
    for i, item in enumerate(items):
        ux = unwrap(item)
        if not isinstance(ux, RepeatNode) or ux.max is not None:
            continue
        if _follows_with_overlapping_unbounded(chars(ux.child), items[i + 1 :]):
            return True
    return False


def _has_adjacent_overlap(node: RegexNode) -> bool:
    if isinstance(node, ConcatNode) and _concat_has_adjacent_overlap(node.items):
        return True
    return any(_has_adjacent_overlap(child) for child in _children_of(node))


def check_regex_safety(pattern: str, tree: RegexNode) -> RegexRejection | None:
    """Checks the 4 static safety rules on a parsed `RegexNode` AST. Returns `None` if safe."""
    if count_code_points(pattern) > MAX_REGEX_PATTERN_CODE_POINTS:
        return "PATTERN_TOO_LONG"
    if _has_nested_quantifier(tree):
        return "NESTED_QUANTIFIER"
    if _has_overlapping_alternation(tree):
        return "OVERLAPPING_ALTERNATION"
    if _has_adjacent_overlap(tree):
        return "ADJACENT_OVERLAP"
    return None


def analyze_regex(pattern: str) -> RegexAnalysisResult:
    """Parses `pattern` against the A2UI regex subset and evaluates the 4 safety rules."""
    if count_code_points(pattern) > MAX_REGEX_PATTERN_CODE_POINTS:
        return RegexAnalysisResult(
            ok=False,
            reason="PATTERN_TOO_LONG",
            detail=(
                "Pattern exceeds maximum length of"
                f" {MAX_REGEX_PATTERN_CODE_POINTS} code points"
            ),
        )
    try:
        tree = parse_regex_subset(pattern)
    except RegexSyntaxError as err:
        return RegexAnalysisResult(
            ok=False,
            reason="UNSUPPORTED_SYNTAX" if err.unsupported else "SYNTAX",
            detail=str(err),
        )
    rejection = check_regex_safety(pattern, tree)
    if rejection is not None:
        return RegexAnalysisResult(
            ok=False,
            reason=rejection,
            detail=f"Unsafe regex pattern ({rejection})",
        )
    return RegexAnalysisResult(ok=True, tree=tree)


_ANCHOR_TRANSLATIONS: dict[AnchorKind, str] = {
    "start": r"\A",
    "end": r"\Z",
    "wordBoundary": (
        r"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])" r"|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))"
    ),
    "notWordBoundary": (
        r"(?:(?<=[A-Za-z0-9_])(?=[A-Za-z0-9_])" r"|(?<![A-Za-z0-9_])(?![A-Za-z0-9_]))"
    ),
}


def _escape_code_point(cp: int) -> str:
    return f"\\u{cp:04X}" if cp <= 0xFFFF else f"\\U{cp:08X}"


def _format_char_set(ranges: Sequence[CodePointRange]) -> str:
    if not ranges:
        return r"[^\u0000-\U0010FFFF]"
    parts: list[str] = []
    for r in ranges:
        if r.start == r.end:
            parts.append(_escape_code_point(r.start))
        else:
            parts.append(f"{_escape_code_point(r.start)}-{_escape_code_point(r.end)}")
    return f"[{''.join(parts)}]"


def _format_quantifier(min_count: int, max_count: int | None, lazy: bool) -> str:
    if min_count == 0 and max_count is None:
        base = "*"
    elif min_count == 1 and max_count is None:
        base = "+"
    elif min_count == 0 and max_count == 1:
        base = "?"
    elif max_count is None:
        base = f"{{{min_count},}}"
    elif min_count == max_count:
        base = f"{{{min_count}}}"
    else:
        base = f"{{{min_count},{max_count}}}"
    return f"{base}?" if lazy else base


def _translate_repeat(node: RepeatNode) -> str:
    child_str = translate_to_python(node.child)
    if not isinstance(node.child, (CharSetNode, GroupNode)):
        child_str = f"(?:{child_str})"
    return f"{child_str}{_format_quantifier(node.min, node.max, node.lazy)}"


def _translate_wrapper(node: GroupNode | LookaheadNode) -> str:
    if isinstance(node, GroupNode):
        prefix = "(" if node.capturing else "(?:"
    else:
        prefix = "(?!" if node.negated else "(?="
    return f"{prefix}{translate_to_python(node.child)})"


def translate_to_python(tree: RegexNode) -> str:
    """Translates an A2UI `RegexNode` AST into an equivalent Python `re` pattern string."""
    if isinstance(tree, EmptyNode):
        return ""
    if isinstance(tree, AnchorNode):
        return _ANCHOR_TRANSLATIONS[tree.anchor]
    if isinstance(tree, CharSetNode):
        return _format_char_set(tree.ranges)
    if isinstance(tree, (GroupNode, LookaheadNode)):
        return _translate_wrapper(tree)
    if isinstance(tree, ConcatNode):
        return "".join(translate_to_python(item) for item in tree.items)
    if isinstance(tree, AltNode):
        return "|".join(translate_to_python(branch) for branch in tree.branches)
    return _translate_repeat(tree)


@functools.lru_cache(maxsize=256)
def compile_guarded(pattern: str) -> re.Pattern[str]:
    """Validates, translates, and compiles an A2UI regex pattern with a 256-entry LRU cache."""
    analysis = analyze_regex(pattern)
    if not analysis.ok or analysis.tree is None:
        raise A2uiExpressionError(
            f"Invalid or unsafe regex pattern ({analysis.reason}): {pattern}",
            expression="regex",
        )
    translated = translate_to_python(analysis.tree)
    try:
        return re.compile(translated)
    except re.error as err:
        raise A2uiExpressionError(
            f"Invalid regex pattern (SYNTAX): {pattern}",
            expression="regex",
        ) from err


def regex_test(pattern: str, value: str) -> bool | None:
    """Evaluates `pattern` against `value`, returning `None` if `value` exceeds 4,096 code points."""
    compiled = compile_guarded(pattern)
    if count_code_points(value) > MAX_REGEX_VALUE_CODE_POINTS:
        return None
    return bool(compiled.search(value))
