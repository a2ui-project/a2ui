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

"""Tests ECMA-262 and UAX #31 pattern validation with `SchemaValidator`."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.core import A2uiValidationError, Catalog
from a2ui.core.validation import (
    PayloadValidator,
    RELAXED_VALIDATION,
    STRICT_VALIDATION,
    SchemaValidator,
)

_IDENTIFIER = r"^[\p{XID_Start}_][\p{XID_Continue}]*$"
_MAX_MESSAGE_LENGTH = 300


def _matches(pattern: str, value: str) -> bool:
    return SchemaValidator({"type": "string", "pattern": pattern}).is_valid(value)


@pytest.mark.parametrize("key", ["ñame", "_x", "a2ui_foo", "名前", "x1", "a\u0301"])
def test_identifier_pattern_accepts_unicode_identifiers(key: str) -> None:
    assert _matches(_IDENTIFIER, key)


@pytest.mark.parametrize("key", ["1a", "a-b", "", "foo\n", "\u0301a", "a b"])
def test_identifier_pattern_rejects_non_identifiers(key: str) -> None:
    assert not _matches(_IDENTIFIER, key)


def test_dollar_matches_only_at_end_of_input() -> None:
    """ECMA's `$` does not match before a trailing newline, unlike Python's."""
    assert _matches("^foo$", "foo")
    assert not _matches("^foo$", "foo\n")


def test_dollar_in_class_or_escaped_is_literal() -> None:
    assert _matches("^[$]$", "$")
    assert _matches(r"^\$$", "$")


def test_escaped_backslash_before_p_is_left_alone() -> None:
    pattern = r"^\\p{XID_Start}$"
    assert _matches(pattern, r"\p{XID_Start}")
    assert not _matches(pattern, "a")


def test_escaped_bracket_does_not_close_the_class() -> None:
    pattern = r"^[\]\p{XID_Start}]$"
    assert _matches(pattern, "]")
    assert _matches(pattern, "a")
    assert not _matches(pattern, "1")


def test_negated_class() -> None:
    pattern = r"^[^\p{XID_Start}]$"
    assert _matches(pattern, "1")
    assert not _matches(pattern, "a")


def _v1_catalog() -> Catalog[Any, Any]:
    return Catalog.from_json({
        "catalogId": "https://example.com/catalogs/test.json",
        "protocolVersion": "1.0",
        "components": {
            "Box": {
                "type": "object",
                "allOf": [{"$ref": "common_types.json#/$defs/ComponentCommon"}],
                "properties": {
                    "component": {"const": "Box"},
                    "slug": {"type": "string", "pattern": _IDENTIFIER},
                },
                "required": ["component"],
                "unevaluatedProperties": False,
            }
        },
    })


def test_validator_messages_show_the_original_pattern() -> None:
    validator = PayloadValidator(_v1_catalog(), config=STRICT_VALIDATION)
    with pytest.raises(A2uiValidationError) as exc_info:
        validator.validate_component({"id": "box", "component": "Box", "slug": "1a"})
    [detail] = exc_info.value.details
    assert detail.path == "components.box.slug"
    assert _IDENTIFIER in detail.message.replace("\\\\", "\\")
    assert len(detail.message) < _MAX_MESSAGE_LENGTH
    assert len(str(exc_info.value)) < _MAX_MESSAGE_LENGTH


@pytest.mark.parametrize("config", [STRICT_VALIDATION, RELAXED_VALIDATION])
def test_validator_checks_extension_keys(config: Any) -> None:
    validator = PayloadValidator(_v1_catalog(), config=config)
    validator.validate_component({
        "id": "box",
        "component": "Box",
        "metadata": {"extensions": {"good_key": 1, "名前": 2}},
    })

    # Unknown properties are tolerated under relaxed validation, but an
    # extension key that is not an identifier is always an error.
    with pytest.raises(A2uiValidationError) as exc_info:
        validator.validate_component({
            "id": "box",
            "component": "Box",
            "metadata": {"extensions": {"bad-key": 1}},
        })
    [detail] = [
        d
        for d in exc_info.value.details
        if d.path == "components.box.metadata.extensions"
    ]
    assert "'bad-key'" in detail.message
    assert len(detail.message) < _MAX_MESSAGE_LENGTH


def test_relaxed_validation_still_tolerates_unknown_properties() -> None:
    validator = PayloadValidator(_v1_catalog(), config=RELAXED_VALIDATION)
    validator.validate_component({"id": "box", "component": "Box", "extra": 1})
    with pytest.raises(A2uiValidationError):
        PayloadValidator(_v1_catalog(), config=STRICT_VALIDATION).validate_component(
            {"id": "box", "component": "Box", "extra": 1}
        )
