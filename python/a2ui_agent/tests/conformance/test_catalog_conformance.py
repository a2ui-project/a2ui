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
`FileSystemCatalogProvider`, `InMemoryCatalogProvider`, `CatalogConfig`, the
transformers in `a2ui.catalog_transformers`, and `a2ui.utils.resolve_catalogs`
directly.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from a2ui.catalog_transformers import (
    CatalogTransformer,
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import A2uiCatalogError, A2uiValidationError, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.processor import (
    CatalogConfig,
    FileSystemCatalogProvider,
    InMemoryCatalogProvider,
)
from a2ui.utils import resolve_catalogs

from .conformance_helpers import (
    assert_known_keys,
    case_params,
    get_conformance_path,
    load_conformance_json,
    load_conformance_yaml,
)

_CASE_KEYS = frozenset({
    "name",
    "description",
    "features",
    "action",
    "args",
    "expect",
    "expect_error",
})
_EXPECT_ERROR_KEYS = frozenset({"category", "message"})
_CATALOG_EXPECT_KEYS = frozenset({
    "catalog_id",
    "protocol_version",
    "components",
    "functions",
})
_RESOLVE_EXPECT_KEYS = frozenset({"active_catalog_ids", "catalogs"})


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
    catalog = InMemoryCatalogProvider(
        document,
        protocol_version=None if "protocolVersion" in document else "1.0",
        catalog_id=None if "catalogId" in document else path,
    ).load()
    return CatalogConfig(
        catalog,
        transformers=[_transformer(spec) for spec in entry.get("transformers", [])],
    )


def _expect_catalog(catalog: CatalogApi, expected: Mapping[str, Any]) -> None:
    """Checks a catalog against a case's expectations. Name lists are exhaustive."""
    assert_known_keys(expected, _CATALOG_EXPECT_KEYS, "expect.catalog")
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


_ERROR_CATEGORIES: dict[str, type[Exception]] = {
    "CatalogError": A2uiCatalogError,
    "ValidationError": A2uiValidationError,
}

provider_cases = load_conformance_yaml("agent/catalog_provider.yaml")


def test_catalog_provider_suite_is_not_empty() -> None:
    assert provider_cases


@pytest.mark.parametrize(
    "suite, case",
    case_params("agent/catalog_provider.yaml", provider_cases),
)
def test_catalog_provider_conformance(suite: str, case: Mapping[str, Any]) -> None:
    del suite
    assert case["action"] == "provide_catalog"
    assert_known_keys(case, _CASE_KEYS, "provide_catalog case")
    args = case["args"]

    def provide() -> CatalogApi:
        provider_type = args.get("provider", "file_system")
        if provider_type == "file_system":
            return FileSystemCatalogProvider(
                get_conformance_path(args["path"]),
                protocol_version=args.get("protocol_version"),
                catalog_id=args.get("catalog_id"),
            ).load()
        if provider_type == "in_memory":
            return InMemoryCatalogProvider(
                args["catalog"],
                protocol_version=args.get("protocol_version"),
                catalog_id=args.get("catalog_id"),
            ).load()
        raise ValueError(f"Unknown provider: {provider_type}")

    if "expect_error" in case:
        assert_known_keys(case["expect_error"], _EXPECT_ERROR_KEYS, "expect_error")
        with pytest.raises(
            _ERROR_CATEGORIES[case["expect_error"]["category"]],
            match=case["expect_error"].get("message"),
        ):
            provide()
        return

    catalog = provide()
    _expect_catalog(catalog, case["expect"])


transformer_cases = load_conformance_yaml("agent/catalog_transformer.yaml")


def test_catalog_transformer_suite_is_not_empty() -> None:
    assert transformer_cases


@pytest.mark.parametrize(
    "suite, case",
    case_params("agent/catalog_transformer.yaml", transformer_cases),
)
def test_catalog_transformer_conformance(suite: str, case: Mapping[str, Any]) -> None:
    del suite
    assert case["action"] == "transform_catalog"
    assert_known_keys(case, _CASE_KEYS, "transform_catalog case")
    catalog = _catalog_config(case["args"]).transformed_catalog
    _expect_catalog(catalog, case["expect"])


resolution_cases = load_conformance_yaml("agent/catalog_resolution.yaml")


def test_catalog_resolution_suite_is_not_empty() -> None:
    assert resolution_cases


@pytest.mark.parametrize(
    "suite, case",
    case_params("agent/catalog_resolution.yaml", resolution_cases),
)
def test_catalog_resolution_conformance(suite: str, case: Mapping[str, Any]) -> None:
    del suite
    assert case["action"] == "resolve_catalogs"
    assert_known_keys(case, _CASE_KEYS, "resolve_catalogs case")
    args = case["args"]

    def resolve() -> list[CatalogApi]:
        return resolve_catalogs(
            [_catalog_config(entry) for entry in args["catalogs"]],
            args.get("renderer_capabilities"),
            accepts_inline_catalogs=args.get("accepts_inline_catalogs", False),
        )

    if "expect_error" in case:
        assert_known_keys(case["expect_error"], _EXPECT_ERROR_KEYS, "expect_error")
        with pytest.raises(
            _ERROR_CATEGORIES[case["expect_error"]["category"]],
            match=case["expect_error"].get("message"),
        ):
            resolve()
        return

    catalogs = resolve()
    expect = case["expect"]
    assert_known_keys(expect, _RESOLVE_EXPECT_KEYS, "resolve_catalogs expect")
    catalog_ids = [catalog.catalog_id for catalog in catalogs]
    assert sorted(catalog_ids) == sorted(expect["active_catalog_ids"])
    by_id = {catalog.catalog_id: catalog for catalog in catalogs}
    for expected in expect.get("catalogs", []):
        _expect_catalog(by_id[expected["catalog_id"]], expected)
