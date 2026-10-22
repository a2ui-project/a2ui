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
from __future__ import annotations

from .constants import (
    DEFAULT_ROOT_ID,
    MSG_TYPE_AGENT_FUNCTION_RESPONSE,
    MSG_TYPE_BEGIN_RENDERING,
    MSG_TYPE_CALL_RENDERER_FUNCTION,
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DATA_MODEL_UPDATE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_SURFACE_UPDATE,
    MSG_TYPE_TEXT,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
)
from .errors import (
    A2uiCompilationError,
    A2uiCompilationParseError,
    A2uiCompilationValidationError,
)
from .lexer import BlockLexer
from .messages import (
    normalize_prompt_example_messages,
    to_message_dicts,
    to_message_models,
)
from .parser import Parser
from .payload_fixer import parse_and_fix
from .response_part import (
    A2uiPart,
    RawA2uiPart,
    RawResponsePart,
    ResponsePart,
    TextPart,
)

__all__ = [
    "A2uiCompilationError",
    "A2uiCompilationParseError",
    "A2uiCompilationValidationError",
    "A2uiPart",
    "BlockLexer",
    "DEFAULT_ROOT_ID",
    "MSG_TYPE_AGENT_FUNCTION_RESPONSE",
    "MSG_TYPE_BEGIN_RENDERING",
    "MSG_TYPE_CALL_RENDERER_FUNCTION",
    "MSG_TYPE_CREATE_SURFACE",
    "MSG_TYPE_DATA_MODEL_UPDATE",
    "MSG_TYPE_DELETE_SURFACE",
    "MSG_TYPE_SURFACE_UPDATE",
    "MSG_TYPE_TEXT",
    "MSG_TYPE_UPDATE_COMPONENTS",
    "MSG_TYPE_UPDATE_DATA_MODEL",
    "Parser",
    "RawA2uiPart",
    "RawResponsePart",
    "ResponsePart",
    "TextPart",
    "normalize_prompt_example_messages",
    "parse_and_fix",
    "to_message_dicts",
    "to_message_models",
]
