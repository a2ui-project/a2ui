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

"""Unit tests for the portable A2UI regex subset parser, guard, and translator."""

from __future__ import annotations

import pytest

from a2ui.core import (
    A2uiExpressionError,
    MAX_REGEX_PATTERN_CODE_POINTS,
    MAX_REGEX_VALUE_CODE_POINTS,
    RegexSyntaxError,
    analyze_regex,
    check_regex_safety,
    compile_guarded,
    parse_regex_subset,
    regex_test,
    translate_to_python,
)
from a2ui.core.common import (
    CharSetNode,
    CodePointRange,
    chars,
    complement_ranges,
    count_code_points,
    first,
    has_unbounded,
    normalize_ranges,
    nullable,
    ranges_overlap,
    unwrap,
)


def test_constants() -> None:
    assert MAX_REGEX_PATTERN_CODE_POINTS == 256
    assert MAX_REGEX_VALUE_CODE_POINTS == 4096


@pytest.mark.parametrize(
    "pattern",
    [
        "",
        "abc",
        r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$",
        r"^(?:cat|dog)s?$",
        r"^(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8,}$",
        r"^(?!.*\s).+$",
        r"^\d{3}-\d{4}$",
        r"^[\x20-\x7E\u00A0-\u00FF]+$",
        r"^\u{1F600}+$",
        r"\bword\b",
        r"\Binner\B",
        r"[\b]",
        r"\0",
        r"[\0-\x1F]",
        r"[-a-z]",
        r"[a-z-]",
        r"[^0-9]",
        r"a*?b+?c??d{1,3}?e{2,}?",
        r"\t\n\v\f\r",
        r"\^\$\\\.\*\+\?\(\)\[\]\{\}\|\/\-",
    ],
)
def test_grammar_acceptance(pattern: str) -> None:
    res = analyze_regex(pattern)
    assert res.ok is True
    assert res.tree is not None


@pytest.mark.parametrize(
    "pattern",
    [
        r"(a)\1",
        r"(a)(b)\2",
        r"\k<id>",
        r"(?<=a)b",
        r"(?<!a)b",
        r"(?<id>\w+)",
        r"(?i)abc",
        r"(?m)^abc$",
        r"\p{L}",
        r"\P{N}",
        r"\cA",
        r"\01",
        r"\1",
        r"\a",
        r"[a&&b]",
        r"[a--b]",
        r"[[a-z]]",
        r"[\B]",
        r"a{",
        r"a{invalid}",
        r"a{1,x}",
        r"{",
        r"}",
        r"]",
        r"^*",
        r"$+",
        r"\b?",
        r"(?=a)+",
        r"(?!a)*",
        r"a++",
        r"a*+",
        r"\uD800",
        r"\u{DFFF}",
        "\ud800",
        "\udc00",
    ],
)
def test_unsupported_syntax_rejections(pattern: str) -> None:
    res = analyze_regex(pattern)
    assert res.ok is False
    assert res.reason == "UNSUPPORTED_SYNTAX"
    with pytest.raises(A2uiExpressionError, match="UNSUPPORTED_SYNTAX"):
        compile_guarded(pattern)


@pytest.mark.parametrize(
    "pattern",
    [
        "[invalid(",
        "(unclosed",
        "(?:unclosed",
        "abc)",
        "[z-a]",
        r"[\d-z]",
        "a{5,2}",
        "*abc",
        "+abc",
        "?abc",
        "abc\\",
        r"\xGG",
        r"\u123G",
        r"\u{}",
        r"\u{110000}",
    ],
)
def test_syntax_rejections(pattern: str) -> None:
    res = analyze_regex(pattern)
    assert res.ok is False
    assert res.reason == "SYNTAX"
    with pytest.raises(RegexSyntaxError):
        parse_regex_subset(pattern)
    with pytest.raises(A2uiExpressionError, match="SYNTAX"):
        compile_guarded(pattern)


def test_rule_1_pattern_too_long() -> None:
    assert analyze_regex("a" * 256).ok is True
    too_long = analyze_regex("a" * 257)
    assert too_long.ok is False
    assert too_long.reason == "PATTERN_TOO_LONG"

    emoji_256 = "😀" * 256
    assert count_code_points(emoji_256) == 256
    assert analyze_regex(emoji_256).ok is True

    emoji_257 = "😀" * 257
    too_long_emoji = analyze_regex(emoji_257)
    assert too_long_emoji.ok is False
    assert too_long_emoji.reason == "PATTERN_TOO_LONG"
    with pytest.raises(A2uiExpressionError, match="PATTERN_TOO_LONG"):
        compile_guarded(emoji_257)


@pytest.mark.parametrize(
    "pattern",
    [
        "(a+)+",
        "(a*)*",
        "(a+)*",
        "(a*){2,5}",
        "(?:a+){2}",
        "([a-z]*)*",
        "(a|b+)+",
        "((?:a+))+",
        r"(\d+){2,}",
    ],
)
def test_rule_2_nested_quantifier_rejected(pattern: str) -> None:
    res = analyze_regex(pattern)
    assert res.ok is False
    assert res.reason == "NESTED_QUANTIFIER"
    with pytest.raises(A2uiExpressionError, match="NESTED_QUANTIFIER"):
        compile_guarded(pattern)


@pytest.mark.parametrize(
    "pattern",
    [
        "(?:ab+)?c",
        "(a+){0,1}",
        r"(\d{1,3}){1,4}",
        "(a{1,2})+",
    ],
)
def test_rule_2_nested_quantifier_accepted(pattern: str) -> None:
    assert analyze_regex(pattern).ok is True


@pytest.mark.parametrize(
    "pattern",
    [
        "(a|ab)+",
        "(a|ab)*c",
        r"(\d|[0-5])+",
        r"(\w|\d)+",
        "([a-m]|[g-z])*",
    ],
)
def test_rule_3_overlapping_alternation_rejected(pattern: str) -> None:
    res = analyze_regex(pattern)
    assert res.ok is False
    assert res.reason == "OVERLAPPING_ALTERNATION"
    with pytest.raises(A2uiExpressionError, match="OVERLAPPING_ALTERNATION"):
        compile_guarded(pattern)


@pytest.mark.parametrize(
    "pattern",
    [
        "(a|b)*c",
        "(cat|dog)+",
        "(a|ab)",
        "(a|ab)?",
        r"(\d|[a-f])+",
    ],
)
def test_rule_3_overlapping_alternation_accepted(pattern: str) -> None:
    assert analyze_regex(pattern).ok is True


@pytest.mark.parametrize(
    "pattern",
    [
        r"\d+\d+",
        ".*.*",
        r"\d+\s*\d+",
        r"\w+\d+",
        "a+a+",
        ".*a*.*",
        r"\s*.*",
        r"(\d+)(\d+)",
        r"\d+\b\d+",
    ],
)
def test_rule_4_adjacent_overlap_rejected(pattern: str) -> None:
    res = analyze_regex(pattern)
    assert res.ok is False
    assert res.reason == "ADJACENT_OVERLAP"
    with pytest.raises(A2uiExpressionError, match="ADJACENT_OVERLAP"):
        compile_guarded(pattern)


@pytest.mark.parametrize(
    "pattern",
    [
        r"\w+\s+\w+",
        r"^[a-z]+@[a-z]+\.com$",
        r"^(?=.*\d).{8,}$",
        r"\d+-\d+",
        r"[a-z]+\d+",
    ],
)
def test_rule_4_adjacent_overlap_accepted(pattern: str) -> None:
    assert analyze_regex(pattern).ok is True


def test_analysis_helpers() -> None:
    tree = parse_regex_subset(r"((?:a?b)+)(?=\d+)")
    assert nullable(tree) is False
    assert first(tree) == (CodePointRange(0x61, 0x62),)
    assert chars(tree) == (CodePointRange(0x61, 0x62),)
    assert has_unbounded(tree) is True

    grouped = parse_regex_subset("(((a)))")
    assert isinstance(unwrap(grouped), CharSetNode)
    assert check_regex_safety("a", grouped) is None

    merged = normalize_ranges([
        CodePointRange(10, 5),
        CodePointRange(0xD7FE, 0xE001),
        CodePointRange(1, 3),
        CodePointRange(4, 6),
    ])
    assert merged == (
        CodePointRange(1, 6),
        CodePointRange(0xD7FE, 0xD7FF),
        CodePointRange(0xE000, 0xE001),
    )
    assert complement_ranges([CodePointRange(0, 0x10FFFF)]) == ()
    assert ranges_overlap([CodePointRange(1, 5)], [CodePointRange(5, 9)]) is True
    assert ranges_overlap([CodePointRange(1, 4)], [CodePointRange(5, 9)]) is False


def test_translate_to_python_semantics() -> None:
    tree = parse_regex_subset(r"^a\db$")
    translated = translate_to_python(tree)
    assert translated.startswith(r"\A")
    assert translated.endswith(r"\Z")
    assert r"[\u0030-\u0039]" in translated

    assert regex_test(r"^abc$", "abc\n") is False
    assert regex_test(r"^\d+$", "١٢٣") is False
    assert regex_test(r"^\w+$", "café") is False
    assert regex_test(r"\b", "é") is False
    assert regex_test(r"\B", "é") is True
    assert regex_test(r"^.$", "😀") is True
    assert regex_test(r"^\u{1F600}+$", "😀😀") is True


def test_value_cap_and_cache() -> None:
    p1 = compile_guarded(r"^a+$")
    p2 = compile_guarded(r"^a+$")
    assert p1 is p2

    assert regex_test(r"^a+$", "a" * 4096) is True
    assert regex_test(r"^a+$", "a" * 4097) is None
    assert regex_test(r"^😀+$", "😀" * 4096) is True
    assert regex_test(r"^😀+$", "😀" * 4097) is None
