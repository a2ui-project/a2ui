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

"""Standard A2UI Direct JSON inference format coordination."""

from collections.abc import Mapping, Sequence
import copy
from typing import Any, Callable

from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.schema.v0_9 import V09Capabilities
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats.direct_json.parser import DirectJsonParser
from a2ui.inference_formats.direct_json.prompt_generator import DirectJsonPromptGenerator
from a2ui.schema.catalog import (
    CatalogConfig,
    load_examples,
    prune_catalog_components,
)
from a2ui.schema.constants import (
    CATALOG_COMPONENTS_KEY,
    INLINE_CATALOGS_KEY,
    PROTOCOL_VERSION_MAP,
)
from a2ui.schema.utils import (
    load_agent_to_renderer_schema,
    load_common_types_schema,
)


class DirectJsonFormat(InferenceFormat):
    """Manages standard A2UI JSON schema responses and prompt injection (Direct JSON Format)."""

    def __init__(
        self,
        version: str,
        catalogs: Sequence[CatalogConfig] | None = None,
        accepts_inline_catalogs: bool = False,
        schema_modifiers: (
            Sequence[Callable[[dict[str, Any]], dict[str, Any]]] | None
        ) = None,
        experiments: set[str] | frozenset[str] | None = None,
    ):
        """Initializes the DirectJsonFormat with schemas and catalogs.

        Args:
            version: The A2UI protocol specification version (e.g. "0.9").
            catalogs: Optional list of catalog configurations.
            accepts_inline_catalogs: Whether inline catalog definitions are allowed.
            schema_modifiers: Optional schema modifier functions to post-process
              schemas.
            experiments: Optional set of enabled experimental feature flags.
        """
        self._version = version
        self._accepts_inline_catalogs = accepts_inline_catalogs
        self.experiments = frozenset(experiments) if experiments else frozenset()

        self._server_to_client_schema: dict[str, Any] = {}
        self._common_types_schema: dict[str, Any] = {}
        self._supported_catalogs: list[CatalogApi] = []
        self._catalog_example_paths: dict[str, str] = {}
        self._catalog_cuttable_keys: dict[str, frozenset[str]] = {}
        self._schema_modifiers = list(schema_modifiers) if schema_modifiers else []
        self._parser: DirectJsonParser | None = None
        self._prompt_generator: DirectJsonPromptGenerator | None = None
        self._load_schemas(version, catalogs or [])

    @property
    def prompt_generator(self) -> DirectJsonPromptGenerator:
        """The prompt generator instance configured for this Direct JSON format."""
        if self._prompt_generator is None:
            self._prompt_generator = DirectJsonPromptGenerator(self)
        return self._prompt_generator

    def create_parser(self) -> DirectJsonParser:
        """Creates a new parser instance bound to this format strategy."""
        if not self._supported_catalogs:
            raise A2uiCatalogError(
                "No supported catalogs configured for the Direct JSON format."
            )
        return DirectJsonParser(self._supported_catalogs)

    @property
    def parser(self) -> DirectJsonParser:
        """The parser instance configured for this Direct JSON format."""
        if self._parser is None:
            self._parser = self.create_parser()
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
        catalogs: Sequence[CatalogConfig] | None = None,
    ) -> None:
        """Loads separate schema components and processes catalogs."""
        catalogs = catalogs or []
        if version not in PROTOCOL_VERSION_MAP:
            raise A2uiCatalogError(
                f"Unknown A2UI specification version: {version}. Supported:"
                f" {list(PROTOCOL_VERSION_MAP.keys())}"
            )

        # Load server-to-client and common types schemas
        self._server_to_client_schema = self._apply_modifiers(
            load_agent_to_renderer_schema(version)
        )
        self._common_types_schema = self._apply_modifiers(
            load_common_types_schema(version)
        )

        # Process catalogs
        for config in catalogs:
            catalog = config.to_catalog(
                version=version, schema_modifiers=self._schema_modifiers
            )
            self._supported_catalogs.append(catalog)
            if config.examples_path:
                self._catalog_example_paths[catalog.catalog_id] = config.examples_path
            if config.custom_cuttable_keys is not None:
                self._catalog_cuttable_keys[catalog.catalog_id] = (
                    config.custom_cuttable_keys
                )

    def _select_catalog(
        self,
        client_ui_capabilities: Mapping[str, Any] | V09Capabilities | None = None,
    ) -> CatalogApi:
        """Selects the component catalog for the prompt based on client capabilities."""
        if not self._supported_catalogs:
            raise A2uiCatalogError("No supported catalogs found.")

        if not client_ui_capabilities:
            return self._supported_catalogs[0]

        if isinstance(client_ui_capabilities, Mapping):
            data = dict(client_ui_capabilities)
            if (
                "supportedCatalogIds" not in data
                and "supported_catalog_ids" not in data
            ):
                data["supportedCatalogIds"] = []
            try:
                capabilities = V09Capabilities.model_validate(data)
            except Exception as e:
                raise A2uiCatalogError(
                    f"Invalid client capabilities format: {e}"
                ) from e
        else:
            capabilities = client_ui_capabilities

        inline_catalogs = [
            c.model_dump(by_alias=True) for c in capabilities.inline_catalogs or []
        ]
        client_supported_catalog_ids = capabilities.supported_catalog_ids or []

        if not self._accepts_inline_catalogs and inline_catalogs:
            raise A2uiCatalogError(
                f"Inline catalog '{INLINE_CATALOGS_KEY}' is provided in client UI"
                " capabilities. However, the agent does not accept inline catalogs."
            )

        if inline_catalogs:
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
                merged_schema.setdefault(CATALOG_COMPONENTS_KEY, {}).update(
                    inline_components
                )

            if "$defs" in merged_schema and "anyComponent" in merged_schema["$defs"]:
                del merged_schema["$defs"]["anyComponent"]

            return Catalog.from_json(
                catalog_schema=merged_schema,
                protocol_version=self._version,
                catalog_id=base_catalog.catalog_id,
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
        client_ui_capabilities: Mapping[str, Any] | V09Capabilities | None = None,
        allowed_components: Sequence[str] | None = None,
        allowed_messages: Sequence[str] | None = None,
    ) -> CatalogApi:
        """Selects and prunes the catalog according to client capabilities and restrictions."""
        del allowed_messages
        catalog = self._select_catalog(client_ui_capabilities)
        return prune_catalog_components(catalog, allowed_components)

    def load_examples(self, catalog: CatalogApi, validate: bool = False) -> str:
        """Loads and optionally validates few-shot examples for the specified catalog."""
        if catalog.catalog_id in self._catalog_example_paths:
            return load_examples(
                catalog,
                self._catalog_example_paths[catalog.catalog_id],
                validate=validate,
            )
        return ""
