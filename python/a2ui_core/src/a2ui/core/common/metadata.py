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
"""Extension metadata validation and cloning helpers for A2UI v1.0."""

from collections.abc import Mapping
import copy
from typing import Any, TypeAlias

from ..exceptions import A2uiValidationError
from .uax31 import is_valid_uax31_identifier

A2uiMetadata: TypeAlias = dict[str, Any]


def validate_metadata(metadata: Any, *, context: str = "metadata") -> None:
    """Validates an A2UI metadata envelope and its UAX #31 extension keys.

    Args:
        metadata: The metadata envelope to validate, or None.
        context: Human-readable context for error messages.

    Raises:
        A2uiValidationError: If metadata is not a mapping, contains unexpected
            top-level keys, or has an `extensions` entry whose key is not a
            valid UAX #31 identifier.
    """
    if metadata is None:
        return
    if not isinstance(metadata, Mapping):
        raise A2uiValidationError(
            f"Expected {context} to be a dictionary, got {type(metadata).__name__}."
        )
    for key in metadata:
        if key != "extensions":
            raise A2uiValidationError(
                f"Unexpected property '{key}' in {context}; only 'extensions' is"
                " allowed."
            )
    if "extensions" in metadata:
        extensions = metadata["extensions"]
        if not isinstance(extensions, Mapping):
            raise A2uiValidationError(
                f"Expected {context}.extensions to be a dictionary, got"
                f" {type(extensions).__name__}."
            )
        for key in extensions:
            if not isinstance(key, str) or not is_valid_uax31_identifier(key):
                raise A2uiValidationError(
                    f"Invalid UAX #31 extension identifier '{key}' in"
                    f" {context}.extensions."
                )


def clone_metadata(metadata: Mapping[str, Any] | None) -> A2uiMetadata | None:
    """Returns a deep copy of a metadata envelope, or None."""
    if metadata is None:
        return None
    return copy.deepcopy(dict(metadata))


def normalize_metadata(metadata: Mapping[str, Any] | None) -> A2uiMetadata | None:
    """Returns a deep copy of a metadata envelope, collapsing empty envelopes to None."""
    cloned = clone_metadata(metadata)
    if cloned is None:
        return None
    extensions = cloned.get("extensions")
    if not isinstance(extensions, dict) or not extensions:
        return None
    return cloned


def json_equals(a: Any, b: Any) -> bool:
    """Compares two JSON-like structures with strict boolean/numeric type distinction."""
    if a is b:
        return True
    if type(a) is not type(b):
        if isinstance(a, Mapping) and isinstance(b, Mapping):
            pass
        else:
            return False
    if isinstance(a, Mapping):
        if len(a) != len(b):
            return False
        return all(k in b and json_equals(v, b[k]) for k, v in a.items())
    if isinstance(a, list):
        if len(a) != len(b):
            return False
        return all(json_equals(x, y) for x, y in zip(a, b))
    return bool(a == b)


def metadata_equals(a: Mapping[str, Any] | None, b: Mapping[str, Any] | None) -> bool:
    """Compares two metadata envelopes structurally with strict JSON type equality."""
    norm_a = normalize_metadata(a)
    norm_b = normalize_metadata(b)
    return json_equals(norm_a, norm_b)


__all__ = [
    "A2uiMetadata",
    "clone_metadata",
    "json_equals",
    "metadata_equals",
    "normalize_metadata",
    "validate_metadata",
]
