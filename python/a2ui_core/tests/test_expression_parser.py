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

import pytest
from a2ui.core.exceptions import A2uiExpressionError
from a2ui.core.expressions.expression_parser import ExpressionParser


@pytest.fixture
def parser():
    return ExpressionParser()


def test_handles_escaped_interpolation(parser):
    assert parser.parse("escaped \\${foo}") == ["escaped ", "${", "foo}"]


def test_returns_error_on_max_depth_exceeded(parser):
    with pytest.raises(A2uiExpressionError, match="Max recursion depth reached"):
        parser.parse("depth", ExpressionParser.MAX_DEPTH + 1)


def _nested_calls(calls: int) -> str:
    """Returns '${f(a: f(a: ... 1 ...))}'.

    The interpolation is itself a level, so the result nests `calls + 1` deep.
    """
    return "${" + "f(a: " * calls + "1" + ")" * calls + "}"


def _nested_interpolations(depth: int) -> str:
    """Returns '${${... "x" ...}}' nested to depth levels."""
    return "${" * depth + '"x"' + "}" * depth


def test_rejects_pathological_nesting_instead_of_overflowing_the_stack(parser):
    # Deep enough to exhaust the interpreter stack were the guard unreachable.
    # Asserted on the error kind rather than its message, matching TS test parity.
    with pytest.raises(A2uiExpressionError):
        parser.parse(_nested_calls(50000))
    with pytest.raises(A2uiExpressionError):
        parser.parse(_nested_interpolations(50000))


def test_handles_empty_identifiers(parser):
    assert parser.parse("${()}") == [{"call": "", "args": {}, "returnType": "any"}]
    assert parser.parse_expression("") == ""
    assert parser.parse_expression("()") == {
        "call": "",
        "args": {},
        "returnType": "any",
    }


def test_parses_integer_literals_with_many_leading_zeros(parser):
    zeros = "0" * 5000
    assert parser.parse_expression(f"{zeros}1") == 1
    assert parser.parse_expression(f"-{zeros}1") == -1
    with pytest.raises(A2uiExpressionError, match="out of range"):
        parser.parse_expression("1" * 5000)


def test_rejects_expression_template_exceeding_max_length(parser):
    from a2ui.core.expressions.expression_parser import MAX_EXPRESSION_TEMPLATE_LENGTH

    oversized = "a" * (MAX_EXPRESSION_TEMPLATE_LENGTH + 1)
    with pytest.raises(A2uiExpressionError, match="exceeds maximum limit"):
        parser.parse(oversized)


def test_rejects_expression_parts_exceeding_max_limit(parser):
    from a2ui.core.expressions.expression_parser import MAX_EXPRESSION_PARTS

    too_many_parts = "${x}" * (MAX_EXPRESSION_PARTS + 1)
    with pytest.raises(A2uiExpressionError, match="parts count exceeds maximum limit"):
        parser.parse(too_many_parts)


def test_parses_non_ascii_identifiers_and_paths(parser):
    assert parser.parse("${señor}") == [{"path": "señor"}]
    assert parser.parse("${café/precio}") == [{"path": "café/precio"}]
    assert parser.parse("${日本}") == [{"path": "日本"}]
    assert parser.parse("hola ${señor} qué tal") == [
        "hola ",
        {"path": "señor"},
        " qué tal",
    ]
    # UAX #31 combining marks (decomposed Unicode)
    assert parser.parse("${sen\u0303or}") == [{"path": "sen\u0303or"}]
    assert parser.parse("${cafe\u0301/precio}") == [{"path": "cafe\u0301/precio"}]
    # Keywords followed by identifier continuation characters
    assert parser.parse("${true_val}") == [{"path": "true_val"}]
    assert parser.parse("${trueñ}") == [{"path": "trueñ"}]
    assert parser.parse("${true1}") == [{"path": "true1"}]
    assert parser.parse("${true𐐷}") == [{"path": "true𐐷"}]
    # Supplementary plane Unicode characters (U+10437 Deseret Small Letter Yee)
    assert parser.parse("${𐐷}") == [{"path": "𐐷"}]
    assert parser.parse("${a𐐷b}") == [{"path": "a𐐷b"}]
    # Identifiers in function calls
    assert parser.parse_expression("add(número: 10, 日本: 20)") == {
        "call": "add",
        "args": {"número": 10, "日本": 20},
        "returnType": "any",
    }
