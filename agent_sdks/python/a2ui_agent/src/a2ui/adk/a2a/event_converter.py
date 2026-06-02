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

"""Module for the A2UI Event Converter.

This module provides the `A2uiEventConverter` which intercepts ADK events and automatically
translates GenAI model outputs (both tool-based A2UI function calls and text-based delimited A2UI blocks)
into A2A (Agent-to-Agent) event structures with A2UI payloads, using the session catalog if available.

Key Components:
  * `A2uiEventConverter`: An event converter that automatically injects the A2UI catalog into part conversion.

Usage Example:

  Configure the ADK executor to use the A2UI event converter:

  ```python
  config = A2aAgentExecutorConfig(
      event_converter=A2uiEventConverter()
  )
  executor = A2aAgentExecutor(config)
  ```
"""

from typing import TYPE_CHECKING, Optional

from a2ui.adk.a2a.part_converter import A2uiPartConverter
from google.adk.a2a.converters import part_converter
from google.adk.utils.feature_decorator import experimental

if TYPE_CHECKING:
  from a2a.server.events import Event as A2AEvent
  from google.adk.a2a.converters.part_converter import GenAIPartToA2APartConverter
  from google.adk.agents.invocation_context import InvocationContext
  from google.adk.events.event import Event


@experimental
class A2uiEventConverter:
  """An event converter that automatically injects the A2UI catalog into part conversion.

  This allows text-based A2UI extraction and validation to work even when the
  catalog is session-specific.
  """

  def __init__(
      self,
      catalog_key: str = "system:a2ui_catalog",
      bypass_tool_check: bool = False,
      fallback_text: Optional[str] = None,
  ):
    self._catalog_key = catalog_key
    self._bypass_tool_check = bypass_tool_check
    self._fallback_text = fallback_text

  def __call__(
      self,
      event: "Event",
      invocation_context: "InvocationContext",
      task_id: Optional[str] = None,
      context_id: Optional[str] = None,
      part_converter_func: "GenAIPartToA2APartConverter" = part_converter.convert_genai_part_to_a2a_part,
  ) -> list["A2AEvent"]:
    """Converts an ADK event to A2A events, using the session catalog if available."""
    from google.adk.a2a.converters.event_converter import (
        convert_event_to_a2a_events,
    )

    catalog = invocation_context.session.state.get(self._catalog_key)
    if catalog:
      # Use the catalog-aware part converter
      effective_converter = A2uiPartConverter(
          catalog,
          bypass_tool_check=self._bypass_tool_check,
          fallback_text=self._fallback_text,
      ).convert
    else:
      effective_converter = part_converter_func

    return convert_event_to_a2a_events(
        event,
        invocation_context,
        task_id,
        context_id,
        effective_converter,
    )
