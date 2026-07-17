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

"""Unified interface coordinating prompt generation and parsing of LLM response payloads."""

import warnings
from abc import ABC, abstractmethod
from typing import Any, Optional
from a2ui.prompt.generator import PromptGenerator
from a2ui.parser.parser import Parser


class InferenceFormat(ABC):
    """Interface coordinating system prompt generation and response parsing."""

    @property
    @abstractmethod
    def prompt_generator(self) -> PromptGenerator:
        """The PromptGenerator instance associated with this inference format."""
        pass

    @property
    @abstractmethod
    def parser(self) -> Parser:
        """The Parser instance associated with this inference format."""
        pass

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
        """Generates a system prompt for all LLM requests (deprecated compatibility helper).

        Args:
            role_description: Description of the agent's role.
            workflow_description: Optional description of the task workflow.
            ui_description: Optional UI context or rules.
            client_ui_capabilities: Optional client UI capability details.
            allowed_components: Optional list of component tags the LLM may use.
            allowed_messages: Optional list of message types allowed.
            include_schema: Whether to include component schemas in the prompt.
            include_examples: Whether to include few-shot examples.
            validate_examples: Whether to validate few-shot examples on generation.

        Returns:
            The complete system prompt string.
        """
        warnings.warn(
            "generate_system_prompt is deprecated. Use prompt_generator.generate(...)"
            " instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.prompt_generator.generate(
            role_description=role_description,
            workflow_description=workflow_description,
            ui_description=ui_description,
            client_ui_capabilities=client_ui_capabilities,
            allowed_components=allowed_components,
            allowed_messages=allowed_messages,
            include_schema=include_schema,
            include_examples=include_examples,
            validate_examples=validate_examples,
        )
