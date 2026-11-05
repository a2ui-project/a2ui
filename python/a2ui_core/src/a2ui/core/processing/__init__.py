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

"""Message processing engine, execution contexts, and internal operation definitions."""

from .adapters import VersionAdapter, VersionAdapterFactory
from .execution_context import ExecutionContext as ExecutionContext
from .format_pydantic_error import (
    format_pydantic_issue,
    format_validation_error,
    format_validation_error_summary,
)
from .message_error_mapper import (
    ErrorEnvelopeContext,
    extract_envelope_error_context,
    map_error_to_renderer_message,
)
from .message_processor import (
    CapabilitiesOptions,
    MessageProcessor,
    MessageProcessorOptions,
)
from .operations import (
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
)

__all__ = [
    "CapabilitiesOptions",
    "ErrorEnvelopeContext",
    "ExecutionContext",
    "InternalCreateSurfaceOp",
    "InternalDeleteSurfaceOp",
    "InternalOperation",
    "InternalUpdateComponentsOp",
    "InternalUpdateDataModelOp",
    "MessageProcessor",
    "MessageProcessorOptions",
    "VersionAdapter",
    "VersionAdapterFactory",
    "extract_envelope_error_context",
    "format_pydantic_issue",
    "format_validation_error",
    "format_validation_error_summary",
    "map_error_to_renderer_message",
]
