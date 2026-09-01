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

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from typing import Any
from a2ui.inference_format import InferenceFormat

from a2ui.prompt.generator import PromptGenerator
from a2ui.core.schema.v0_9.client_capabilities import V09Capabilities


class TemplateManager(ABC):
    """Abstract base class for template managers."""

    @property
    @abstractmethod
    def prompt_generator(self) -> PromptGenerator:
        """The prompt generator instance associated with the template manager."""
        raise NotImplementedError("This method is not yet implemented.")

    def generate_system_prompt(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Mapping[str, Any] | V09Capabilities | None = None,
        allowed_components: Sequence[str] | None = None,
        allowed_messages: Sequence[str] | None = None,
        include_schema: bool = False,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Generates a system prompt for requests (not yet implemented)."""
        # TODO: Implementation logic for Template Manager
        raise NotImplementedError("This method is not yet implemented.")
