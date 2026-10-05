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

"""Runs the shared catalog suites in `conformance/agent/`.

The suites are written against the blueprint APIs, so a case runs against
`CatalogConfig` and the transformers in `a2ui.catalog_transformers` directly.
"""

from collections.abc import Mapping
from typing import Any

import pytest

from a2ui.catalog_transformers import (
    CatalogTransformer,
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import Catalog, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.schema import CatalogConfig

from .conformance_helpers import load_conformance_json, load_conformance_yaml


def _transformer(spec: Mapping[str, Any]) -> CatalogTransformer:
    if "component_pruning" in spec:
        return ComponentPruningTransformer(spec["component_pruning"])
    if "function_pruning" in spec:
        return FunctionPruningTransformer(spec["function_pruning"])
    raise ValueError(f"Unknown transformer: {spec}")


def _catalog_config(entry: str | Mapping[str, Any]) -> CatalogConfig:
    """Builds the catalog registration that a case describes.

    A catalog document without a `catalogId` takes its path as its id, and one
    without a `protocolVersion` runs under v1.0, the version every case is
    written against.
    """
    if isinstance(entry, str):
        entry = {"catalog": entry}
    path = entry["catalog"]
    document = load_conformance_json(path)
    catalog = Catalog.from_json(
        document,
        protocol_version=document.get("protocolVersion", "1.0"),
        catalog_id=document.get("catalogId", path),
    )
    return CatalogConfig.from_catalog(
        path,
        catalog,
        transformers=[_transformer(spec) for spec in entry.get("transformers", [])],
    )


def _expect_catalog(catalog: CatalogApi, expected: Mapping[str, Any]) -> None:
    """Checks a catalog against a case's expectations. Name lists are exhaustive."""
    if "catalog_id" in expected:
        assert catalog.catalog_id == expected["catalog_id"]
    if "protocol_version" in expected:
        assert (
            to_protocol_version(catalog.protocol_version).value
            == expected["protocol_version"]
        )
    if "components" in expected:
        assert sorted(catalog.components) == sorted(set(expected["components"]))
    if "functions" in expected:
        assert sorted(catalog.functions) == sorted(set(expected["functions"]))


transformer_cases = load_conformance_yaml("agent/catalog_transformer.yaml")


def test_catalog_transformer_suite_is_not_empty():
    assert transformer_cases


@pytest.mark.parametrize(
    "case", transformer_cases, ids=[case["name"] for case in transformer_cases]
)
def test_catalog_transformer_conformance(case):
    assert case["action"] == "transform_catalog"
    catalog = _catalog_config(case["args"]).to_catalog()
    _expect_catalog(catalog, case["expect"])
