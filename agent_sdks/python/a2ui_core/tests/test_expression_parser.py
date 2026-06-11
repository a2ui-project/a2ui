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

import pytest
from a2ui.core.basic_catalog.expression_parser import ExpressionParser


@pytest.fixture
def parser():
    return ExpressionParser()


def test_parses_literal_strings_unchanged(parser):
    assert parser.parse("hello world") == ["hello world"]


def test_parses_simple_interpolation(parser):
    assert parser.parse("hello ${foo}") == ["hello ", {"path": "foo"}]


def test_parses_number_interpolation(parser):
    assert parser.parse("number is ${num}") == ["number is ", {"path": "num"}]


def test_parses_nested_interpolation(parser):
    assert parser.parse("val is ${${nested}}") == ["val is ", {"path": "nested"}]


def test_handles_escaped_interpolation(parser):
    assert parser.parse("escaped \\${foo}") == ["escaped ", "${", "foo}"]


def test_parses_function_calls(parser):
    assert parser.parse("sum is ${add(a: 10, b: 20)}") == [
        "sum is ",
        {"call": "add", "args": {"a": 10, "b": 20}, "returnType": "any"},
    ]


def test_parses_function_calls_with_string_literals(parser):
    assert parser.parse('case is ${upper(text: "hello")}') == [
        "case is ",
        {"call": "upper", "args": {"text": "hello"}, "returnType": "any"},
    ]


def test_parses_keywords(parser):
    assert parser.parse("${true} ${false} ${null}") == [True, " ", False, " "]


def test_returns_error_on_max_depth_exceeded(parser):
    with pytest.raises(ValueError, match="Max recursion depth reached"):
        parser.parse("depth", 11)


def test_handles_deep_recursion_gracefully(parser):
    assert parser.parse('${${"hello"}}') == ["hello"]


def test_returns_error_on_unclosed_interpolation(parser):
    with pytest.raises(ValueError, match="Unclosed interpolation"):
        parser.parse("hello ${world")


def test_returns_error_on_invalid_function_syntax(parser):
    with pytest.raises(ValueError, match="Expected '\\)'"):
        parser.parse("${add(a: 1, b: 2}")


def test_returns_error_on_unexpected_characters_at_end(parser):
    with pytest.raises(ValueError, match="Unexpected characters"):
        parser.parse("${true false}")


def test_handles_empty_identifiers(parser):
    assert parser.parse("${()}") == [{"call": "", "args": {}, "returnType": "any"}]
    assert parser.parse_expression("") == ""
    assert parser.parse_expression("()") == {
        "call": "",
        "args": {},
        "returnType": "any",
    }


def test_handles_string_literals_with_escaped_characters(parser):
    assert parser.parse_expression(r"'line1\nline2\t\r\'\\x'") == "line1\nline2\t\r'\\x"


def test_handles_parsing_paths_with_special_characters(parser):
    assert parser.parse_expression("my-path.with_underscores") == {
        "path": "my-path.with_underscores"
    }


def test_returns_error_on_missing_colon_in_function_args(parser):
    with pytest.raises(ValueError, match="Expected ':'"):
        parser.parse_expression("add(a 10, b: 20)")
