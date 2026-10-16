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

"""Unit tests for `a2ui.utils.load_examples`."""

import json
from pathlib import Path

import pytest

from a2ui.core import A2uiCatalogError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.utils import load_examples


def _catalog(catalog_id: str) -> Catalog:
    return Catalog.from_json(
        {
            "catalogId": catalog_id,
            "components": {
                "Text": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Text"},
                        "text": {"type": "string"},
                    },
                    "required": ["component", "text"],
                }
            },
        },
        protocol_version="0.9",
    )


def _write_example(directory: Path, name: str, catalog_id: str) -> None:
    messages = [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": name, "catalogId": catalog_id},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": name,
                "components": [{"id": "root", "component": "Text", "text": "Hi"}],
            },
        },
    ]
    (directory / f"{name}.json").write_text(json.dumps(messages), encoding="utf-8")


def test_examples_are_wrapped_in_named_markers(tmp_path):
    _write_example(tmp_path, "greeting", "a")

    examples = load_examples([_catalog("a")], str(tmp_path))

    assert examples.startswith("---BEGIN greeting---\n")
    assert examples.endswith("\n---END greeting---")


def test_examples_are_validated_against_every_catalog(tmp_path):
    _write_example(tmp_path, "first", "a")
    _write_example(tmp_path, "second", "b")

    examples = load_examples(
        [_catalog("a"), _catalog("b")], str(tmp_path), validate=True
    )

    assert "---BEGIN first---" in examples
    assert "---BEGIN second---" in examples


def test_example_that_fails_validation_raises(tmp_path):
    _write_example(tmp_path, "first", "a")
    _write_example(tmp_path, "second", "b")

    with pytest.raises(A2uiCatalogError, match="second.json: Catalog not found: b"):
        load_examples([_catalog("a")], str(tmp_path), validate=True)


def test_examples_are_not_validated_by_default(tmp_path):
    _write_example(tmp_path, "second", "b")

    examples = load_examples([_catalog("a")], str(tmp_path))

    assert "---BEGIN second---" in examples


def test_example_that_is_not_json_raises_when_validated(tmp_path):
    (tmp_path / "broken.json").write_text("not json", encoding="utf-8")

    with pytest.raises(A2uiCatalogError, match="broken.json"):
        load_examples([_catalog("a")], str(tmp_path), validate=True)


def test_missing_path_loads_no_examples(tmp_path):
    assert load_examples([_catalog("a")], None) == ""
    assert load_examples([_catalog("a")], str(tmp_path / "*.json")) == ""


@pytest.mark.parametrize(
    ("version", "rel_dir", "expected_names"),
    [
        (
            ProtocolVersion.V0_8,
            "samples/agent/adk/restaurant_finder/examples/0.8",
            ("single_column_list", "two_column_list"),
        ),
        (
            ProtocolVersion.V0_9,
            "samples/agent/adk/restaurant_finder/examples/0.9",
            ("single_column_list", "two_column_list"),
        ),
        (
            ProtocolVersion.V0_8,
            "samples/community/agent/adk/gemini_enterprise/v0_8/agent_engine/examples/0.8",
            ("contact_list",),
        ),
        (
            ProtocolVersion.V0_8,
            "samples/community/agent/adk/gemini_enterprise/v0_8/cloud_run/examples/0.8",
            ("contact_list",),
        ),
    ],
)
def test_sample_examples_validate(
    version: ProtocolVersion, rel_dir: str, expected_names: tuple[str, ...]
):
    repo_root = Path(__file__).resolve().parents[4]
    examples_dir = repo_root / rel_dir
    if not examples_dir.is_dir():
        pytest.skip(f"Sample directory not present: {examples_dir}")

    examples = load_examples([BasicCatalog(version)], str(examples_dir), validate=True)

    for name in expected_names:
        assert f"---BEGIN {name}---" in examples
