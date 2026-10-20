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

"""The catalogs that the Gemini Enterprise demo agent supports."""

import json
import os

from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import Catalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import CatalogConfig

# The A2UI v0.9 Gemini Enterprise composite catalog, copied into this agent's
# directory from
# https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json.
# It is the union of the Material catalog, the basic catalog and the Gemini
# Enterprise custom components, so a single surface can mix all three.
COMPOSITE_CATALOG_PATH = os.path.join(
    os.path.dirname(__file__), "gemini_enterprise_composite_catalog.json"
)
COMPOSITE_CATALOG_ID = (
    "https://www.gstatic.com/vertexaisearch/a2ui/v0_9/"
    "gemini_enterprise_composite_catalog.json"
)

# The Material catalog, which the examples under `examples/0.9/` name. It is
# what a client that names no catalogs, like Gemini Enterprise, is taken to
# render.
MATERIAL_CATALOG_ID = "https://a2ui.org/specification/v0_9/material_catalog.json"

# The Gemini Enterprise components that Material surfaces use, next to the
# `Material*` components.
_MATERIAL_SURFACE_COMPONENTS = ("Canvas", "IFrameSrcdoc", "IFrameUrl")


def build_catalog_configs(version: ProtocolVersion) -> list[CatalogConfig]:
    """Returns the Material catalog and the composite catalog.

    The repository has no definition of the Material catalog, so it is built
    from the composite catalog: the same document under the Material id, with
    only the `Material*`, `Canvas`, `IFrameSrcdoc` and `IFrameUrl` components.
    Its prompt is about 20% smaller than the composite catalog's.

    Args:
        version: The A2UI protocol version of the catalogs.
    """
    with open(COMPOSITE_CATALOG_PATH, encoding="utf-8") as f:
        composite = json.load(f)
    material_components = [
        name
        for name in composite["components"]
        if name.startswith("Material") or name in _MATERIAL_SURFACE_COMPONENTS
    ]
    material = Catalog.from_json(
        {**composite, "$id": MATERIAL_CATALOG_ID, "catalogId": MATERIAL_CATALOG_ID},
        protocol_version=version,
    )
    return [
        CatalogConfig(
            material,
            transformers=[ComponentPruningTransformer(material_components)],
        ),
        CatalogConfig.from_path(
            catalog_path=COMPOSITE_CATALOG_PATH, protocol_version=version
        ),
    ]
