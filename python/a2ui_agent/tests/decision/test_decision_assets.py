# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Tests that the vendored decision assets match the repository and their schemas."""

from __future__ import annotations

import json
import os
from typing import Any

from jsonschema import Draft202012Validator
import pytest

from a2ui.inference_formats.decision.archetypes import asset_path, load_asset

from ..repo_paths import find_repo_root

# Canonical file (relative to the repository root) to vendored asset parts.
_ASSET_SOURCES: dict[str, tuple[str, ...]] = {
    "catalogs/decision/v1/archetypes.json": ("archetypes.json",),
    "catalogs/decision/v1/archetype_definition.json": ("archetype_definition.json",),
    "catalogs/decision/v1/pattern_definition.json": ("pattern_definition.json",),
    "catalogs/basic/v1/patterns.json": ("patterns", "basic_v1_0.json"),
}

_BASIC_V10_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
_BASIC_V09_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"


def _errors(schema: dict[str, Any], data: Any) -> list[str]:
    validator = Draft202012Validator(schema)
    return [
        f"/{'/'.join(str(p) for p in e.absolute_path)}: {e.message}"
        for e in validator.iter_errors(data)
    ]


@pytest.mark.parametrize("source", sorted(_ASSET_SOURCES))
def test_vendored_asset_matches_canonical_file(source: str) -> None:
    repo_root = find_repo_root()
    if repo_root is None or not os.path.isfile(os.path.join(repo_root, source)):
        pytest.skip("repository checkout not available")
    with open(os.path.join(repo_root, source), encoding="utf-8") as handle:
        canonical = handle.read()
    vendored = asset_path(*_ASSET_SOURCES[source]).read_text(encoding="utf-8")
    assert vendored == canonical, (
        f"{source} differs from its vendored copy; run"
        " `uv run python scripts/sync_decision_assets.py` in python/a2ui_agent"
    )


@pytest.mark.parametrize(
    "schema_name", ["archetype_definition.json", "pattern_definition.json"]
)
def test_schemas_are_valid_draft_2020_12(schema_name: str) -> None:
    schema = load_asset(schema_name)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    Draft202012Validator.check_schema(schema)


def test_archetypes_validate_against_schema() -> None:
    schema = load_asset("archetype_definition.json")
    grammar = load_asset("archetypes.json")
    assert _errors(schema, grammar) == []
    assert grammar["$schema"] == schema["$id"]


def test_basic_patterns_validate_against_schema() -> None:
    schema = load_asset("pattern_definition.json")
    patterns = load_asset("patterns", "basic_v1_0.json")
    assert _errors(schema, patterns) == []
    assert patterns["$schema"] == schema["$id"]


def test_basic_patterns_list_both_basic_catalog_ids() -> None:
    patterns = load_asset("patterns", "basic_v1_0.json")
    assert patterns["catalogIds"] == [_BASIC_V10_ID, _BASIC_V09_ID]


def test_basic_patterns_cover_the_expected_names() -> None:
    patterns = load_asset("patterns", "basic_v1_0.json")["patterns"]
    expected = {
        "page",
        "banner",
        "picture",
        "media",
        "filters",
        "headline",
        "facts",
        "prose",
        "collection",
        "comparison",
        "steps",
        "form",
        "groups",
        "actions",
        "outcome",
        "conversation",
        "compose",
    }
    assert set(patterns) == expected
    assert not {"chart", "timeline", "map"} & set(patterns)
    assert patterns["collection"]["knobs"]["layout"] == ["rows", "cards", "reel"]


def test_archetype_schema_rejects_unknown_properties() -> None:
    schema = load_asset("archetype_definition.json")
    grammar = json.loads(json.dumps(load_asset("archetypes.json")))
    grammar["blocks"][0]["colour"] = "red"
    grammar["archetypes"][0]["blocks"].append("bad-mark!!")
    errors = _errors(schema, grammar)
    assert any("colour" in e for e in errors)
    assert any("bad-mark!!" in e for e in errors)


def test_pattern_schema_rejects_unknown_directive() -> None:
    schema = load_asset("pattern_definition.json")
    patterns = json.loads(json.dumps(load_asset("patterns", "basic_v1_0.json")))
    patterns["patterns"]["banner"]["components"][0]["$unknown"] = "x"
    errors = _errors(schema, patterns)
    assert any("$unknown" in e for e in errors)
