# Copyright 2025 Google LLC
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

import logging
from typing import Optional, List

from a2a.server.agent_execution import RequestContext
from a2a.types import AgentCard, AgentExtension

logger = logging.getLogger(__name__)

A2UI_EXTENSION_BASE_URI = "https://a2ui.org/a2a-extension/a2ui"
AGENT_EXTENSION_SUPPORTED_CATALOG_IDS_KEY = "supportedCatalogIds"
AGENT_EXTENSION_ACCEPTS_INLINE_CATALOGS_KEY = "acceptsInlineCatalogs"


def get_a2ui_agent_extension(
    version: str,
    accepts_inline_catalogs: bool = False,
    supported_catalog_ids: List[str] = [],
) -> AgentExtension:
  """Creates the A2UI AgentExtension configuration.

  Args:
      version: The version of the A2UI extension to use.
      accepts_inline_catalogs: Whether the agent accepts inline catalogs.
      supported_catalog_ids: All pre-defined catalogs the agent is known to support.

  Returns:
      The configured A2UI AgentExtension.
  """
  params = {}
  if accepts_inline_catalogs:
    params[AGENT_EXTENSION_ACCEPTS_INLINE_CATALOGS_KEY] = (
        True  # Only set if not default of False
    )

  if supported_catalog_ids:
    params[AGENT_EXTENSION_SUPPORTED_CATALOG_IDS_KEY] = supported_catalog_ids

  return AgentExtension(
      uri=f"{A2UI_EXTENSION_BASE_URI}/v{version}",
      description="Provides agent driven UI using the A2UI JSON format.",
      params=params if params else None,
  )


def _agent_extensions(agent_card: AgentCard) -> List[str]:
  """Returns the A2UI extension URIs supported by the agent."""
  extensions = []
  if (
      agent_card
      and hasattr(agent_card, "capabilities")
      and agent_card.capabilities
      and hasattr(agent_card.capabilities, "extensions")
      and agent_card.capabilities.extensions
  ):
    for ext in agent_card.capabilities.extensions:
      if ext.uri and ext.uri.startswith(A2UI_EXTENSION_BASE_URI):
        extensions.append(ext.uri)
  return extensions


def _requested_a2ui_extensions(context: RequestContext) -> List[str]:
  """Returns the A2UI extension URIs requested by the client."""
  requested_extensions = []
  if hasattr(context, "requested_extensions") and context.requested_extensions:
    requested_extensions.extend([
        ext
        for ext in context.requested_extensions
        if isinstance(ext, str) and ext.startswith(A2UI_EXTENSION_BASE_URI)
    ])

  if (
      hasattr(context, "message")
      and context.message
      and hasattr(context.message, "extensions")
      and context.message.extensions
  ):
    requested_extensions.extend([
        ext
        for ext in context.message.extensions
        if isinstance(ext, str) and ext.startswith(A2UI_EXTENSION_BASE_URI)
    ])

  return requested_extensions


def _select_newest_a2ui_extension(
    requested_extensions: List[str], agent_advertised_extensions: List[str]
) -> Optional[str]:
  """Selects the newest A2UI extension URI from the matched extensions."""
  matched_extensions = [
      uri for uri in requested_extensions if uri in agent_advertised_extensions
  ]
  if not matched_extensions:
    return None

  def _version_key(uri: str) -> tuple:
    version_str = uri.replace(f"{A2UI_EXTENSION_BASE_URI}/v", "")
    from packaging.version import parse as parse_version

    return parse_version(version_str)

  return max(matched_extensions, key=_version_key)


def try_activate_a2ui_extension(
    context: RequestContext, agent_card: AgentCard
) -> Optional[str]:
  """Activates the A2UI extension if requested.

  Args:
      context: The request context to check.
      agent_card: The agent card to check supported extensions.

  Returns:
      The version string of the activated A2UI extension, or None if not activated.
  """
  requested_extensions = _requested_a2ui_extensions(context)
  if not requested_extensions:
    return None

  agent_advertised_extensions = _agent_extensions(agent_card)
  if not agent_advertised_extensions:
    return None

  selected_uri = _select_newest_a2ui_extension(
      requested_extensions, agent_advertised_extensions
  )
  if selected_uri:
    context.add_activated_extension(selected_uri)
    return selected_uri.replace(f"{A2UI_EXTENSION_BASE_URI}/v", "")

  return None
