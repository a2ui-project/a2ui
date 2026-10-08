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

"""Providers for loading and validating A2UI catalog documents."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping
import json
from typing import Any
from urllib.parse import urlparse

from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion


class CatalogProvider(ABC):
    """Abstract base class for providing A2UI schemas and catalogs."""

    @abstractmethod
    def load(self) -> CatalogApi:
        """Loads and returns a Catalog instance."""


class FileSystemCatalogProvider(CatalogProvider):
    """Loads a catalog definition from the local filesystem."""

    def __init__(
        self,
        path: str,
        protocol_version: ProtocolVersion | str | None = None,
        catalog_id: str | None = None,
    ) -> None:
        """Initializes the filesystem catalog provider.

        Args:
            path: Absolute or relative filesystem path (or file:// URI) to the
              catalog JSON file.
            protocol_version: Optional expected A2UI protocol version for
              validation and default resolution.
            catalog_id: Optional expected catalog ID for validation and default
              resolution.
        """
        self.path = path
        self.protocol_version = protocol_version
        self.catalog_id = catalog_id

    def load(self) -> CatalogApi:
        """Reads the catalog JSON file and returns a Catalog instance.

        Raises:
            A2uiCatalogError: If the file cannot be read, is not valid JSON, is
              not a JSON object, or if catalogId / protocolVersion are missing
              or conflict with the provider's values.
        """
        parsed = urlparse(self.path)
        scheme = parsed.scheme
        if scheme and len(scheme) == 1 and scheme.isalpha():
            scheme = ""
        if scheme and scheme != "file":
            raise A2uiCatalogError(
                f"Unsupported catalog URL scheme '{parsed.scheme}' in '{self.path}'."
            )
        file_path = parsed.path if scheme == "file" else self.path

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError as e:
            raise A2uiCatalogError(
                f"Cannot read the catalog document '{self.path}': {e}"
            ) from e

        try:
            document = json.loads(text)
        except json.JSONDecodeError as e:
            raise A2uiCatalogError(
                f"The catalog document '{self.path}' is not valid JSON: {e}"
            ) from e

        if not isinstance(document, Mapping):
            raise A2uiCatalogError(
                f"The catalog document '{self.path}' is not a JSON object."
            )

        return _load_catalog_document(
            document,
            protocol_version=self.protocol_version,
            catalog_id=self.catalog_id,
            source=f"'{self.path}'",
        )


class InMemoryCatalogProvider(CatalogProvider):
    """Loads a catalog definition from an in-memory dictionary schema."""

    def __init__(
        self,
        catalog: Mapping[str, Any],
        protocol_version: ProtocolVersion | str | None = None,
        catalog_id: str | None = None,
    ) -> None:
        """Initializes the in-memory provider.

        Args:
            catalog: Raw catalog schema dictionary.
            protocol_version: Optional expected A2UI protocol version for
              validation and default resolution.
            catalog_id: Optional expected catalog ID for validation and default
              resolution.
        """
        self.catalog = catalog
        self.protocol_version = protocol_version
        self.catalog_id = catalog_id

    def load(self) -> CatalogApi:
        """Constructs and returns a Catalog instance from the raw schema dictionary.

        Raises:
            A2uiCatalogError: If the document is not a mapping, or if catalogId
              / protocolVersion are missing or conflict with the provider's
              values.
        """
        if not isinstance(self.catalog, Mapping):
            raise A2uiCatalogError("The in-memory catalog document is not a mapping.")

        return _load_catalog_document(
            self.catalog,
            protocol_version=self.protocol_version,
            catalog_id=self.catalog_id,
            source="The in-memory catalog document",
        )


def _load_catalog_document(
    document: Mapping[str, Any],
    *,
    protocol_version: ProtocolVersion | str | None,
    catalog_id: str | None,
    source: str,
) -> CatalogApi:
    """Validates and parses a catalog document against provider overrides."""
    settled_id = _settle_catalog_id(document, catalog_id, source)
    settled_version = _settle_protocol_version(document, protocol_version, source)
    try:
        return Catalog.from_json(
            catalog_schema={**document, "catalogId": settled_id},
            protocol_version=settled_version.value,
            catalog_id=settled_id,
        )
    except A2uiCatalogError:
        raise
    except Exception as e:
        raise A2uiCatalogError(f"Failed to load catalog from {source}: {e}") from e


def _settle_catalog_id(
    document: Mapping[str, Any],
    provider_id: str | None,
    source: str,
) -> str:
    """Settles the catalog ID between the document and the provider."""
    if provider_id is not None and (
        not isinstance(provider_id, str) or not provider_id
    ):
        raise A2uiCatalogError("Provider 'catalog_id' must be a non-empty string.")

    has_declared = "catalogId" in document
    declared = document.get("catalogId")
    if has_declared and declared is not None:
        if not isinstance(declared, str) or not declared:
            raise A2uiCatalogError(
                f"{source} declares a 'catalogId' that is not a non-empty string."
            )
        if provider_id is not None and declared != provider_id:
            raise A2uiCatalogError(
                f"{source} declares catalog id '{declared}', but the provider"
                f" was given '{provider_id}'."
            )
        return declared

    if provider_id is not None:
        return provider_id

    raise A2uiCatalogError(
        f"{source} declares no 'catalogId' and the provider was given none, so"
        " nothing names the catalog."
    )


def _settle_protocol_version(
    document: Mapping[str, Any],
    provider_version: ProtocolVersion | str | None,
    source: str,
) -> ProtocolVersion:
    """Settles the protocol version between the document and the provider."""
    provider_pv: ProtocolVersion | None = None
    if provider_version is not None:
        try:
            provider_pv = to_protocol_version(provider_version)
        except (TypeError, ValueError) as e:
            raise A2uiCatalogError(
                f"Provider was given invalid protocol version '{provider_version}': {e}"
            ) from e

    has_declared = "protocolVersion" in document
    declared = document.get("protocolVersion")
    if has_declared and declared is not None:
        if not isinstance(declared, str) or not declared:
            raise A2uiCatalogError(
                f"{source} declares a 'protocolVersion' that is not a non-empty string."
            )
        try:
            doc_pv = to_protocol_version(declared)
        except (TypeError, ValueError) as e:
            raise A2uiCatalogError(
                f"{source} declares unsupported protocol version '{declared}': {e}"
            ) from e

        if provider_pv is not None and doc_pv != provider_pv:
            raise A2uiCatalogError(
                f"{source} declares protocol version '{declared}', but the"
                f" provider was given '{provider_pv.value}'."
            )
        return doc_pv

    if provider_pv is not None:
        return provider_pv

    raise A2uiCatalogError(
        f"{source} declares no 'protocolVersion' and the provider was given"
        " none, so nothing states which protocol it is written against."
    )


__all__ = [
    "CatalogProvider",
    "FileSystemCatalogProvider",
    "InMemoryCatalogProvider",
]
