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

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping, Sequence
import copy
from dataclasses import dataclass
import glob
import json
import logging
import os
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from a2ui.core import (
    A2uiCatalogError,
    A2uiErrorDetail,
    A2uiValidationError,
    Catalog,
    MessageProcessor,
    MessageProcessorOptions,
    PayloadValidator,
    STRICT_VALIDATION,
)
from a2ui.core.common import to_protocol_version
from a2ui.utils import prune_common_types_schema, prune_messages_schema

if TYPE_CHECKING:
    # Only used in annotations, which aren't evaluated at runtime.
    from a2ui.catalog_transformers import CatalogTransformer
    from a2ui.core import CatalogApi

from .catalog_provider import (
    A2uiCatalogProvider,
    FileSystemCatalogProvider,
    InMemoryCatalogProvider,
)
from .constants import (
    A2UI_SCHEMA_BLOCK_END,
    A2UI_SCHEMA_BLOCK_START,
    CATALOG_ID_KEY,
    ENCODING,
)


def _iter_payload_components(payload: Any) -> Iterator[dict[str, Any]]:
    """Yields every component dictionary reachable in an A2UI payload.

    Understands a bare component, an `updateComponents` envelope, a bare
    `components` list holder, and a list of any of those.

    Args:
      payload: A component dict, a message envelope, or a list of either.

    Yields:
      Each component dictionary found, in payload order.
    """
    items = payload if isinstance(payload, list) else [payload]
    for item in items:
        if not isinstance(item, dict):
            continue
        update = item.get("updateComponents")
        if isinstance(update, dict):
            comps = update.get("components", [])
            if isinstance(comps, list):
                yield from (c for c in comps if isinstance(c, dict))
        elif isinstance(item.get("components"), list):
            yield from (c for c in item["components"] if isinstance(c, dict))
        elif "component" in item or "type" in item:
            yield item


@dataclass(init=False)
class CatalogConfig:
    """Configuration for a catalog of components.

    A catalog consists of a provider or an `a2ui.core.Catalog` instance,
    optionally a path or glob pattern to examples, and the transformers that
    shape it before it reaches a prompt or a validator.

    Attributes:
      name: The name of the catalog.
      provider: The provider to use to load the catalog schema.
      examples_path: The path or glob pattern to the examples.
      catalog: Optional `a2ui.core.Catalog` instance.
      transformers: The transformers that `to_catalog` applies, in order.
    """

    name: str
    provider: A2uiCatalogProvider
    examples_path: str | None = None
    catalog: CatalogApi | None = None
    transformers: tuple[CatalogTransformer, ...] = ()

    def __init__(
        self,
        name: str = "basic",
        provider: A2uiCatalogProvider | None = None,
        examples_path: str | None = None,
        *,
        catalog: CatalogApi | None = None,
        transformers: Sequence[CatalogTransformer] = (),
    ) -> None:
        """Initializes the configuration.

        Args:
          name: The name of the catalog.
          provider: The provider to load the catalog schema from. Defaults to an
            in-memory provider of `catalog`'s schema.
          examples_path: The path or glob pattern to the examples.
          catalog: The catalog instance to use as is.
          transformers: The transformers to apply to the catalog, in order. For
            example, `ComponentPruningTransformer` limits the components that
            prompts describe and validation accepts.

        Raises:
          TypeError: If neither `provider` nor `catalog` is given.
        """
        if catalog is not None and provider is None:
            provider = InMemoryCatalogProvider(catalog.catalog_schema)
        if provider is None:
            raise TypeError("CatalogConfig requires either 'provider' or 'catalog'.")
        self.name = name
        self.provider = provider
        self.examples_path = resolve_examples_path(examples_path)
        self.catalog = catalog
        self.transformers = tuple(transformers)

    @classmethod
    def from_catalog(
        cls,
        name: str,
        catalog: CatalogApi,
        examples_path: str | None = None,
        *,
        transformers: Sequence[CatalogTransformer] = (),
    ) -> CatalogConfig:
        """Returns a CatalogConfig backed by an `a2ui.core.Catalog` instance."""
        return cls(
            name=name,
            examples_path=examples_path,
            catalog=catalog,
            transformers=transformers,
        )

    @classmethod
    def from_path(
        cls,
        name: str,
        catalog_path: str,
        examples_path: str | None = None,
        *,
        transformers: Sequence[CatalogTransformer] = (),
    ) -> CatalogConfig:
        """Returns a CatalogConfig that loads from a local path or 'file://' URI."""
        parsed = urlparse(catalog_path)
        if not parsed.scheme or parsed.scheme == "file":
            catalog_provider = FileSystemCatalogProvider(parsed.path)
        elif parsed.scheme in ["http", "https"]:
            raise NotImplementedError("HTTP support is coming soon.")
        else:
            raise A2uiCatalogError(f"Unsupported catalog URL scheme: {catalog_path}")

        return cls(
            name=name,
            provider=catalog_provider,
            examples_path=resolve_examples_path(examples_path),
            transformers=transformers,
        )

    def to_catalog(
        self,
        protocol_version: str | None = None,
        schema_modifiers: (
            Sequence[Callable[[dict[str, Any]], dict[str, Any]]] | None
        ) = None,
    ) -> CatalogApi:
        """Loads and returns a core Catalog instance from this configuration.

        A configured `catalog` is used as is unless schema modifiers are given
        or it targets a different protocol version. Otherwise the provider's
        schema is modified and parsed with `Catalog.from_json`. The transformers
        are applied last, in order.

        Args:
          protocol_version: The protocol version of the returned catalog. Defaults
            to the configured catalog's version, then to the schema's
            `protocolVersion`, then to 1.0.
          schema_modifiers: Functions applied in order to the catalog schema
            before it is parsed.

        Returns:
          The catalog, with the transformers applied.

        Raises:
          A2uiCatalogError: If the schema lacks a string `catalogId`.
        """
        catalog = self._load_catalog(protocol_version, schema_modifiers)
        for transformer in self.transformers:
            catalog = transformer.transform(catalog)
        return catalog

    def _load_catalog(
        self,
        protocol_version: str | None,
        schema_modifiers: Sequence[Callable[[dict[str, Any]], dict[str, Any]]] | None,
    ) -> CatalogApi:
        """Returns the catalog before the transformers are applied."""
        if (
            self.catalog is not None
            and not schema_modifiers
            and (
                protocol_version is None
                or to_protocol_version(self.catalog.protocol_version)
                == to_protocol_version(protocol_version)
            )
        ):
            return self.catalog

        catalog_schema = copy.deepcopy(dict(self.provider.load()))
        if schema_modifiers:
            for modifier in schema_modifiers:
                catalog_schema = modifier(catalog_schema)

        if CATALOG_ID_KEY not in catalog_schema:
            raise A2uiCatalogError(f"Catalog '{self.name}' is missing 'catalogId'")
        catalog_id = catalog_schema[CATALOG_ID_KEY]
        if not isinstance(catalog_id, str):
            raise A2uiCatalogError(f"Catalog '{self.name}' catalogId is not a string")

        if protocol_version is None:
            protocol_version = (
                self.catalog.protocol_version
                if self.catalog is not None
                else str(catalog_schema.get("protocolVersion", "1.0"))
            )
        return Catalog.from_json(
            catalog_schema=catalog_schema,
            protocol_version=protocol_version,
            catalog_id=catalog_id,
        )


def resolve_examples_path(path: str | None) -> str | None:
    if path:
        parsed = urlparse(path)
        if not parsed.scheme or parsed.scheme == "file":
            return parsed.path
        else:
            raise A2uiCatalogError(f"Unsupported examples URL scheme: {path}")
    return None


def validate_components(catalog: CatalogApi, payload: Any) -> list[A2uiErrorDetail]:
    """Validates every component reachable in an A2UI payload against a catalog."""
    validator = PayloadValidator(catalog, config=STRICT_VALIDATION)
    errors: list[A2uiErrorDetail] = []
    for comp in _iter_payload_components(payload):
        try:
            validator.validate_component(comp)
        except A2uiValidationError as e:
            errors.extend(e.details)
    return errors


def validate_payload(catalog: CatalogApi, messages: Any) -> None:
    """Validates payload messages using MessageProcessor."""
    msg_list = messages if isinstance(messages, list) else [messages]
    MessageProcessor(
        [catalog],
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    ).process_messages(msg_list)


def render_as_llm_instructions(
    catalog: CatalogApi,
    *,
    s2c_schema: Mapping[str, Any] | None = None,
    common_types_schema: Mapping[str, Any] | None = None,
    allowed_messages: Sequence[str] | None = None,
) -> str:
    """Renders a Catalog and its protocol schemas as LLM instructions."""
    from a2ui.schema.utils import (
        load_agent_to_renderer_schema,
        load_common_types_schema,
    )

    version = str(catalog.protocol_version).removeprefix("v")
    effective_s2c = (
        dict(s2c_schema)
        if s2c_schema is not None
        else (load_agent_to_renderer_schema(version) or {})
    )
    if allowed_messages:
        effective_s2c = prune_messages_schema(effective_s2c, version, allowed_messages)

    effective_common_types = (
        dict(common_types_schema)
        if common_types_schema is not None
        else (load_common_types_schema(version) or {})
    )
    catalog_schema = catalog.catalog_schema
    effective_common_types = prune_common_types_schema(
        effective_common_types, catalog_schema, effective_s2c
    )

    all_schemas = [A2UI_SCHEMA_BLOCK_START]

    server_client_str = (
        json.dumps(effective_s2c, separators=(",", ":")) if effective_s2c else "{}"
    )
    all_schemas.append(f"### Server To Client Schema:\n{server_client_str}")

    if (
        effective_common_types
        and "$defs" in effective_common_types
        and effective_common_types["$defs"]
    ):
        common_str = json.dumps(effective_common_types, separators=(",", ":"))
        all_schemas.append(f"### Common Types Schema:\n{common_str}")

    catalog_str = json.dumps(catalog_schema, separators=(",", ":"))
    all_schemas.append(f"### Catalog Schema:\n{catalog_str}")

    all_schemas.append(A2UI_SCHEMA_BLOCK_END)

    return "\n\n".join(all_schemas)


def load_examples(catalog: CatalogApi, path: str | None, validate: bool = False) -> str:
    """Loads and optionally validates examples from a directory or a glob pattern."""
    if not path:
        return ""

    if os.path.isdir(path):
        pattern = os.path.join(path, "*.json")
    else:
        pattern = path

    matched_files = glob.glob(pattern, recursive=True)

    if not matched_files:
        if not os.path.isdir(path) and not any(c in path for c in "*?[]"):
            logging.warning(
                f"Example path {path} is neither a directory nor a valid glob pattern"
            )
        return ""

    matched_files.sort()

    merged_examples = []
    for full_path in matched_files:
        if not os.path.isfile(full_path):
            continue
        basename = os.path.splitext(os.path.basename(full_path))[0]
        with open(full_path, "r", encoding=ENCODING) as f:
            content = f.read()

        if validate:
            try:
                json_data = json.loads(content)
                validate_payload(catalog, json_data)
            except Exception as e:
                raise A2uiCatalogError(
                    f"Failed to validate example {full_path}: {e}"
                ) from e

        merged_examples.append(
            f"---BEGIN {basename}---\n{content}\n---END {basename}---"
        )

    if not merged_examples:
        return ""
    return "\n\n".join(merged_examples)
