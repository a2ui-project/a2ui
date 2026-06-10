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

import copy
import json
import logging
import os
import importlib.resources
from typing import Any, Optional, Callable
from dataclasses import dataclass, field
from .utils import load_from_bundled_resource
from ..inference_strategy import InferenceStrategy
from .constants import *
from .catalog import CatalogConfig, A2uiCatalog


class A2uiSchemaManager(InferenceStrategy):
  """Manages A2UI schema levels and prompt injection."""

  def __init__(
      self,
      version: str,
      catalogs: Optional[list[CatalogConfig]] = None,
      accepts_inline_catalogs: bool = False,
      schema_modifiers: Optional[
          list[Callable[[dict[str, Any]], dict[str, Any]]]
      ] = None,
  ):
    self._version = version
    self._accepts_inline_catalogs = accepts_inline_catalogs

    self._server_to_client_schema = None
    self._common_types_schema = None
    self._supported_catalogs: list[A2uiCatalog] = []
    self._catalog_example_paths: dict[str, str] = {}
    self._schema_modifiers = schema_modifiers or []
    self._load_schemas(version, catalogs or [])

  @property
  def accepts_inline_catalogs(self) -> bool:
    return self._accepts_inline_catalogs

  @property
  def supported_catalog_ids(self) -> list[str]:
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
  ):
    """Loads separate schema components and processes catalogs."""
    catalogs = catalogs or []
    if version not in SPEC_VERSION_MAP:
      raise ValueError(
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
        load_from_bundled_resource(version, COMMON_TYPES_SCHEMA_KEY, SPEC_VERSION_MAP)
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
      )
      self._supported_catalogs.append(catalog)
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
      raise ValueError("No supported catalogs found.")  # This should not happen.

    if not client_ui_capabilities or not isinstance(client_ui_capabilities, dict):
      return self._supported_catalogs[0]

    inline_catalogs: list[dict[str, Any]] = client_ui_capabilities.get(
        INLINE_CATALOGS_KEY, []
    )
    client_supported_catalog_ids: list[str] = client_ui_capabilities.get(
        SUPPORTED_CATALOG_IDS_KEY, []
    )

    if not self._accepts_inline_catalogs and inline_catalogs:
      raise ValueError(
          f"Inline catalog '{INLINE_CATALOGS_KEY}' is provided in client UI"
          " capabilities. However, the agent does not accept inline catalogs."
      )

    if inline_catalogs:
      # Determine the base catalog: use supportedCatalogIds if provided,
      # otherwise fall back to the agent's default catalog.
      base_catalog = self._supported_catalogs[0]
      if client_supported_catalog_ids:
        agent_supported_catalogs = {c.catalog_id: c for c in self._supported_catalogs}
        for cscid in client_supported_catalog_ids:
          if cscid in agent_supported_catalogs:
            base_catalog = agent_supported_catalogs[cscid]
            break

      merged_schema = copy.deepcopy(base_catalog.catalog_schema)

      for inline_catalog_schema in inline_catalogs:
        inline_catalog_schema = self._apply_modifiers(inline_catalog_schema)
        inline_components = inline_catalog_schema.get(CATALOG_COMPONENTS_KEY, {})
        merged_schema[CATALOG_COMPONENTS_KEY].update(inline_components)

      return A2uiCatalog(
          version=self._version,
          name=INLINE_CATALOG_NAME,
          catalog_schema=merged_schema,
          s2c_schema=self._server_to_client_schema,
          common_types_schema=self._common_types_schema,
      )

    if not client_supported_catalog_ids:
      return self._supported_catalogs[0]

    agent_supported_catalogs = {c.catalog_id: c for c in self._supported_catalogs}
    for cscid in client_supported_catalog_ids:
      if cscid in agent_supported_catalogs:
        return agent_supported_catalogs[cscid]

    raise ValueError(
        "No client-supported catalog found on the agent side. Agent-supported catalogs"
        f" are: {[c.catalog_id for c in self._supported_catalogs]}"
    )

  def get_selected_catalog(
      self,
      client_ui_capabilities: Optional[dict[str, Any]] = None,
      allowed_components: Optional[list[str]] = None,
      allowed_messages: Optional[list[str]] = None,
  ) -> A2uiCatalog:
    """Gets the selected catalog after selection and component pruning."""
    catalog = self._select_catalog(client_ui_capabilities)
    pruned_catalog = catalog.with_pruning(allowed_components, allowed_messages)
    return pruned_catalog

  def load_examples(self, catalog: A2uiCatalog, validate: bool = False) -> str:
    """Loads examples for a catalog."""
    if catalog.catalog_id in self._catalog_example_paths:
      return catalog.load_examples(
          self._catalog_example_paths[catalog.catalog_id], validate=validate
      )
    return ""

  def generate_system_prompt(
      self,
      role_description: str,
      workflow_description: str = "",
      ui_description: str = "",
      client_ui_capabilities: Optional[dict[str, Any]] = None,
      allowed_components: Optional[list[str]] = None,
      allowed_messages: Optional[list[str]] = None,
      include_schema: bool = False,
      include_examples: bool = False,
      validate_examples: bool = False,
  ) -> str:
    """Assembles the final system instruction for the LLM."""
    parts = [role_description]

    workflow = DEFAULT_WORKFLOW_RULES
    if workflow_description:
      workflow += f"\n{workflow_description}"
    parts.append(f"## Workflow Description:\n{workflow}")

    if ui_description:
      parts.append(f"## UI Description:\n{ui_description}")

    selected_catalog = self.get_selected_catalog(
        client_ui_capabilities, allowed_components, allowed_messages
    )

    if include_schema:
      parts.append(selected_catalog.render_as_llm_instructions())

    if include_examples:
      examples_str = self.load_examples(selected_catalog, validate=validate_examples)
      if examples_str:
        parts.append(f"### Examples:\n{examples_str}")

    return "\n\n".join(parts)
