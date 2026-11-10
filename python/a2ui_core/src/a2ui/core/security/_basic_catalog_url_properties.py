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

"""URL properties of the basic catalogs, whose documents carry no annotations.

The published basic catalog documents (and the generated component models)
have no `x-a2ui-url-context` keywords, so the SDK lists their URL properties
here. The list applies to a basic catalog by its ID, and to the basic
component models in any catalog, so the marks follow the components into
catalogs with other IDs.
"""

from __future__ import annotations

from collections.abc import Mapping
from functools import cache
from typing import Any, Final

from .url_security_policy import UrlContextAnnotation, UrlPropertyMap

_BASIC_COMPONENT_URL_PROPERTIES: Final[
    Mapping[str, Mapping[str, UrlContextAnnotation]]
] = {
    "Image": {"url": "media"},
    "Video": {"url": "media", "posterUrl": "media"},
    "AudioPlayer": {"url": "media"},
}

BASIC_CATALOG_IDS: Final[frozenset[str]] = frozenset({
    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
})
"""Identifiers of the basic catalogs, which share the theme's `iconUrl`."""

BASIC_CATALOG_URL_PROPERTIES: Final[UrlPropertyMap] = {
    catalog_id: _BASIC_COMPONENT_URL_PROPERTIES for catalog_id in BASIC_CATALOG_IDS
}
"""URL properties of the basic catalogs, by catalog ID, then component type.

The published basic catalog documents carry no `x-a2ui-url-context`
annotations yet, so code that reads them (such as an agent checking its
outgoing payloads) uses this map.
"""


@cache
def _basic_component_models() -> Mapping[type, str]:
    """Maps the basic catalogs' component model classes to component types."""
    # Imported here: the basic catalogs import the resolution package, which
    # imports this module.
    # pylint: disable=import-outside-toplevel
    from ..basic_catalog import v0_9, v1_0

    models: dict[type, str] = {}
    for module in (v0_9, v1_0):
        for component_type in _BASIC_COMPONENT_URL_PROPERTIES:
            model = getattr(module, f"{component_type}Component", None)
            if isinstance(model, type):
                models[model] = component_type
    return models


def builtin_url_properties(
    catalog_id: str | None, component_type: str, component_api: Any
) -> Mapping[str, UrlContextAnnotation] | None:
    """Returns the built-in URL properties of a component, if it has any.

    Args:
        catalog_id: The ID of the catalog the component belongs to.
        component_type: The component's type, such as `"Image"`.
        component_api: The component's definition in that catalog, if known.
    """
    if catalog_id in BASIC_CATALOG_IDS:
        return _BASIC_COMPONENT_URL_PROPERTIES.get(component_type)
    model = getattr(component_api, "model_class", None)
    basic_type = _basic_component_models().get(model) if model is not None else None
    if basic_type is None:
        return None
    return _BASIC_COMPONENT_URL_PROPERTIES[basic_type]
