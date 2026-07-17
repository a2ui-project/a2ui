# Copyright 2026 Google LLC
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

"""Standard A2UI transport inference format coordination."""

import copy
from typing import Any, Optional, Callable, Union

from a2ui.schema.utils import load_from_bundled_resource
from a2ui.inference_format import InferenceFormat
from a2ui.schema.constants import (
    SERVER_TO_CLIENT_SCHEMA_KEY,
    COMMON_TYPES_SCHEMA_KEY,
    SPEC_VERSION_MAP,
    INLINE_CATALOGS_KEY,
    SUPPORTED_CATALOG_IDS_KEY,
    CATALOG_COMPONENTS_KEY,
    INLINE_CATALOG_NAME,
)
from a2ui.schema.catalog import CatalogConfig, A2uiCatalog
from a2ui.core import A2uiCatalogError
from a2ui.inference_formats.transport.parser import TransportParser
from a2ui.inference_formats.transport.prompt_generator import TransportPromptGenerator


class TransportFormat(InferenceFormat):
    """Manages standard A2UI JSON schema responses and prompt injection (Transport Format)."""

    def __init__(
        self,
        version: str,
        catalogs: Optional[list[CatalogConfig]] = None,
        accepts_inline_catalogs: bool = False,
        schema_modifiers: Optional[
            list[Callable[[dict[str, Any]], dict[str, Any]]]
        ] = None,
        experiments: Optional[Union[set[str], frozenset[str]]] = None,
    ):
        """Initializes the TransportFormat with schemas and catalogs.

        Args:
            version: The A2UI protocol specification version (e.g. "0.9").
            catalogs: Optional list of catalog configurations.
            accepts_inline_catalogs: Whether inline catalog definitions are allowed.
            schema_modifiers: Optional schema modifier functions to post-process schemas.
            experiments: Optional set of enabled experimental feature flags.
        """
        self._version = version
        self._accepts_inline_catalogs = accepts_inline_catalogs
        self.experiments = frozenset(experiments) if experiments else frozenset()

        self._server_to_client_schema: dict[str, Any] = {}
        self._common_types_schema: dict[str, Any] = {}
        self._supported_catalogs: list[A2uiCatalog] = []
        self._catalog_example_paths: dict[str, str] = {}
        self._schema_modifiers = schema_modifiers or []
        self._parser: Optional[TransportParser] = None
        self._prompt_generator: Optional[TransportPromptGenerator] = None
        self._load_schemas(version, catalogs or [])

    @property
    def prompt_generator(self) -> TransportPromptGenerator:
        """Returns the PromptGenerator instance for this format."""
        if self._prompt_generator is None:
            self._prompt_generator = TransportPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> TransportParser:
        """Returns the Parser instance for this format."""
        if self._parser is None:
            if not self._supported_catalogs:
                raise ValueError(
                    "No supported catalogs configured for the transport format."
                )
            default_catalog = self._supported_catalogs[0]
            self._parser = TransportParser(
                default_catalog,
                default_catalog.validator,
            )
        return self._parser

    @property
    def accepts_inline_catalogs(self) -> bool:
        """Whether this format accepts inline catalog definitions."""
        return self._accepts_inline_catalogs

    @property
    def supported_catalog_ids(self) -> list[str]:
        """A list of catalog IDs supported by this format."""
        return [c.catalog_id for c in self._supported_catalogs]

    def _apply_modifiers(self, schema: dict[str, Any]) -> dict[str, Any]:
        if self._schema_modifiers:
            for modifier in self._schema_modifiers:
                schema = modifier(schema)
        return schema

    def _load_schemas(
        self,
        version: str,
        catalogs: Optional[list[CatalogConfig]] = None,
    ) -> None:
        """Loads separate schema components and processes catalogs."""
        catalogs = catalogs or []
        if version not in SPEC_VERSION_MAP:
            raise A2uiCatalogError(
                f"Unknown A2UI specification version: {version}. Supported:"
                f" {list(SPEC_VERSION_MAP.keys())}"
            )

        # Load server-to-client and common types schemas
        self._server_to_client_schema = self._apply_modifiers(
            load_from_bundled_resource(
                version, SERVER_TO_CLIENT_SCHEMA_KEY, SPEC_VERSION_MAP
            )
        )
        self._common_types_schema = self._apply_modifiers(
            load_from_bundled_resource(
                version, COMMON_TYPES_SCHEMA_KEY, SPEC_VERSION_MAP
            )
        )

        # Process catalogs
        for config in catalogs:
            catalog_schema = config.provider.load()
            catalog_schema = self._apply_modifiers(catalog_schema)
            catalog = A2uiCatalog(
                version=version,
                name=config.name,
                catalog_schema=catalog_schema,
                s2c_schema=self._server_to_client_schema,
                common_types_schema=self._common_types_schema,
                custom_cuttable_keys=config.custom_cuttable_keys,
                experiments=self.experiments,
            )
            self._supported_catalogs.append(catalog)
            if config.examples_path:
                self._catalog_example_paths[catalog.catalog_id] = config.examples_path

    def _select_catalog(
        self, client_ui_capabilities: Optional[dict[str, Any]] = None
    ) -> A2uiCatalog:
        """Selects the component catalog for the prompt based on client capabilities.

        Selection priority:
        1. If inline catalogs are provided (and accepted by the agent), their
           components are merged on top of a base catalog. The base is determined
           by supportedCatalogIds (if also provided) or the agent's default catalog.
         2. If only supportedCatalogIds is provided, pick the first mutually
            supported catalog.
         3. Fallback to the first agent-supported catalog (usually the bundled catalog).

        Args:
           client_ui_capabilities: A dictionary of client UI capabilities, containing
             inline catalogs and client-supported catalog IDs.

        Returns:
           The resolved A2uiCatalog.
        Raises:
           ValueError: If inline catalogs are sent but not accepted, or if no
             mutually supported catalog is found.
        """
        if not self._supported_catalogs:
            raise A2uiCatalogError(
                "No supported catalogs found."
            )  # This should not happen.

        if not client_ui_capabilities or not isinstance(client_ui_capabilities, dict):
            return self._supported_catalogs[0]

        inline_catalogs: list[dict[str, Any]] = client_ui_capabilities.get(
            INLINE_CATALOGS_KEY, []
        )
        client_supported_catalog_ids: list[str] = client_ui_capabilities.get(
            SUPPORTED_CATALOG_IDS_KEY, []
        )

        if not self._accepts_inline_catalogs and inline_catalogs:
            raise A2uiCatalogError(
                f"Inline catalog '{INLINE_CATALOGS_KEY}' is provided in client UI"
                " capabilities. However, the agent does not accept inline catalogs."
            )

        if inline_catalogs:
            # Determine the base catalog: use supportedCatalogIds if provided,
            # otherwise fall back to the agent's default catalog.
            base_catalog = self._supported_catalogs[0]
            if client_supported_catalog_ids:
                agent_supported_catalogs = {
                    c.catalog_id: c for c in self._supported_catalogs
                }
                for cscid in client_supported_catalog_ids:
                    if cscid in agent_supported_catalogs:
                        base_catalog = agent_supported_catalogs[cscid]
                        break

            merged_schema = copy.deepcopy(base_catalog.catalog_schema)

            for inline_catalog_schema in inline_catalogs:
                inline_catalog_schema = self._apply_modifiers(inline_catalog_schema)
                inline_components = inline_catalog_schema.get(
                    CATALOG_COMPONENTS_KEY, {}
                )
                merged_schema[CATALOG_COMPONENTS_KEY].update(inline_components)

            return A2uiCatalog(
                version=self._version,
                name=INLINE_CATALOG_NAME,
                catalog_schema=merged_schema,
                s2c_schema=self._server_to_client_schema,
                common_types_schema=self._common_types_schema,
                experiments=self.experiments,
            )

        if not client_supported_catalog_ids:
            return self._supported_catalogs[0]

        agent_supported_catalogs = {c.catalog_id: c for c in self._supported_catalogs}
        for cscid in client_supported_catalog_ids:
            if cscid in agent_supported_catalogs:
                return agent_supported_catalogs[cscid]

        raise A2uiCatalogError(
            "No client-supported catalog found on the agent side. Agent-supported"
            f" catalogs are: {[c.catalog_id for c in self._supported_catalogs]}"
        )

    def get_selected_catalog(
        self,
        client_ui_capabilities: Optional[dict[str, Any]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
    ) -> A2uiCatalog:
        """Selects and prunes the catalog according to client capabilities and restrictions.

        Args:
            client_ui_capabilities: Optional client UI capability details.
            allowed_components: Optional list of component tags allowed.
            allowed_messages: Optional list of message types allowed.

        Returns:
            The selected and pruned A2uiCatalog instance.
        """
        catalog = self._select_catalog(client_ui_capabilities)
        pruned_catalog = catalog.with_pruning(allowed_components, allowed_messages)
        return pruned_catalog

    def load_examples(self, catalog: A2uiCatalog, validate: bool = False) -> str:
        """Loads and optionally validates few-shot examples for the specified catalog.

        Args:
            catalog: The A2uiCatalog to load examples for.
            validate: Whether to validate the examples on load.

        Returns:
            The examples text block, or an empty string.
        """
        if catalog.catalog_id in self._catalog_example_paths:
            return catalog.load_examples(
                self._catalog_example_paths[catalog.catalog_id], validate=validate
            )
        return ""
