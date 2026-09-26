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

"""Strictness of the `Dynamic*` schema aliases.

Each alias admits one primitive type, a `DataBinding`, or a `FunctionCall`.
A value of any other primitive type is rejected rather than coerced, which is
what the TypeScript engine already did.

Not every assertion here pins a behaviour this change introduced. Pydantic v2
already refused to coerce an `int` into a `str`, so the `DynamicString` and
`DynamicStringList` cases were passing before the aliases became strict. They
are kept as regression guards and labelled as such, so that nobody reads them
as evidence the strict types are doing work they are not.
"""

import pytest
from pydantic import TypeAdapter, ValidationError
from a2ui.core.exceptions import A2uiValidationError

from a2ui.core.schema.common_types import (
    DataBinding,
    DynamicBoolean,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    FunctionCall,
)
from a2ui.core.schema.v0_9.common_types import DynamicValue as DynamicValueV09
from a2ui.core.schema.v1_0.common_types import DynamicValue as DynamicValueV10


def test_dynamic_number_rejects_other_primitives():
    """Pins behaviour this change introduced."""
    adapter = TypeAdapter(DynamicNumber)

    # A numeric string used to validate as 1.0. The web engine rejected it, and
    # a string is not one of the three forms the specification allows.
    with pytest.raises(ValidationError):
        adapter.validate_python("123")

    # bool subclasses int in Python, so a strict int has to exclude it
    # explicitly or True would arrive as the number 1.
    with pytest.raises(ValidationError):
        adapter.validate_python(True)

    # An int must stay an int. Widening it to float would change serialised
    # output for every integer a payload carries.
    assert isinstance(adapter.validate_python(123), int)
    assert isinstance(adapter.validate_python(123.4), float)

    adapter.validate_python(DataBinding(path="/foo"))
    adapter.validate_python(FunctionCall(call="fn"))


def test_dynamic_boolean_rejects_other_primitives():
    """Pins behaviour this change introduced."""
    adapter = TypeAdapter(DynamicBoolean)

    # These three all used to validate as True or False.
    with pytest.raises(ValidationError):
        adapter.validate_python(1)
    with pytest.raises(ValidationError):
        adapter.validate_python(0)
    with pytest.raises(ValidationError):
        adapter.validate_python("true")

    adapter.validate_python(True)
    adapter.validate_python(False)
    adapter.validate_python(DataBinding(path="/foo"))


@pytest.mark.parametrize(
    "dynamic_value", [DynamicValueV09, DynamicValueV10], ids=["v0_9", "v1_0"]
)
def test_dynamic_value_preserves_int(dynamic_value):
    """Pins behaviour this change introduced.

    `DynamicValue` admitted `float` but not `int`, so every integer was
    widened: a payload carrying `1` came back as `1.0`.
    """
    adapter = TypeAdapter(dynamic_value)

    assert isinstance(adapter.validate_python(1), int)
    assert isinstance(adapter.validate_python(1.5), float)
    assert isinstance(adapter.validate_python(True), bool)
    assert isinstance(adapter.validate_python("x"), str)
    adapter.validate_python(["a"])
    adapter.validate_python(DataBinding(path="/foo"))


def test_dynamic_string_rejects_other_primitives():
    """Regression guard. Pydantic already refused these before the change."""
    adapter = TypeAdapter(DynamicString)

    for rejected in (123, 123.4, True):
        with pytest.raises(ValidationError):
            adapter.validate_python(rejected)

    adapter.validate_python("hello")
    adapter.validate_python(DataBinding(path="/foo"))
    adapter.validate_python(FunctionCall(call="fn"))


def test_dynamic_string_list_rejects_other_primitives():
    """Regression guard. Pydantic already refused these before the change."""
    adapter = TypeAdapter(DynamicStringList)

    with pytest.raises(ValidationError):
        adapter.validate_python([1, 2])
    # A bare string is not a one-element list.
    with pytest.raises(ValidationError):
        adapter.validate_python("a,b")

    adapter.validate_python(["a", "b"])
    adapter.validate_python(DataBinding(path="/foo"))


def test_strict_aliases_round_trip():
    """Validation and dumping agree, so nothing downstream sees a changed type."""
    for alias, value in (
        (DynamicNumber, 1),
        (DynamicNumber, 1.5),
        (DynamicBoolean, True),
        (DynamicString, "x"),
        (DynamicStringList, ["a"]),
        (DynamicValueV10, 1),
    ):
        adapter = TypeAdapter(alias)
        validated = adapter.validate_python(value)
        assert adapter.dump_python(validated) == value
        assert type(adapter.dump_python(validated)) is type(value)


def test_v09_function_call_return_type_and_catalog_id():
    """v0.9 FunctionCall accepts returnType (default 'boolean') and forbids catalogId."""
    from a2ui.core.schema.v0_9.common_types import FunctionCall as FunctionCallV09

    assert FunctionCallV09 is not FunctionCall
    assert FunctionCallV09.__module__ == "a2ui.core.schema.v0_9.common_types"

    fc_default = FunctionCallV09(call="fn")
    assert fc_default.return_type == "boolean"
    assert "return_type" not in fc_default.model_fields_set

    fc_explicit = FunctionCallV09.model_validate({"call": "fn", "returnType": "string"})
    assert fc_explicit.return_type == "string"
    assert "return_type" in fc_explicit.model_fields_set

    with pytest.raises(ValidationError):
        FunctionCallV09.model_validate({"call": "fn", "catalogId": "basic"})


def test_base_function_call_is_version_agnostic():
    """Base FunctionCall in common_types does not have returnType."""
    fc = FunctionCall(call="fn", catalog_id="basic")
    assert fc.catalog_id == "basic"
    with pytest.raises(ValidationError):
        FunctionCall.model_validate({"call": "fn", "returnType": "boolean"})


def test_v10_function_call_catalog_id_and_return_type():
    """v1.0 FunctionCall accepts catalogId and forbids returnType."""
    from a2ui.core.schema.v1_0.common_types import FunctionCall as FunctionCallV10

    fc = FunctionCallV10.model_validate({"call": "fn", "catalogId": "basic"})
    assert fc.catalog_id == "basic"

    with pytest.raises(ValidationError):
        FunctionCallV10.model_validate({"call": "fn", "returnType": "string"})


@pytest.mark.parametrize(
    ("alias_name", "expected_return_type", "wrong_return_type"),
    [
        ("DynamicString", "string", "number"),
        ("DynamicNumber", "number", "string"),
        ("DynamicBoolean", "boolean", "string"),
        ("DynamicStringList", "array", "string"),
    ],
)
def test_v09_dynamic_types_enforce_return_type(
    alias_name: str, expected_return_type: str, wrong_return_type: str
):
    """v0.9 Dynamic* types accept omitted or matching returnType and reject mismatches."""
    import a2ui.core.schema.v0_9.common_types as v09_common

    alias = getattr(v09_common, alias_name)
    adapter = TypeAdapter(alias)

    # Omitted returnType is valid per v0.9 JSON Schema (returnType is not required)
    omitted = adapter.validate_python({"call": "fn"})
    assert omitted.call == "fn"
    assert omitted.return_type == expected_return_type
    assert "return_type" not in omitted.model_fields_set
    assert omitted.model_dump(by_alias=True, exclude_unset=True) == {"call": "fn"}
    # Round-trip through model_dump(by_alias=True) re-validates cleanly
    revalidated = adapter.validate_python(adapter.dump_python(omitted, by_alias=True))
    assert revalidated.return_type == expected_return_type

    # Matching explicit returnType is valid
    matched = adapter.validate_python(
        {"call": "fn", "returnType": expected_return_type}
    )
    assert matched.return_type == expected_return_type

    # Mismatched explicit returnType is rejected
    with pytest.raises(ValidationError):
        adapter.validate_python({"call": "fn", "returnType": wrong_return_type})


def test_v09_basic_catalog_payload_validator_return_type():
    """PayloadValidator with v0.9 BasicCatalog validates FunctionCall returnType."""
    from a2ui.core.basic_catalog.v0_9 import BasicCatalog as BasicCatalogV09
    from a2ui.core.validation.payload_validator import PayloadValidator

    validator = PayloadValidator(BasicCatalogV09())

    # Valid explicit returnType on DynamicString property
    valid_component = {
        "id": "txt1",
        "component": "Text",
        "text": {
            "call": "formatString",
            "args": {"value": "hello"},
            "returnType": "string",
        },
    }
    # Valid component passes without raising
    validator.validate_component(valid_component)

    # Omitted returnType on DynamicString property passes without raising
    omitted_component = {
        "id": "txt1",
        "component": "Text",
        "text": {
            "call": "formatString",
            "args": {"value": "hello"},
        },
    }
    validator.validate_component(omitted_component)

    # Mismatched returnType on DynamicString property is rejected
    mismatched_component = {
        "id": "txt1",
        "component": "Text",
        "text": {
            "call": "formatString",
            "args": {"value": "hello"},
            "returnType": "number",
        },
    }
    with pytest.raises(A2uiValidationError):
        validator.validate_component(mismatched_component)

    # catalogId on v0.9 FunctionCall is rejected
    catalog_id_component = {
        "id": "txt1",
        "component": "Text",
        "text": {
            "call": "formatString",
            "args": {"value": "hello"},
            "catalogId": "basic",
        },
    }
    with pytest.raises(A2uiValidationError):
        validator.validate_component(catalog_id_component)
