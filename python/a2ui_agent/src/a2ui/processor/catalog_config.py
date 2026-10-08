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

"""Configuration model associating a component catalog definition with its transformations."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from a2ui.catalog_transformers import CatalogTransformer
from a2ui.core import CatalogApi
from a2ui.core.schema import ProtocolVersion

from .catalog_providers import FileSystemCatalogProvider


@dataclass
class CatalogConfig:
    """Configuration model associating a component catalog definition with its transformations.

    Attributes:
        catalog: Base Catalog instance loaded via a CatalogProvider.
        transformers: Optional sequence of CatalogTransformer rules to apply
          sequentially.
    """

    catalog: CatalogApi
    transformers: Sequence[CatalogTransformer] | None = None

    @property
    def transformed_catalog(self) -> CatalogApi:
        """Returns the Catalog after applying all configured transformers sequentially."""
        current = self.catalog
        if self.transformers:
            for transformer in self.transformers:
                current = transformer.transform(current)
        return current

    @classmethod
    def from_path(
        cls,
        catalog_path: str,
        transformers: Sequence[CatalogTransformer] | None = None,
        protocol_version: ProtocolVersion | str | None = None,
        catalog_id: str | None = None,
    ) -> CatalogConfig:
        """Factory method loading a Catalog from disk into a CatalogConfig.

        Args:
            catalog_path: Path to the catalog JSON file.
            transformers: Optional sequence of catalog transformers.
            protocol_version: Optional expected protocol version for validation
              and default resolution.
            catalog_id: Optional expected catalog ID for validation and default
              resolution.

        Returns:
            A CatalogConfig instance.
        """
        catalog = FileSystemCatalogProvider(
            catalog_path,
            protocol_version=protocol_version,
            catalog_id=catalog_id,
        ).load()
        return cls(catalog=catalog, transformers=transformers)


__all__ = ["CatalogConfig"]
