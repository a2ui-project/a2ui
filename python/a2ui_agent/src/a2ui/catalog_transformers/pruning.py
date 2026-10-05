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

"""Transformers that prune a catalog's components or functions to an allowlist."""

from collections.abc import Sequence
import copy

from a2ui.core import Catalog, CatalogApi

from .base import CatalogTransformer


def _allowlist(names: Sequence[str], argument: str) -> frozenset[str]:
    if isinstance(names, str):
        raise TypeError(f"{argument} must be a sequence of names, not a string.")
    return frozenset(names)


def _pruned(
    catalog: CatalogApi,
    *,
    components: frozenset[str] | None = None,
    functions: frozenset[str] | None = None,
) -> CatalogApi:
    """Returns a copy of `catalog` that keeps only the named entries.

    `None` keeps every entry of that kind. The copy's schema is generated from
    the entries it keeps, so its `anyComponent` and `anyFunction` refer only to
    those.
    """
    return Catalog(
        catalog_id=catalog.catalog_id,
        protocol_version=catalog.protocol_version,
        components=[
            component
            for name, component in catalog.components.items()
            if components is None or name in components
        ],
        functions=[
            function
            for name, function in catalog.functions.items()
            if functions is None or name in functions
        ],
        theme_schema=copy.deepcopy(catalog.theme_schema),
        instructions=catalog.instructions,
        defs=catalog.defs,
        common_types_defs=catalog.common_types_defs,
    )


class ComponentPruningTransformer(CatalogTransformer):
    """Keeps only the allowlisted components of a catalog.

    The allowlist is read literally. An empty allowlist keeps no components,
    and a name the catalog doesn't declare is ignored. To keep every component,
    don't apply the transformer. Functions and the other definitions are kept.
    """

    def __init__(self, allowed_components: Sequence[str]) -> None:
        """Initializes the transformer.

        Args:
            allowed_components: The names of the components to keep.

        Raises:
            TypeError: If `allowed_components` is a single string.
        """
        self.allowed_components = _allowlist(allowed_components, "allowed_components")

    def transform(self, catalog: CatalogApi) -> CatalogApi:
        """Returns a copy of `catalog` with only the allowlisted components."""
        return _pruned(catalog, components=self.allowed_components)


class FunctionPruningTransformer(CatalogTransformer):
    """Keeps only the allowlisted functions of a catalog.

    The allowlist is read literally. An empty allowlist keeps no functions, and
    a name the catalog doesn't declare is ignored. To keep every function, don't
    apply the transformer. Components and the other definitions are kept.
    """

    def __init__(self, allowed_functions: Sequence[str]) -> None:
        """Initializes the transformer.

        Args:
            allowed_functions: The names of the functions to keep.

        Raises:
            TypeError: If `allowed_functions` is a single string.
        """
        self.allowed_functions = _allowlist(allowed_functions, "allowed_functions")

    def transform(self, catalog: CatalogApi) -> CatalogApi:
        """Returns a copy of `catalog` with only the allowlisted functions."""
        return _pruned(catalog, functions=self.allowed_functions)
