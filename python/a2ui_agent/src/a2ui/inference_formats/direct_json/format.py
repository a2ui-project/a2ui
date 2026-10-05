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

from pydantic import ValidationError

from a2ui.catalog_transformers import ComponentPruningTransformer
from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.schema.v0_9 import V09Capabilities
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats.direct_json.parser import DirectJsonParser
from a2ui.inference_formats.direct_json.prompt_generator import DirectJsonPromptGenerator
from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser
from a2ui.schema import CatalogConfig, load_examples
from a2ui.schema.constants import (
    CATALOG_COMPONENTS_KEY,
    INLINE_CATALOGS_KEY,
    VERSION_0_8,
    VERSION_0_9,
    VERSION_0_9_1,
    VERSION_1_0,
)
from a2ui.schema.utils import (
    load_agent_to_renderer_schema,
    load_common_types_schema,
)
from a2ui.utils import resolve_catalogs

# The key that clients send each protocol version's capabilities under, when
# they key them by version. v0.9.1 clients use the v0.9 key.
_CAPABILITIES_KEYS = {
    VERSION_0_8: "v0.8",
    VERSION_0_9: "v0.9",
    VERSION_0_9_1: "v0.9",
    VERSION_1_0: "v1.0",
}


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
        self._catalog_configs: list[CatalogConfig] = []
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

    @property
    def parser(self) -> DirectJsonParser:
        """The parser instance configured for this Direct JSON format."""
        if self._parser is None:
            if not self._supported_catalogs:
                raise A2uiCatalogError(
                    "No supported catalogs configured for the Direct JSON format."
                )
            default_catalog = self._supported_catalogs[0]
            self._parser = DirectJsonParser(
                default_catalog,
                custom_cuttable_keys=self._catalog_cuttable_keys.get(
                    default_catalog.catalog_id
                ),
                s2c_schema=self._server_to_client_schema,
                common_types_schema=self._common_types_schema,
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
        catalogs: Sequence[CatalogConfig] | None = None,
    ) -> None:
        """Loads separate schema components and processes catalogs."""
        catalogs = catalogs or []
        supported_versions = (VERSION_0_8, VERSION_0_9, VERSION_0_9_1, VERSION_1_0)
        if version not in supported_versions:
            raise A2uiCatalogError(
                f"Unknown A2UI specification version: {version}. Supported:"
                f" {list(supported_versions)}"
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
                protocol_version=version, schema_modifiers=self._schema_modifiers
            )
            self._supported_catalogs.append(catalog)
            # The catalog is already modified and transformed, so resolution
            # reuses it as is.
            self._catalog_configs.append(
                CatalogConfig.from_catalog(config.name, catalog)
            )
            if config.examples_path:
                self._catalog_example_paths[catalog.catalog_id] = config.examples_path
            if config.custom_cuttable_keys is not None:
                self._catalog_cuttable_keys[catalog.catalog_id] = (
                    config.custom_cuttable_keys
                )

    def _read_client_capabilities(
        self, client_ui_capabilities: Mapping[str, Any] | V09Capabilities
    ) -> tuple[list[str] | None, list[dict[str, Any]]]:
        """Returns the catalog ids and inline catalogs that a client sent.

        Args:
           client_ui_capabilities: The capabilities object, or a mapping that keys
             it by this format's protocol version.

        Returns:
           The client-supported catalog ids, or `None` if the client didn't
           state any, and the inline catalog documents.

        Raises:
           A2uiCatalogError: If the capabilities are malformed.
        """
        if isinstance(client_ui_capabilities, V09Capabilities):
            capabilities = client_ui_capabilities
            states_catalog_ids = True
        else:
            entry = client_ui_capabilities.get(
                _CAPABILITIES_KEYS[self._version], client_ui_capabilities
            )
            if not isinstance(entry, Mapping):
                raise A2uiCatalogError(f"Invalid client capabilities format: {entry!r}")
            states_catalog_ids = (
                "supportedCatalogIds" in entry or "supported_catalog_ids" in entry
            )
            # Inject default supportedCatalogIds if missing to pass validation
            data = dict(entry)
            if not states_catalog_ids:
                data["supportedCatalogIds"] = []
            try:
                capabilities = V09Capabilities.model_validate(data)
            except ValidationError as e:
                raise A2uiCatalogError(
                    f"Invalid client capabilities format: {e}"
                ) from e

        inline_catalogs = [
            c.model_dump(by_alias=True, exclude_none=True)
            for c in capabilities.inline_catalogs or []
        ]
        catalog_ids = capabilities.supported_catalog_ids if states_catalog_ids else None
        return catalog_ids, inline_catalogs

    def _merge_inline_catalogs(
        self,
        catalog_ids: Sequence[str],
        inline_catalogs: Sequence[dict[str, Any]],
    ) -> CatalogApi:
        """Returns the client's preferred catalog with the inline components added.

        Args:
           catalog_ids: The client-supported catalog ids. The first supported
             catalog among them is the base, and the first supported catalog is
             the base if there is none.
           inline_catalogs: The inline catalog documents to merge.

        Returns:
           The merged catalog, which keeps the base catalog's id.
        """
        supported_catalogs = {c.catalog_id: c for c in self._supported_catalogs}
        base_catalog = next(
            (supported_catalogs[i] for i in catalog_ids if i in supported_catalogs),
            self._supported_catalogs[0],
        )

        merged_schema = copy.deepcopy(base_catalog.catalog_schema)

        for inline_catalog_schema in inline_catalogs:
            inline_catalog_schema = self._apply_modifiers(inline_catalog_schema)
            inline_components = inline_catalog_schema.get(CATALOG_COMPONENTS_KEY) or {}
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

    def get_selected_catalog(
        self,
        client_ui_capabilities: Mapping[str, Any] | V09Capabilities | None = None,
        allowed_components: Sequence[str] | None = None,
        allowed_messages: Sequence[str] | None = None,
    ) -> CatalogApi:
        """Selects and prunes the catalog according to client capabilities and restrictions.

        The selected catalog is the first one that `a2ui.utils.resolve_catalogs`
        activates for the client's `supportedCatalogIds`. Inline catalogs, when
        the format accepts them, are merged into that catalog rather than
        activated on their own, so the prompt still describes one catalog. If
        the client names no supported catalog, they're merged into the first
        supported catalog.

        Args:
            client_ui_capabilities: Optional client UI capability details, either
                the capabilities object or a mapping that keys it by protocol
                version, for example `{"v0.9": {...}}`. Without capabilities, or
                without `supportedCatalogIds`, the first supported catalog is
                selected.
            allowed_components: Optional names of the components to keep. `None`
                keeps every component, and an empty list keeps none.
            allowed_messages: Accepted for compatibility. A catalog does not hold
                the server-to-client schema, so the prompt generator applies this
                restriction when it renders the schemas instead.

        Returns:
            The selected catalog, pruned to the allowed components.

        Raises:
            A2uiCatalogError: If the capabilities are malformed, carry inline
                catalogs that the format doesn't accept, or name none of the
                supported catalogs. An empty `supportedCatalogIds` without inline
                catalogs names none.
        """
        del allowed_messages
        if not self._supported_catalogs:
            raise A2uiCatalogError(
                "No supported catalogs found."
            )  # This should not happen.

        catalog_ids, inline_catalogs = (
            self._read_client_capabilities(client_ui_capabilities)
            if client_ui_capabilities
            else (None, [])
        )

        if not self._accepts_inline_catalogs and inline_catalogs:
            raise A2uiCatalogError(
                f"Inline catalog '{INLINE_CATALOGS_KEY}' is provided in client UI"
                " capabilities. However, the agent does not accept inline catalogs."
            )

        if inline_catalogs:
            catalog = self._merge_inline_catalogs(catalog_ids or [], inline_catalogs)
        elif catalog_ids is None:
            catalog = self._supported_catalogs[0]
        else:
            renderer_capabilities = {
                _CAPABILITIES_KEYS[self._version]: {"supportedCatalogIds": catalog_ids}
            }
            catalog = resolve_catalogs(self._catalog_configs, renderer_capabilities)[0]

        if allowed_components is not None:
            catalog = ComponentPruningTransformer(allowed_components).transform(catalog)
        return catalog

    def create_stream_parser(
        self, catalog: CatalogApi | None = None
    ) -> DirectJsonStreamParser:
        """Creates a streaming parser configured by this format.

        The parser validates messages against this format's protocol schemas,
        after its schema modifiers, and heals the cuttable keys configured for
        the catalog.

        Args:
            catalog: The catalog to parse against, for example the one that
                `get_selected_catalog` returns. Defaults to the first supported
                catalog.

        Returns:
            A new streaming parser.

        Raises:
            A2uiCatalogError: If no catalog is given and none is configured.
        """
        if catalog is None:
            if not self._supported_catalogs:
                raise A2uiCatalogError(
                    "No supported catalogs configured for the Direct JSON format."
                )
            catalog = self._supported_catalogs[0]
        return DirectJsonStreamParser(
            catalog,
            custom_cuttable_keys=self._catalog_cuttable_keys.get(catalog.catalog_id),
            s2c_schema=self._server_to_client_schema,
            common_types_schema=self._common_types_schema,
        )

    def load_examples(self, catalog: CatalogApi, validate: bool = False) -> str:
        """Loads and optionally validates few-shot examples for the specified catalog.

        Args:
            catalog: The catalog to load examples for.
            validate: Whether to validate the examples on load.

        Returns:
            The examples text block, or an empty string.
        """
        if catalog.catalog_id in self._catalog_example_paths:
            return load_examples(
                catalog,
                self._catalog_example_paths[catalog.catalog_id],
                validate=validate,
            )
        return ""
