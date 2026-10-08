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

from __future__ import annotations

from dataclasses import dataclass
from typing import Union

from a2ui.core.schema import AgentToRendererMessage


@dataclass
class TextPart:
    """Conversational text part of an LLM response."""

    text: str


@dataclass
class RawA2uiPart:
    """An uncompiled A2UI string block extracted from an LLM response."""

    a2ui_raw: str


@dataclass
class RawResponsePart:
    """A segment of an unwrapped LLM response containing text or raw A2UI."""

    part: Union[TextPart, RawA2uiPart]
    is_final: bool = True


@dataclass
class A2uiPart:
    """A compiled A2UI message list part of an LLM response."""

    a2ui: list[AgentToRendererMessage]


ResponsePart = Union[TextPart, A2uiPart]
