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

"""Tests that catalog resolution links per-request copies of peer catalogs."""

from __future__ import annotations

import json
import os
from typing import Any

from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import Catalog, CatalogApi
from a2ui.processor import CatalogConfig
from a2ui.utils import resolve_catalogs

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_CATALOGS = os.path.join(_REPO_ROOT, "conformance", "test_data", "catalogs")


def _document(name: str) -> dict[str, Any]:
    with open(os.path.join(_CATALOGS, name), encoding="utf-8") as f:
        return json.load(f)


def _load(name: str) -> CatalogApi:
    return Catalog.from_json(_document(name), protocol_version="v1.0")


def _configs() -> list[CatalogConfig]:
    return [
        CatalogConfig(
            _load("simplified_catalog_v1_0.json"),
            transformers=[ComponentPruningTransformer(["Card", "Button"])],
        ),
        CatalogConfig(_load("cross_ref_catalog_v1_0.json")),
    ]


def _props(catalog: CatalogApi, name: str) -> dict[str, Any]:
    return catalog.validation_schema["components"][name]["properties"]


def test_resolve_catalogs_leaves_registered_catalogs_unchanged() -> None:
    configs = _configs()
    capabilities = {"v1.0": {"supportedCatalogIds": ["conformance/cross_ref"]}}

    first = resolve_catalogs(configs, capabilities)
    second = resolve_catalogs(configs, capabilities)

    for config in configs:
        assert config.catalog.peer_catalogs == ()
        assert config.transformed_catalog.peer_catalogs == ()
    assert first[0] is not second[0]
    assert first[0] is not configs[1].transformed_catalog
    # The pruned peer's unpruned source still resolves `Text`.
    assert "text" in _props(first[0], "CustomText")
    assert first[0].peer_catalogs == second[0].peer_catalogs


def test_resolve_catalogs_never_links_refused_inline_catalogs() -> None:
    configs = [CatalogConfig(_load("cross_ref_catalog_v1_0.json"))]
    # The simplified catalog without `openUrl`, which an inline catalog can't
    # declare with requiresUserActivation.
    inline = _document("simplified_catalog_v1_0.json")
    del inline["functions"]["openUrl"]
    inline["$defs"]["anyFunction"]["oneOf"] = [
        ref
        for ref in inline["$defs"]["anyFunction"]["oneOf"]
        if ref["$ref"] != "#/functions/openUrl"
    ]
    capabilities = {
        "v1.0": {
            "supportedCatalogIds": ["conformance/cross_ref"],
            "inlineCatalogs": [inline],
        }
    }

    refused = resolve_catalogs(configs, capabilities, accepts_inline_catalogs=False)

    assert [c.catalog_id for c in refused] == ["conformance/cross_ref"]
    assert refused[0].peer_catalogs == ()
    assert "text" not in _props(refused[0], "CustomText")

    accepted = resolve_catalogs(configs, capabilities, accepts_inline_catalogs=True)

    assert [c.catalog_id for c in accepted] == [
        "conformance/cross_ref",
        "conformance/simplified",
    ]
    assert "text" in _props(accepted[0], "CustomText")
    assert configs[0].catalog.peer_catalogs == ()
