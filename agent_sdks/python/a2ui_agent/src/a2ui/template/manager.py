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

from ..inference_strategy import InferenceStrategy
from typing import Optional, Any


class A2uiTemplateManager(InferenceStrategy):

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
    # TODO: Implementation logic for Template Manager
    raise NotImplementedError("This method is not yet implemented.")
