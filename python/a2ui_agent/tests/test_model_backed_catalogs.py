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

"""Tests that the experimental formats read model-backed catalogs like JSON ones.

`BasicCatalog` builds its schema from models, whose components refer to the
catalog's own definitions, while `Catalog.from_json` writes them inline.
"""

from collections.abc import Callable
from typing import Any

import pytest

from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.experimental.atom import AtomFormat
from a2ui.inference_formats.experimental.elemental import ElementalFormat
from a2ui.inference_formats.experimental.express import ExpressCompiler, ExpressFormat

_FORMATS: dict[str, Callable[[CatalogApi], Any]] = {
    "atom": AtomFormat,
    "elemental": ElementalFormat,
    "express": lambda catalog: ExpressFormat(catalog, version=catalog.protocol_version),
}


def _from_json(catalog: CatalogApi) -> CatalogApi:
    return Catalog.from_json(
        catalog_schema=catalog.catalog_schema,
        protocol_version=catalog.protocol_version,
        catalog_id=catalog.catalog_id,
    )


@pytest.mark.parametrize("format_name", sorted(_FORMATS))
@pytest.mark.parametrize("version", ["0.9", "0.9.1", "1.0"])
def test_catalog_instructions_are_the_same_for_model_and_json_catalogs(
    version, format_name
):
    make_format = _FORMATS[format_name]
    catalog = BasicCatalog(version)

    from_models = make_format(catalog).prompt_generator.generate_catalog_instructions()
    from_json = make_format(
        _from_json(catalog)
    ).prompt_generator.generate_catalog_instructions()

    assert "weight" in from_models
    assert from_models == from_json


def test_express_compiler_accepts_weight_with_the_v0_9_basic_catalog():
    compiler = ExpressCompiler(BasicCatalog("0.9"), "v0.9")

    messages = compiler.compile('root = Column([t])\nt = Text("hi", weight=2)')

    components = messages[1]["updateComponents"]["components"]
    assert {"id": "t", "component": "Text", "text": "hi", "weight": 2} in components


@pytest.mark.parametrize("version", ["0.9", "1.0"])
def test_schema_helpers_keep_checkable_for_model_and_json_catalogs(version):
    catalog = BasicCatalog(version)
    for candidate in (catalog, _from_json(catalog)):
        helpers = (
            AtomFormat(candidate).prompt_generator.schema_helper,
            ExpressFormat(candidate, version=version).prompt_generator.helper,
        )
        for helper in helpers:
            assert helper.component_is_checkable["TextField"]
            assert not helper.component_is_checkable["Text"]
