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

from typing import Optional, Any, Union
from a2ui.inference_format import InferenceFormat
from a2ui.core.schema.client_capabilities import V09Capabilities


class A2uiTemplateManager(InferenceFormat):
    """Manages prompt compilation and payload processing for template definitions."""

    @property
    def parser(self) -> Any:
        """The parser instance associated with the template manager."""
        raise NotImplementedError("This method is not yet implemented.")

    @property
    def prompt_generator(self) -> Any:
        """The prompt generator instance associated with the template manager."""
        raise NotImplementedError("This method is not yet implemented.")

    def generate_system_prompt(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[Union[dict[str, Any], V09Capabilities]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = False,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Generates a system prompt for requests (not yet implemented)."""
        # TODO: Implementation logic for Template Manager
        raise NotImplementedError("This method is not yet implemented.")
