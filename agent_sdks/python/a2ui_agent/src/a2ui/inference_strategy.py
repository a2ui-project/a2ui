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

from abc import ABC, abstractmethod
from typing import Optional, Any


class InferenceStrategy(ABC):

  @abstractmethod
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
    """
    Generates a system prompt for all LLM requests.

    Args:
      role_description: Description of the agent's role.
      workflow_description: Description of the workflow.
      ui_description: Description of the UI.
      client_ui_capabilities: Capabilities reported by the client for targeted schema pruning.
      allowed_components: List of allowed catalog components.
      allowed_messages: List of allowed messages.
      include_schema: Whether to include the schema.
      include_examples: Whether to include examples.
      validate_examples: Whether to validate examples.

    Returns:
      The system prompt.
    """
    pass
