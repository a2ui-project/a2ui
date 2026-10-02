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

"""Response part data structures for A2UI parsers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from a2ui.core.schema import AgentToRendererMessage


class ResponsePart:
    """Represents a parsed part of an LLM response (`TextPart` or `A2uiPart`)."""

    def __init__(
        self,
        text: str = "",
        a2ui_raw: str | None = None,
        a2ui_json: Any | None = None,
        is_final: bool = True,
    ) -> None:
        self.text: str = text
        self.a2ui_raw: str | None = a2ui_raw
        self.a2ui_json: Any | None = a2ui_json
        self.is_final: bool = is_final

    def __eq__(self, other: object) -> bool:
        if type(other) is not ResponsePart:
            return NotImplemented
        return (
            self.text == other.text
            and self.a2ui_raw == other.a2ui_raw
            and self.a2ui_json == other.a2ui_json
            and self.is_final == other.is_final
        )

    def __repr__(self) -> str:
        return (
            f"ResponsePart(text={self.text!r}, a2ui_raw={self.a2ui_raw!r},"
            f" a2ui_json={self.a2ui_json!r}, is_final={self.is_final!r})"
        )


@dataclass
class TextPart(ResponsePart):
    """Represents extracted conversational text from an LLM response.

    Attributes:
        text: The conversational text content intended for user display.
    """

    text: str

    def __post_init__(self) -> None:
        super().__init__(text=self.text)


@dataclass
class RawA2uiPart:
    """Represents an uncompiled A2UI format content block extracted from an LLM response.

    Attributes:
        a2ui_raw: The raw uncompiled format content string (e.g., raw XML/DSL/JSON).
    """

    a2ui_raw: str


@dataclass
class RawResponsePart:
    """Represents an uncompiled token from an LLM response stream.

    Attributes:
        part: The underlying content, either conversational TextPart or uncompiled RawA2uiPart.
        is_final: Whether this part is complete/closed (not truncated during streaming).
    """

    part: TextPart | RawA2uiPart
    is_final: bool = True


@dataclass
class A2uiPart(ResponsePart):
    """Represents extracted and compiled A2UI payload messages.

    Attributes:
        a2ui: List of validated AgentToRendererMessage objects to deliver to client renderers.
    """

    a2ui: list[AgentToRendererMessage]

    def __post_init__(self) -> None:
        super().__init__(a2ui_json=self.a2ui)


__all__ = [
    "A2uiPart",
    "RawA2uiPart",
    "RawResponsePart",
    "ResponsePart",
    "TextPart",
]
