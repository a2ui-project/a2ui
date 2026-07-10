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
from typing import Optional, Any, List
from a2ui.parser.response_part import ResponsePart


class Parser(ABC):
    """Abstract interface defining the response parser and tokenizer."""

    @abstractmethod
    def parse_response(self, content: str) -> List[ResponsePart]:
        """Parses full response content into standard JSON payload parts."""
        pass

    @abstractmethod
    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Processes a streamed token chunk (incremental parsing)."""
        pass

    @abstractmethod
    def has_a2ui_parts(self, content: str) -> bool:
        """Checks if the content contains formatted structured blocks for this parser."""
        pass

    @property
    def open_tag_prefix(self) -> str:
        """The opening tag prefix to match in token stream (e.g. '<a2ui-json', '<a2ui')."""
        return "<a2ui-json"


class InferenceStrategy(ABC):
    """Interface coordinating system prompt generation and response parsing."""

    @property
    @abstractmethod
    def parser(self) -> Parser:
        """The Parser instance associated with this inference strategy."""
        pass

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
        format_strategy: Optional[Any] = None,
    ) -> str:
        """
        Generates a system prompt for all LLM requests.
        """
        pass
