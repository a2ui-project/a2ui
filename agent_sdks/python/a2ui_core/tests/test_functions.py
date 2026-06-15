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
import math
from typing import Any
from pydantic import ValidationError

from a2ui.core.basic_catalog.function_impls import (
    BASIC_FUNCTION_IMPLEMENTATIONS,
    create_basic_catalog_functions,
)

IMPLS_MAP = {impl.name: impl for impl in BASIC_FUNCTION_IMPLEMENTATIONS}


def invoke(name: str, args: dict, context: Any = None) -> Any:
    impl = IMPLS_MAP.get(name)
    if not impl:
        raise ValueError(f"Function {name} not found")
    if impl.schema:
        validated_args = impl.schema.model_validate(args).model_dump()
    else:
        validated_args = {}
    return impl.execute(validated_args, context)


def test_arithmetic_add():
    assert invoke("add", {"a": 1, "b": 2}) == 3
    assert invoke("add", {"a": "1", "b": "2"}) == 3
    with pytest.raises(ValidationError):
        invoke("add", {"a": 10, "b": None})
    with pytest.raises(ValidationError):
        invoke("add", {"a": 10})


def test_arithmetic_subtract():
    assert invoke("subtract", {"a": 5, "b": 3}) == 2
    with pytest.raises(ValidationError):
        invoke("subtract", {"a": 10, "b": None})
    with pytest.raises(ValidationError):
        invoke("subtract", {"a": 10})


def test_arithmetic_multiply():
    assert invoke("multiply", {"a": 4, "b": 2}) == 8
    with pytest.raises(ValidationError):
        invoke("multiply", {"a": 10, "b": None})
    with pytest.raises(ValidationError):
        invoke("multiply", {"a": 10})


def test_arithmetic_divide():
    assert invoke("divide", {"a": 10, "b": 2}) == 5
    assert invoke("divide", {"a": 10, "b": 0}) == math.inf
    with pytest.raises(ValidationError):
        invoke("divide", {"a": 10, "b": None})
    with pytest.raises(ValidationError):
        invoke("divide", {"a": 10, "b": "invalid"})
    assert invoke("divide", {"a": 10, "b": "2"}) == 5
    assert invoke("divide", {"a": "10", "b": "2"}) == 5


def test_comparison_equals():
    assert invoke("equals", {"a": 1, "b": 1}) is True
    assert invoke("equals", {"a": 1, "b": 2}) is False
    with pytest.raises(ValidationError):
        invoke("equals", {"a": 1})
    with pytest.raises(ValidationError):
        invoke("equals", {"b": 1})


def test_comparison_not_equals():
    assert invoke("not_equals", {"a": 1, "b": 2}) is True
    assert invoke("not_equals", {"a": 1, "b": 1}) is False
    with pytest.raises(ValidationError):
        invoke("not_equals", {"a": 1})


def test_comparison_greater_than():
    assert invoke("greater_than", {"a": 5, "b": 3}) is True
    assert invoke("greater_than", {"a": 3, "b": 5}) is False
    with pytest.raises(ValidationError):
        invoke("greater_than", {"a": 10, "b": None})
    with pytest.raises(ValidationError):
        invoke("greater_than", {"a": 10})


def test_comparison_less_than():
    assert invoke("less_than", {"a": 3, "b": 5}) is True
    assert invoke("less_than", {"a": 5, "b": 3}) is False
    with pytest.raises(ValidationError):
        invoke("less_than", {"a": 3, "b": None})
    with pytest.raises(ValidationError):
        invoke("less_than", {"a": 3})


def test_logical_and():
    assert invoke("and", {"values": [True, True]}) is True
    assert invoke("and", {"values": [True, False]}) is False
    assert invoke("and", {"values": [True]}) is True


def test_logical_or():
    assert invoke("or", {"values": [False, True]}) is True
    assert invoke("or", {"values": [False, False]}) is False


def test_logical_not():
    assert invoke("not", {"value": False}) is True
    assert invoke("not", {"value": True}) is False
    with pytest.raises(ValidationError):
        invoke("not", {})


def test_string_contains():
    assert invoke("contains", {"string": "hello world", "substring": "world"}) is True
    assert invoke("contains", {"string": "hello world", "substring": "foo"}) is False
    with pytest.raises(ValidationError):
        invoke("contains", {"string": "hello"})
    with pytest.raises(ValidationError):
        invoke("contains", {"substring": "hello"})


def test_string_starts_with():
    assert invoke("starts_with", {"string": "hello", "prefix": "he"}) is True
    assert invoke("starts_with", {"string": "hello", "prefix": "lo"}) is False
    with pytest.raises(ValidationError):
        invoke("starts_with", {"string": "hello"})


def test_string_ends_with():
    assert invoke("ends_with", {"string": "hello", "suffix": "lo"}) is True
    assert invoke("ends_with", {"string": "hello", "suffix": "he"}) is False
    with pytest.raises(ValidationError):
        invoke("ends_with", {"string": "hello"})


def test_validation_required():
    assert invoke("required", {"value": "a"}) is True
    assert invoke("required", {"value": ""}) is False
    assert invoke("required", {"value": None}) is False
    with pytest.raises(ValidationError):
        invoke("required", {})


def test_validation_length():
    assert invoke("length", {"value": "abc", "min": 2}) is True
    assert invoke("length", {"value": "abc", "max": 2}) is False
    with pytest.raises(ValidationError):
        invoke("length", {})


def test_validation_numeric():
    assert invoke("numeric", {"value": 10, "min": 5, "max": 15}) is True
    assert invoke("numeric", {"value": 3, "min": 5}) is False
    with pytest.raises(ValidationError):
        invoke("numeric", {})


def test_validation_email():
    assert invoke("email", {"value": "test@example.com"}) is True
    assert invoke("email", {"value": "test.name@example.com"}) is True
    assert invoke("email", {"value": "test+label@example.com"}) is True
    assert invoke("email", {"value": "test@example-domain.com"}) is True

    assert invoke("email", {"value": "invalid"}) is False
    assert invoke("email", {"value": "test@test"}) is False
    assert invoke("email", {"value": "test@test.c"}) is False
    assert invoke("email", {"value": "test@.com"}) is False

    with pytest.raises(ValidationError):
        invoke("email", {})


def test_validation_regex():
    assert invoke("regex", {"value": "abc", "pattern": "^[a-z]+$"}) is True
    assert invoke("regex", {"value": "123", "pattern": "^[a-z]+$"}) is False
    # In python, re.match/re.search throws re.error if pattern is invalid.
    # The RegexImplementation in function_impls.py doesn't catch it currently:
    # lambda args...: bool(re.search(args["pattern"], args["value"]))
    # Let's test that it raises an exception
    with pytest.raises(Exception):
        invoke("regex", {"value": "abc", "pattern": "["})


class MockDataContext:

    def __init__(self, data_model: dict, invoker=None):
        self.data_model = data_model
        self.invoker = invoker

    def resolve_dynamic_value(self, part: Any) -> Any:
        if isinstance(part, dict) and "path" in part:
            path = part["path"].lstrip("/")
            return self.data_model.get(path)
        if isinstance(part, dict) and "call" in part:
            if self.invoker:
                return self.invoker(part["call"], part.get("args", {}))
            raise ValueError("No invoker for call")
        return part


def test_formatting_format_string_static():
    assert invoke("formatString", {"value": "hello world"}) == "hello world"


def test_formatting_format_string_data_binding():
    context = MockDataContext({"a": 10})
    assert (
        invoke("formatString", {"value": "Value: ${a}"}, context=context) == "Value: 10"
    )


def test_formatting_format_string_function_call():
    def mock_invoker(name, args):
        if name == "add":
            return int(args["a"]) + int(args["b"])
        return None

    context = MockDataContext({}, invoker=mock_invoker)
    assert (
        invoke("formatString", {"value": "Result: ${add(a: 5, b: 7)}"}, context=context)
        == "Result: 12"
    )


def test_formatting_format_string_serialization():
    # Test dictionary serialization
    context = MockDataContext({"user": {"name": "Alice", "age": 30}})
    assert (
        invoke("formatString", {"value": "User: ${user}"}, context=context)
        == 'User: {"name":"Alice","age":30}'
    )

    # Test list serialization
    context = MockDataContext({"tags": ["swift", "ios"]})
    assert (
        invoke("formatString", {"value": "Tags: ${tags}"}, context=context)
        == 'Tags: ["swift","ios"]'
    )

    # Test list with null/None preservation
    context = MockDataContext({"vals": [1, None, 3]})
    assert (
        invoke("formatString", {"value": "V = ${vals}"}, context=context)
        == "V = [1,null,3]"
    )

    # Test None/null interpolated as empty string
    context = MockDataContext({"x": None})
    assert (
        invoke("formatString", {"value": "val=${x}end"}, context=context) == "val=end"
    )


def test_formatting_format_number():
    assert invoke("formatNumber", {"value": 1234.56, "decimals": 1}) == "1,234.6"
    assert (
        invoke("formatNumber", {"value": 1234.56, "decimals": 1, "grouping": False})
        == "1234.6"
    )


def test_formatting_format_currency():
    assert (
        invoke("formatCurrency", {"value": 1234.56, "currency": "USD", "decimals": 2})
        == "$1,234.56"
    )
    # Fallback to toFixed if currency is not a standard code (we use symbol fallback or simple concatenation)
    assert (
        invoke(
            "formatCurrency",
            {"value": 1234.56, "currency": "INVALID-CURRENCY", "decimals": 2},
        )
        == "INVALID-CURRENCY 1,234.56"
    )


def test_formatting_format_date():
    assert (
        invoke("formatDate", {"value": "2025-01-01T12:00:00Z", "format": "yyyy-MM-dd"})
        == "2025-01-01"
    )
    # Format ISO
    assert (
        invoke("formatDate", {"value": "2025-01-01T12:00:00Z", "format": "ISO"})
        == "2025-01-01T12:00:00.000Z"
    )
    # Invalid date
    assert invoke("formatDate", {"value": "invalid-date", "format": "yyyy"}) == ""


def test_formatting_pluralize():
    assert (
        invoke("pluralize", {"value": 1, "one": "apple", "other": "apples"}) == "apple"
    )
    assert (
        invoke("pluralize", {"value": 2, "one": "apple", "other": "apples"}) == "apples"
    )
    assert (
        invoke("pluralize", {"value": 5, "one": "apple", "other": "apples"}) == "apples"
    )
    assert invoke("pluralize", {"value": 1, "other": "apples"}) == "apples"


def test_actions_open_url():
    # Since openUrl has side effects in browser only and returns None in python, we verify it executes without error.
    assert invoke("openUrl", {"url": "https://google.com"}) is None


def test_localized_formatting():
    def invoke_localized(locale: str, name: str, args: dict) -> Any:
        impls = create_basic_catalog_functions(locale)
        impls_map = {impl.name: impl for impl in impls}
        impl = impls_map.get(name)
        if not impl:
            raise ValueError(f"Function {name} not found")
        if impl.schema:
            validated_args = impl.schema.model_validate(args).model_dump()
        else:
            validated_args = {}
        return impl.execute(validated_args, None)

    # Number
    assert (
        invoke_localized("en-US", "formatNumber", {"value": 1234.56, "decimals": 2})
        == "1,234.56"
    )
    assert (
        invoke_localized("de-DE", "formatNumber", {"value": 1234.56, "decimals": 2})
        == "1.234,56"
    )
    assert (
        invoke_localized("fr-FR", "formatNumber", {"value": 1234.56, "decimals": 2})
        == "1 234,56"
    )

    # Currency
    assert (
        invoke_localized(
            "de-DE",
            "formatCurrency",
            {"value": 1234.56, "currency": "EUR", "decimals": 2},
        )
        == "1.234,56 €"
    )
    assert (
        invoke_localized(
            "en-US",
            "formatCurrency",
            {"value": 1234.56, "currency": "USD", "decimals": 2},
        )
        == "$1,234.56"
    )

    # Date
    assert (
        invoke_localized(
            "fr-FR",
            "formatDate",
            {"value": "2026-06-10T12:00:00Z", "format": "EEEE, MMMM d, yyyy"},
        )
        == "mercredi, juin 10, 2026"
    )
    assert (
        invoke_localized(
            "de-DE",
            "formatDate",
            {"value": "2026-06-10T12:00:00Z", "format": "EEEE, MMMM d, yyyy"},
        )
        == "Mittwoch, Juni 10, 2026"
    )

    # Pluralize (Welsh cy locale)
    assert (
        invoke_localized(
            "cy",
            "pluralize",
            {"value": 0, "zero": "dim", "one": "un", "other": "llawer"},
        )
        == "dim"
    )
