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

import collections
from collections.abc import Callable, Iterator, Mapping, Sequence
import copy
from dataclasses import dataclass
import glob
import json
import logging
import os
from typing import TYPE_CHECKING, Any, Callable, Mapping, Sequence
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

if TYPE_CHECKING:
    # Only used in annotations, which aren't evaluated at runtime.
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
    VERSION_0_8,
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

    A catalog consists of a provider or an `a2ui_core.Catalog` instance,
    and optionally a path or glob pattern to examples.

    Attributes:
      name: The name of the catalog.
      provider: The provider to use to load the catalog schema.
      examples_path: The path or glob pattern to the examples.
      custom_cuttable_keys: The optional custom set of cuttable keys.
      catalog: Optional a2ui_core Catalog instance.
    """

    name: str
    provider: A2uiCatalogProvider
    examples_path: str | None = None
    custom_cuttable_keys: frozenset[str] | None = None
    catalog: CatalogApi | None = None

    def __init__(
        self,
        name: str | CatalogApi = "basic",
        provider: A2uiCatalogProvider | None = None,
        examples_path: str | None = None,
        custom_cuttable_keys: frozenset[str] | None = None,
        *,
        catalog: CatalogApi | None = None,
    ) -> None:
        if isinstance(name, Catalog):
            catalog = name
            name = "basic"
        if catalog is not None and provider is None:
            provider = InMemoryCatalogProvider(catalog.catalog_schema)
        if provider is None:
            raise TypeError("CatalogConfig requires either 'provider' or 'catalog'.")
        self.name = name
        self.provider = provider
        self.examples_path = resolve_examples_path(examples_path)
        self.custom_cuttable_keys = custom_cuttable_keys
        self.catalog = catalog

    @classmethod
    def from_catalog(
        cls,
        name_or_catalog: str | CatalogApi = "basic",
        catalog: CatalogApi | None = None,
        *,
        name: str | None = None,
        examples_path: str | None = None,
        custom_cuttable_keys: frozenset[str] | None = None,
    ) -> CatalogConfig:
        """Returns a CatalogConfig backed by an a2ui_core Catalog instance."""
        if isinstance(name_or_catalog, Catalog):
            actual_catalog: CatalogApi = name_or_catalog
            actual_name = name or (catalog if isinstance(catalog, str) else "basic")
        else:
            actual_name = name_or_catalog
            if catalog is None:
                raise TypeError("from_catalog requires a catalog instance")
            actual_catalog = catalog
        return cls(
            name=actual_name,
            provider=InMemoryCatalogProvider(actual_catalog.catalog_schema),
            examples_path=resolve_examples_path(examples_path),
            custom_cuttable_keys=custom_cuttable_keys,
            catalog=actual_catalog,
        )

    @classmethod
    def from_path(
        cls,
        name: str,
        catalog_path: str,
        examples_path: str | None = None,
        custom_cuttable_keys: frozenset[str] | None = None,
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
            custom_cuttable_keys=custom_cuttable_keys,
        )

    def to_catalog(
        self,
        version: str | None = None,
        schema_modifiers: (
            Sequence[Callable[[dict[str, Any]], dict[str, Any]]] | None
        ) = None,
        *,
        protocol_version: str | None = None,
    ) -> CatalogApi:
        """Loads and returns a core Catalog instance from this configuration."""
        ver = version or protocol_version
        if (
            self.catalog is not None
            and not schema_modifiers
            and (
                ver is None
                or to_protocol_version(self.catalog.protocol_version)
                == to_protocol_version(ver)
            )
        ):
            return self.catalog

        if self.provider is not None:
            catalog_schema = copy.deepcopy(dict(self.provider.load()))
        elif self.catalog is not None:
            catalog_schema = copy.deepcopy(dict(self.catalog.catalog_schema))
        else:
            raise A2uiCatalogError("CatalogConfig has neither provider nor catalog")
        if schema_modifiers:
            for modifier in schema_modifiers:
                catalog_schema = modifier(catalog_schema)

        if CATALOG_ID_KEY not in catalog_schema:
            raise A2uiCatalogError(f"Catalog '{self.name}' is missing 'catalogId'")
        catalog_id = catalog_schema[CATALOG_ID_KEY]
        if not isinstance(catalog_id, str):
            raise A2uiCatalogError(f"Catalog '{self.name}' catalogId is not a string")

        effective_version = ver or str(catalog_schema.get("protocolVersion", "1.0"))
        return Catalog.from_json(
            catalog_schema=catalog_schema,
            protocol_version=effective_version,
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


def _collect_refs(obj: Any) -> set[str]:
    """Recursively collects all $ref values from a JSON object."""
    refs = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "$ref" and isinstance(v, str):
                refs.add(v)
            else:
                refs.update(_collect_refs(v))
    elif isinstance(obj, list):
        for item in obj:
            refs.update(_collect_refs(item))
    return refs


def _prune_defs_by_reachability(
    defs: Mapping[str, Any],
    root_def_names: Sequence[str],
    internal_ref_prefix: str = "#/$defs/",
) -> dict[str, Any]:
    """Prunes definitions not reachable from the provided roots."""
    visited_defs = set()
    refs_queue = collections.deque(root_def_names)

    while refs_queue:
        def_name = refs_queue.popleft()
        if def_name in defs and def_name not in visited_defs:
            visited_defs.add(def_name)

            internal_refs = _collect_refs(defs[def_name])
            for ref in internal_refs:
                if ref.startswith(internal_ref_prefix):
                    refs_queue.append(ref.split(internal_ref_prefix)[-1])

    return {k: v for k, v in defs.items() if k in visited_defs}


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


def prune_catalog_components(
    catalog: CatalogApi,
    allowed_components: Sequence[str] | None = None,
) -> CatalogApi:
    """Returns a new Catalog with only the allowed components."""
    if not allowed_components:
        return catalog

    allowed_set = set(allowed_components)
    pruned_components = [
        comp for name, comp in catalog.components.items() if name in allowed_set
    ]
    return Catalog(
        catalog_id=catalog.catalog_id,
        protocol_version=catalog.protocol_version,
        components=pruned_components,
        functions=list(catalog.functions.values()),
        theme_schema=copy.deepcopy(catalog.theme_schema),
        instructions=catalog.instructions,
        defs=copy.deepcopy(catalog.defs),
        common_types_defs=copy.deepcopy(catalog.common_types_defs),
    )


def prune_messages_schema(
    s2c_schema: Mapping[str, Any],
    version: str,
    allowed_messages: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Returns a copy of s2c_schema containing only allowed messages."""
    if not allowed_messages:
        return dict(s2c_schema)

    s2c_schema_copy = copy.deepcopy(dict(s2c_schema))
    clean_ver = str(version).removeprefix("v")

    if clean_ver == VERSION_0_8:
        if "properties" in s2c_schema_copy and isinstance(
            s2c_schema_copy["properties"], dict
        ):
            s2c_schema_copy["properties"] = _prune_defs_by_reachability(
                defs=s2c_schema_copy["properties"],
                root_def_names=allowed_messages,
                internal_ref_prefix="#/properties/",
            )
    else:
        if "oneOf" in s2c_schema_copy and isinstance(s2c_schema_copy["oneOf"], list):
            s2c_schema_copy["oneOf"] = [
                item
                for item in s2c_schema_copy["oneOf"]
                if isinstance(item, dict)
                and "$ref" in item
                and isinstance(item["$ref"], str)
                and item["$ref"].startswith("#/$defs/")
                and item["$ref"].split("/")[-1] in allowed_messages
            ]

        if "$defs" in s2c_schema_copy and isinstance(s2c_schema_copy["$defs"], dict):
            s2c_schema_copy["$defs"] = _prune_defs_by_reachability(
                defs=s2c_schema_copy["$defs"],
                root_def_names=allowed_messages,
                internal_ref_prefix="#/$defs/",
            )

    return s2c_schema_copy


def prune_common_types_schema(
    common_types_schema: Mapping[str, Any],
    catalog_schema: Mapping[str, Any],
    s2c_schema: Mapping[str, Any],
) -> dict[str, Any]:
    """Returns a copy of common_types_schema with unused definitions pruned."""
    if not common_types_schema or "$defs" not in common_types_schema:
        return dict(common_types_schema) if common_types_schema else {}

    external_refs = _collect_refs(catalog_schema)
    external_refs.update(_collect_refs(s2c_schema))

    root_common_types = []
    for ref in external_refs:
        if isinstance(ref, str) and (
            "common_types.json#/$defs/" in ref or ref.startswith("#/$defs/")
        ):
            root_common_types.append(ref.split("#/$defs/")[-1])

    new_common_types_schema = copy.deepcopy(dict(common_types_schema))
    new_common_types_schema["$defs"] = _prune_defs_by_reachability(
        defs=new_common_types_schema["$defs"],
        root_def_names=root_common_types,
    )
    return new_common_types_schema


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
