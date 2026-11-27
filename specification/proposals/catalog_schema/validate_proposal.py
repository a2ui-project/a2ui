#!/usr/bin/env python3
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

"""Validates the A2UI Catalog Document meta-schema and example catalogs."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any

import jsonschema
from jsonschema import Draft202012Validator, validators
import regex

PROPOSAL_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = PROPOSAL_DIR / "catalog_schema.json"
EXAMPLES_DIR = PROPOSAL_DIR / "examples"


def _pattern_with_unicode(validator: Any, patrn: str, instance: Any, schema: Any):
    if validator.is_type(instance, "string") and not regex.search(patrn, instance):
        yield jsonschema.ValidationError(f"{instance!r} does not match {patrn!r}")


def _pattern_properties_with_unicode(
    validator: Any, pattern_properties: dict[str, Any], instance: Any, schema: Any
):
    if not validator.is_type(instance, "object"):
        return
    for patrn, subschema in pattern_properties.items():
        for k, v in instance.items():
            if regex.search(patrn, k):
                yield from validator.descend(v, subschema, path=k, schema_path=patrn)


UnicodeDraft202012Validator = validators.extend(
    Draft202012Validator,
    validators={
        "pattern": _pattern_with_unicode,
        "patternProperties": _pattern_properties_with_unicode,
    },
)


def _check_meta_schema(schema: dict[str, Any]) -> None:
    fc = Draft202012Validator.FORMAT_CHECKER

    @fc.checks("regex", ValueError)
    def _is_unicode_regex(instance: object) -> bool:
        if not isinstance(instance, str):
            return True
        regex.compile(instance)
        return True

    meta_validator = UnicodeDraft202012Validator(
        Draft202012Validator.META_SCHEMA, format_checker=fc
    )
    meta_validator.validate(schema)


def _check_semantic_invariants(doc: dict[str, Any]) -> list[str]:
    """Checks semantic invariants that JSON Schema alone cannot enforce."""
    errors: list[str] = []
    defined_types = set((doc.get("types") or {}).keys())

    def _check_unique_names(items: list[dict[str, Any]], scope: str) -> set[str]:
        seen: set[str] = set()
        for item in items:
            name = item.get("name")
            if isinstance(name, str):
                if name in seen:
                    errors.append(f"Duplicate name {name!r} in {scope}")
                seen.add(name)
        return seen

    def _walk_type(node: dict[str, Any], path: str) -> None:
        kind = node.get("type")
        if kind == "ref":
            ref_name = node.get("ref")
            if ref_name not in defined_types:
                errors.append(f"{path}: unresolved local type ref {ref_name!r}")
        elif kind == "object":
            props = node.get("properties") or []
            prop_names = _check_unique_names(props, f"{path}.properties")
            for p in props:
                _walk_type(p, f"{path}.{p.get('name', '?')}")
            for group in node.get("atLeastOneOf") or []:
                for name in group:
                    if name not in prop_names:
                        errors.append(
                            f"{path}.atLeastOneOf references unknown property {name!r}"
                        )
            ap = node.get("additionalProperties")
            if isinstance(ap, dict):
                _walk_type(ap, f"{path}.additionalProperties")
        elif kind == "array":
            if isinstance(node.get("items"), dict):
                _walk_type(node["items"], f"{path}.items")
        elif kind == "union":
            for i, variant in enumerate(node.get("variants") or []):
                _walk_type(variant, f"{path}.variants[{i}]")

    for type_name, type_def in (doc.get("types") or {}).items():
        _walk_type(type_def, f"types.{type_name}")

    sp = doc.get("surfaceProperties")
    if isinstance(sp, dict):
        props = sp.get("properties") or []
        _check_unique_names(props, "surfaceProperties.properties")
        for p in props:
            _walk_type(p, f"surfaceProperties.{p.get('name', '?')}")

    components = doc.get("components") or []
    _check_unique_names(components, "components")
    for comp in components:
        params = comp.get("parameters") or []
        param_names = _check_unique_names(
            params, f"components.{comp['name']}.parameters"
        )
        for p in params:
            _walk_type(p, f"components.{comp['name']}.{p['name']}")
        for group in comp.get("atLeastOneOf") or []:
            for name in group:
                if name not in param_names:
                    errors.append(
                        f"components.{comp['name']}.atLeastOneOf references unknown"
                        f" param {name!r}"
                    )

    functions = doc.get("functions") or []
    _check_unique_names(functions, "functions")
    for fn in functions:
        params = fn.get("parameters") or []
        param_names = _check_unique_names(params, f"functions.{fn['name']}.parameters")
        for p in params:
            _walk_type(p, f"functions.{fn['name']}.{p['name']}")
        for group in fn.get("atLeastOneOf") or []:
            for name in group:
                if name not in param_names:
                    errors.append(
                        f"functions.{fn['name']}.atLeastOneOf references unknown param"
                        f" {name!r}"
                    )
        ret = fn.get("returnType")
        if isinstance(ret, dict) and ret.get("type") not in (
            "void",
            "validationResult",
        ):
            _walk_type(ret, f"functions.{fn['name']}.returnType")

    return errors


def _negative_cases() -> list[tuple[str, dict[str, Any]]]:
    return [
        ("missing formatVersion", {"catalogId": "urn:test"}),
        ("wrong formatVersion", {"formatVersion": "2.0", "catalogId": "urn:test"}),
        (
            "reserved component name Surface",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "components": [{"name": "Surface"}],
            },
        ),
        (
            "invalid component identifier with hyphen",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "components": [{"name": "my-button"}],
            },
        ),
        (
            "at-prefixed function name",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "functions": [{"name": "@index", "returnType": "number"}],
            },
        ),
        (
            "requiresUserActivation with agentOnly caller",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "functions": [{
                    "name": "openThing",
                    "returnType": "void",
                    "requiresUserActivation": True,
                    "allowedCallers": "agentOnly",
                }],
            },
        ),
        (
            "component-only type child inside function parameter",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "functions": [{
                    "name": "badFn",
                    "returnType": "string",
                    "parameters": [{"name": "slot", "type": "child"}],
                }],
            },
        ),
        (
            "component-only type action inside root types",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "types": {"BadAction": {"type": "action"}},
            },
        ),
        (
            "component-only type childList inside surfaceProperties",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "surfaceProperties": {
                    "properties": [{"name": "kids", "type": "childList"}]
                },
            },
        ),
        (
            "missing name on component parameter",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "components": [{
                    "name": "Card",
                    "parameters": [{"type": "string"}],
                }],
            },
        ),
        (
            "spurious name on unnamed array items",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "components": [{
                    "name": "Card",
                    "parameters": [{
                        "name": "tags",
                        "type": "array",
                        "items": {"name": "illegal", "type": "string"},
                    }],
                }],
            },
        ),
        (
            "unknown property on StringType parameter",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "components": [{
                    "name": "Text",
                    "parameters": [{"name": "label", "type": "string", "min": 3}],
                }],
            },
        ),
        (
            "float default on integer parameter",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "components": [{
                    "name": "Slider",
                    "parameters": [
                        {"name": "steps", "type": "integer", "default": 1.5}
                    ],
                }],
            },
        ),
        (
            "missing returnType on function",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "functions": [{"name": "fn"}],
            },
        ),
        (
            "union with only 1 variant",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "components": [{
                    "name": "Icon",
                    "parameters": [{
                        "name": "name",
                        "type": "union",
                        "variants": [{"type": "string"}],
                    }],
                }],
            },
        ),
        (
            "unknown root property",
            {
                "formatVersion": "1.0",
                "catalogId": "urn:test",
                "$defs": {},
            },
        ),
    ]


def main() -> int:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    _check_meta_schema(schema)
    print(f"Meta-schema check passed: {SCHEMA_PATH.name}")

    validator = UnicodeDraft202012Validator(schema)

    # Positive examples
    example_files = sorted(EXAMPLES_DIR.glob("*.catalog.json"))
    assert example_files, f"No example files found in {EXAMPLES_DIR}"
    for path in example_files:
        doc = json.loads(path.read_text(encoding="utf-8"))
        errs = list(validator.iter_errors(doc))
        if errs:
            print(f"FAIL positive example {path.name}:")
            for err in errs:
                print(f"  - {list(err.absolute_path)}: {err.message}")
            return 1
        sem_errs = _check_semantic_invariants(doc)
        if sem_errs:
            print(f"FAIL semantic invariants on {path.name}:")
            for err in sem_errs:
                print(f"  - {err}")
            return 1
        print(f"PASS positive example: {path.name}")

    # Unicode UAX #31 positive smoke test
    unicode_doc = {
        "formatVersion": "1.0",
        "catalogId": "urn:a2ui:unicode-test",
        "protocolVersion": "1.0",
        "metadata": {"extensions": {"αβ_ext": True}},
        "components": [{
            "name": "Κάρτα",
            "parameters": [{"name": "τίτλος", "type": "string", "dynamic": True}],
        }],
    }
    errs = list(validator.iter_errors(unicode_doc))
    if errs:
        print(f"FAIL unicode UAX #31 positive case: {errs}")
        return 1
    print("PASS unicode UAX #31 identifier case")

    # Negative cases
    for label, bad_doc in _negative_cases():
        errs = list(validator.iter_errors(bad_doc))
        if not errs:
            print(f"FAIL negative case was unexpectedly accepted: {label}")
            return 1
        print(f"PASS negative case rejected: {label}")

    print(
        f"\nAll checks passed ({len(example_files)} examples + unicode + "
        f"{len(_negative_cases())} negative cases)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
