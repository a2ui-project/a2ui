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

"""Unit tests for `a2ui.utils.resolve_catalogs`.

The shared `catalog_resolution.yaml` suite covers the negotiation rules under
v1.0. These tests cover the capabilities shapes and versions it doesn't.
"""

import pytest

from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog
from a2ui.core.schema import v0_8, v0_9, v1_0
from a2ui.processor import CatalogConfig
from a2ui.utils import resolve_catalogs


def _config(catalog_id: str, protocol_version: str, *components: str) -> CatalogConfig:
    catalog = Catalog.from_json(
        {
            "catalogId": catalog_id,
            "components": {
                name: {"type": "object", "properties": {"component": {"const": name}}}
                for name in components
            },
        },
        protocol_version=protocol_version,
    )
    return CatalogConfig(catalog)


def _ids(catalogs) -> list[str]:
    return [catalog.catalog_id for catalog in catalogs]


def test_active_catalogs_follow_the_renderer_preference_order():
    catalogs = [_config("a", "0.9", "Text"), _config("b", "0.9", "Text")]

    resolved = resolve_catalogs(catalogs, {"v0.9": {"supportedCatalogIds": ["b", "a"]}})

    assert _ids(resolved) == ["b", "a"]


def test_repeated_ids_activate_a_catalog_once():
    catalogs = [_config("a", "0.9", "Text")]

    resolved = resolve_catalogs(catalogs, {"v0.9": {"supportedCatalogIds": ["a", "a"]}})

    assert _ids(resolved) == ["a"]


def test_absent_capabilities_return_the_registered_catalogs_transformed():
    config = CatalogConfig(
        _config("a", "0.9", "Text", "Image").transformed_catalog,
        transformers=[ComponentPruningTransformer(["Text"])],
    )

    (resolved,) = resolve_catalogs([config], None)

    assert set(resolved.components) == {"Text"}


def test_absent_capabilities_without_catalogs_return_nothing():
    assert resolve_catalogs([], None) == []


@pytest.mark.parametrize(
    "capabilities",
    [
        v0_9.A2uiClientCapabilities.model_validate(
            {"v0.9": {"supportedCatalogIds": ["a"]}}
        ),
        {"v0.9": {"supported_catalog_ids": ["a"]}},
    ],
    ids=["model", "field_names"],
)
def test_capabilities_models_and_field_names_are_accepted(capabilities):
    resolved = resolve_catalogs([_config("a", "0.9", "Text")], capabilities)

    assert _ids(resolved) == ["a"]


@pytest.mark.parametrize(
    ("protocol_version", "capabilities"),
    [
        (
            "0.8",
            v0_8.A2uiClientCapabilities.model_validate(
                {"v0.8": {"supportedCatalogIds": ["a"]}}
            ),
        ),
        ("0.9.1", {"v0.9.1": {"supportedCatalogIds": ["a"]}}),
        (
            "1.0",
            v1_0.A2uiRendererCapabilities.model_validate(
                {"v1.0": {"supportedCatalogIds": ["a"]}}
            ),
        ),
    ],
    ids=["v0.8", "v0.9.1", "v1.0"],
)
def test_each_version_reads_its_own_capabilities_key(protocol_version, capabilities):
    resolved = resolve_catalogs([_config("a", protocol_version, "Text")], capabilities)

    assert _ids(resolved) == ["a"]


def test_a_renderer_may_send_capabilities_for_several_versions():
    capabilities = {
        "v0.9": {"supportedCatalogIds": ["old"]},
        "v1.0": {"supportedCatalogIds": ["a"]},
    }

    resolved = resolve_catalogs([_config("a", "1.0", "Text")], capabilities)

    assert _ids(resolved) == ["a"]


def test_v0_9_catalogs_read_the_v0_9_1_entry():
    resolved = resolve_catalogs(
        [_config("a", "0.9", "Text")], {"v0.9.1": {"supportedCatalogIds": ["a"]}}
    )

    assert _ids(resolved) == ["a"]


def test_v0_9_1_catalogs_fall_back_to_the_v0_9_entry():
    resolved = resolve_catalogs(
        [_config("a", "0.9.1", "Text")], {"v0.9": {"supportedCatalogIds": ["a"]}}
    )

    assert _ids(resolved) == ["a"]


@pytest.mark.parametrize("protocol_version", ["0.9", "0.9.1"])
def test_the_v0_9_1_entry_is_read_before_the_v0_9_entry(protocol_version):
    catalogs = [
        _config("a", protocol_version, "Text"),
        _config("b", protocol_version, "Text"),
    ]
    capabilities = {
        "v0.9": {"supportedCatalogIds": ["b"]},
        "v0.9.1": {"supportedCatalogIds": ["a"]},
    }

    resolved = resolve_catalogs(catalogs, capabilities)

    assert _ids(resolved) == ["a"]


def test_v0_9_and_v0_9_1_catalogs_resolve_together():
    catalogs = [_config("a", "0.9", "Text"), _config("b", "0.9.1", "Text")]

    resolved = resolve_catalogs(
        catalogs, {"v0.9.1": {"supportedCatalogIds": ["a", "b"]}}
    )

    assert _ids(resolved) == ["a", "b"]


@pytest.mark.parametrize(
    "capabilities",
    [
        {"v1.0": {"supportedCatalogIds": ["a"]}},
        v1_0.A2uiRendererCapabilities.model_validate(
            {"v1.0": {"supportedCatalogIds": ["a"]}}
        ),
        {"supportedCatalogIds": ["a"]},
    ],
    ids=["other_version_mapping", "other_version_model", "unkeyed"],
)
def test_capabilities_without_the_catalogs_version_are_invalid(capabilities):
    with pytest.raises(A2uiValidationError, match="no 'v0.9.1' or 'v0.9' entry"):
        resolve_catalogs([_config("a", "0.9", "Text")], capabilities)


@pytest.mark.parametrize(
    "entry",
    [{"supportedCatalogIds": "a"}, {}],
    ids=["ids_not_a_list", "ids_missing"],
)
def test_malformed_capabilities_are_invalid(entry):
    with pytest.raises(A2uiValidationError, match="Invalid 'v0.9' renderer"):
        resolve_catalogs([_config("a", "0.9", "Text")], {"v0.9": entry})


def test_no_match_names_the_registered_catalogs():
    with pytest.raises(
        A2uiCatalogError, match=r"No client-supported catalog found.*\['a'\]"
    ):
        resolve_catalogs(
            [_config("a", "0.9", "Text")],
            {"v0.9": {"supportedCatalogIds": ["unknown"]}},
        )


def test_catalogs_that_read_different_capabilities_keys_are_rejected():
    catalogs = [_config("a", "0.9", "Text"), _config("b", "1.0", "Text")]

    with pytest.raises(A2uiCatalogError, match="different capabilities entries"):
        resolve_catalogs(catalogs, {"v1.0": {"supportedCatalogIds": ["b"]}})


def test_inline_catalogs_use_the_registered_catalogs_version():
    capabilities = {
        "v0.9": {
            "supportedCatalogIds": [],
            "inlineCatalogs": [{
                "catalogId": "inline",
                "components": {"Marquee": {"type": "object"}},
            }],
        }
    }

    (resolved,) = resolve_catalogs(
        [_config("a", "0.9", "Text")], capabilities, accepts_inline_catalogs=True
    )

    assert resolved.catalog_id == "inline"
    assert resolved.protocol_version == "v0.9"
    assert set(resolved.components) == {"Marquee"}


def test_an_active_catalog_keeps_its_id_over_an_inline_catalog():
    capabilities = {
        "v0.9": {
            "supportedCatalogIds": ["a"],
            "inlineCatalogs": [
                {"catalogId": "a", "components": {"Marquee": {"type": "object"}}}
            ],
        }
    }

    (resolved,) = resolve_catalogs(
        [_config("a", "0.9", "Text")], capabilities, accepts_inline_catalogs=True
    )

    assert set(resolved.components) == {"Text"}


@pytest.mark.parametrize("accepts_inline_catalogs", [True, False])
@pytest.mark.parametrize(
    "inline_catalog",
    [
        {"components": {"Marquee": {"type": "object"}}},
        {"catalogId": "", "components": {"Marquee": {"type": "object"}}},
        {"catalogId": 123, "components": {"Marquee": {"type": "object"}}},
        {"catalogId": "i", "components": "not_a_dict"},
        {"catalogId": "i", "components": {"Marquee": "not_a_dict"}},
    ],
    ids=[
        "missing_catalog_id",
        "empty_catalog_id",
        "non_string_catalog_id",
        "invalid_components",
        "invalid_component_schema",
    ],
)
def test_invalid_inline_catalog_is_a_catalog_error(
    inline_catalog, accepts_inline_catalogs
):
    capabilities = {
        "v0.9": {
            "supportedCatalogIds": ["a"],
            "inlineCatalogs": [inline_catalog],
        }
    }

    with pytest.raises(A2uiCatalogError):
        resolve_catalogs(
            [_config("a", "0.9", "Text")],
            capabilities,
            accepts_inline_catalogs=accepts_inline_catalogs,
        )


@pytest.mark.parametrize("accepts_inline_catalogs", [True, False])
@pytest.mark.parametrize(
    "inline_catalogs",
    [["not_a_dict"], "not_a_list"],
    ids=["non_dict_entry", "non_list_value"],
)
def test_malformed_inline_catalogs_are_a_catalog_error(
    inline_catalogs, accepts_inline_catalogs
):
    capabilities = {
        "v1.0": {
            "supportedCatalogIds": ["a"],
            "inlineCatalogs": inline_catalogs,
        }
    }

    with pytest.raises(A2uiCatalogError):
        resolve_catalogs(
            [_config("a", "1.0", "Text")],
            capabilities,
            accepts_inline_catalogs=accepts_inline_catalogs,
        )


def test_mixed_top_level_and_inline_catalog_errors_raise_validation_error():
    capabilities = {
        "v1.0": {
            "inlineCatalogs": [{"components": {"Marquee": {"type": "object"}}}],
        }
    }

    with pytest.raises(A2uiValidationError) as exc_info:
        resolve_catalogs(
            [_config("a", "1.0", "Text")], capabilities, accepts_inline_catalogs=True
        )
    assert type(exc_info.value) is A2uiValidationError
