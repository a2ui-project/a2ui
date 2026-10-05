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

"""JSON Schema Draft 2020-12 validator with ECMA-262 regular expression semantics."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
import functools
from typing import Any, Final

from jsonschema import Draft202012Validator
import jsonschema.exceptions
from jsonschema.validators import extend
import regex


# JSON Schema patterns are ECMA-262 regular expressions. `regex` natively
# supports Unicode property escapes such as `\p{XID_Start}` and
# `\p{XID_Continue}` (UAX #31); rewriting unescaped `$` outside character
# classes to `\Z` prevents `$` from matching before a trailing newline.
_DOLLAR_OUTSIDE_CLASS: Final[regex.Pattern[str]] = regex.compile(
    r"\\.|\[(?:\^?\]?)(?:\\.|[^\]])*\]|(\$)", regex.DOTALL
)


@functools.cache
def _compile_ecma_pattern(pattern: str) -> regex.Pattern[str]:
    ecma = _DOLLAR_OUTSIDE_CLASS.sub(
        lambda m: r"\Z" if m.group(1) is not None else m.group(0), pattern
    )
    return regex.compile(ecma)


def _ecma_search(pattern: str, value: str) -> bool:
    return _compile_ecma_pattern(pattern).search(value) is not None


def _validate_pattern(
    validator: Any, patrn: str, instance: Any, schema: Any
) -> Iterator[jsonschema.exceptions.ValidationError]:
    if validator.is_type(instance, "string") and not _ecma_search(patrn, instance):
        yield jsonschema.exceptions.ValidationError(
            f"{instance!r} does not match {patrn!r}"
        )


def _validate_pattern_properties(
    validator: Any,
    pattern_properties: Mapping[str, Any],
    instance: Any,
    schema: Any,
) -> Iterator[jsonschema.exceptions.ValidationError]:
    if not validator.is_type(instance, "object"):
        return
    for patrn, subschema in pattern_properties.items():
        for k, v in instance.items():
            if _ecma_search(patrn, k):
                yield from validator.descend(v, subschema, path=k, schema_path=patrn)


def _validate_additional_properties(
    validator: Any,
    additional_properties: Any,
    instance: Any,
    schema: Any,
) -> Iterator[jsonschema.exceptions.ValidationError]:
    if not validator.is_type(instance, "object"):
        return
    properties = schema.get("properties", {})
    patterns = tuple(schema.get("patternProperties", ()))
    extras = [
        prop
        for prop in instance
        if prop not in properties
        and not any(_ecma_search(patrn, prop) for patrn in patterns)
    ]
    if validator.is_type(additional_properties, "object"):
        for extra in extras:
            yield from validator.descend(
                instance[extra], additional_properties, path=extra
            )
    elif not additional_properties and extras:
        if "patternProperties" in schema:
            verb = "does" if len(extras) == 1 else "do"
            joined = ", ".join(repr(each) for each in sorted(extras))
            pattern_reprs = ", ".join(
                repr(each) for each in sorted(schema["patternProperties"])
            )
            yield jsonschema.exceptions.ValidationError(
                f"{joined} {verb} not match any of the regexes: {pattern_reprs}"
            )
        else:
            extras_sorted = sorted(extras, key=str)
            verb = "was" if len(extras_sorted) == 1 else "were"
            joined = ", ".join(repr(each) for each in extras_sorted)
            yield jsonschema.exceptions.ValidationError(
                f"Additional properties are not allowed ({joined} {verb} unexpected)"
            )


SchemaValidator: Any = extend(  # type: ignore[no-untyped-call]
    Draft202012Validator,
    validators={
        "additionalProperties": _validate_additional_properties,
        "pattern": _validate_pattern,
        "patternProperties": _validate_pattern_properties,
    },
)

_orig_evolve = SchemaValidator.evolve


def _evolve_schema_validator(self: Any, **changes: Any) -> Any:
    evolved: Any = _orig_evolve(self, **changes)
    if type(evolved) is Draft202012Validator:
        return self.__class__(
            schema=getattr(evolved, "schema"),
            resolver=getattr(evolved, "_ref_resolver"),
            format_checker=getattr(evolved, "format_checker"),
            _registry=getattr(evolved, "_registry"),
            _resolver=getattr(evolved, "_resolver"),
        )
    return evolved


SchemaValidator.evolve = _evolve_schema_validator
