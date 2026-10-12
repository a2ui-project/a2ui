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

"""Tests the published documents that the basic catalogs carry."""

import json
import os
from typing import Any

import pytest

from a2ui.core.basic_catalog import v0_8, v0_9, v1_0
from a2ui.core.catalog import Catalog

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
PACKAGE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../src/a2ui/core/basic_catalog")
)

# Each basic catalog module, its version package, and its published file.
CASES = [
    (v0_8, "v0_8", "specification/v0_8/json/standard_catalog_definition.json"),
    (v0_9, "v0_9", "specification/v0_9/catalogs/basic/catalog.json"),
    (v1_0, "v1_0", "catalogs/basic/v1/catalog.json"),
]


def _load(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.parametrize(("module", "version_dir", "published"), CASES)
def test_shipped_copy_matches_the_published_file(
    module: Any, version_dir: str, published: str
) -> None:
    del module  # Unused.
    shipped = os.path.join(PACKAGE_DIR, version_dir, "catalog.json")

    assert _load(shipped) == _load(
        os.path.join(REPO_ROOT, published)
    ), f"Copy {published} to {shipped}."


@pytest.mark.parametrize(("module", "version_dir", "published"), CASES)
def test_to_json_returns_the_published_document(
    module: Any, version_dir: str, published: str
) -> None:
    del version_dir  # Unused.
    catalog = module.BasicCatalog()

    assert catalog.to_json() == _load(os.path.join(REPO_ROOT, published))


def test_adopting_the_document_leaves_shared_entries_unchanged() -> None:
    catalog = v1_0.BasicCatalog()

    assert catalog.components["Text"].source_json is not None
    assert v1_0.TEXT_COMPONENT_API.source_json is None


@pytest.mark.parametrize(("module", "version_dir", "published"), CASES)
def test_the_published_document_leaves_validation_schema_unchanged(
    module: Any, version_dir: str, published: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Prompts are built from `validation_schema`, so carrying the document
    # must only add the `protocolVersion` it declares.
    del version_dir  # Unused.
    adopted = module.BasicCatalog().validation_schema
    monkeypatch.setattr(Catalog, "_adopt_source_document", lambda self, doc: None)
    plain = module.BasicCatalog().validation_schema

    declared = _load(os.path.join(REPO_ROOT, published)).get("protocolVersion")
    if declared is not None:
        assert adopted.pop("protocolVersion") == declared
    assert adopted == plain
