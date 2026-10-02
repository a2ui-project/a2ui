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

"""Catalog pruning transformers for filtering components and functions."""

from __future__ import annotations

from collections.abc import Sequence

from a2ui.core import Catalog, CatalogApi

from .base import CatalogTransformer


class ComponentPruningTransformer(CatalogTransformer):
    """Prunes catalog component definitions to an allowlist of allowed components."""

    def __init__(self, allowed_components: Sequence[str] | None = None) -> None:
        self.allowed_components: set[str] = (
            set(allowed_components) if allowed_components is not None else set()
        )

    def transform(self, catalog: CatalogApi) -> CatalogApi:
        """Returns a new Catalog filtered to only include components in allowed_components."""
        return Catalog(
            catalog_id=catalog.catalog_id,
            protocol_version=catalog.protocol_version,
            components=[
                comp
                for comp in catalog.components.values()
                if comp.name in self.allowed_components
            ],
            functions=list(catalog.functions.values()),
            theme_schema=catalog.theme_schema,
            instructions=catalog.instructions,
            defs=catalog.defs,
            common_types_defs=catalog.common_types_defs,
        )


class FunctionPruningTransformer(CatalogTransformer):
    """Prunes catalog function definitions to an allowlist of allowed functions."""

    def __init__(self, allowed_functions: Sequence[str] | None = None) -> None:
        self.allowed_functions: set[str] = (
            set(allowed_functions) if allowed_functions is not None else set()
        )

    def transform(self, catalog: CatalogApi) -> CatalogApi:
        """Returns a new Catalog filtered to only include functions in allowed_functions."""
        return Catalog(
            catalog_id=catalog.catalog_id,
            protocol_version=catalog.protocol_version,
            components=list(catalog.components.values()),
            functions=[
                fn
                for fn in catalog.functions.values()
                if fn.name in self.allowed_functions
            ],
            theme_schema=catalog.theme_schema,
            instructions=catalog.instructions,
            defs=catalog.defs,
            common_types_defs=catalog.common_types_defs,
        )


__all__ = [
    "ComponentPruningTransformer",
    "FunctionPruningTransformer",
]
