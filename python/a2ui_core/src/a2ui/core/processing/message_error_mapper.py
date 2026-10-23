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

"""Maps A2uiError exceptions into wire-protocol error messages."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from a2ui.core.exceptions import (
    A2uiCatalogError,
    A2uiDataError,
    A2uiError,
    A2uiExpressionError,
    A2uiIntegrityError,
    A2uiRecursionError,
    A2uiStateError,
    A2uiValidationError,
)
from a2ui.core.processing.format_pydantic_error import to_json_pointer


@dataclass
class ErrorEnvelopeContext:
    """Envelope context extracted from an incoming raw message."""

    version: str = "v1.0"
    action: str | None = None
    surface_id: str | None = None
    function_call_id: str | None = None


_ACTION_KEYS = (
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callRendererFunction",
    "beginRendering",
    "surfaceUpdate",
    "dataModelUpdate",
)


def _extract_dict_context(msg: Mapping[str, Any]) -> ErrorEnvelopeContext:
    """Extracts envelope context from a mapping."""
    raw_ver = msg.get("version")
    version = raw_ver if raw_ver in ("v0.8", "v0.9", "v1.0") else "v1.0"
    action: str | None = None
    for key in _ACTION_KEYS:
        if key in msg:
            action = key
            break

    inner = msg.get(action) if action else None
    surface_id: str | None = None
    function_call_id: str | None = None
    if isinstance(inner, Mapping):
        raw_sid = inner.get("surfaceId")
        if isinstance(raw_sid, str):
            surface_id = raw_sid
        raw_fcid = inner.get("functionCallId")
        if isinstance(raw_fcid, str):
            function_call_id = raw_fcid
    return ErrorEnvelopeContext(
        version=version,
        action=action,
        surface_id=surface_id,
        function_call_id=function_call_id,
    )


def _is_collection_payload(value: Any) -> bool:
    """Returns whether value is an iterable message collection rather than a single item."""
    return isinstance(value, Iterable) and not isinstance(
        value, (BaseModel, Mapping, str, bytes)
    )


def extract_envelope_error_context(raw_message: Any) -> ErrorEnvelopeContext:
    """Extracts envelope metadata from a raw message payload."""
    if isinstance(raw_message, Mapping):
        msgs = raw_message.get("messages")
        if _is_collection_payload(msgs):
            msg_list = list(msgs)
            if msg_list:
                return extract_envelope_error_context(msg_list[-1])
        return _extract_dict_context(raw_message)
    if _is_collection_payload(raw_message):
        msg_list = list(raw_message)
        if msg_list:
            return extract_envelope_error_context(msg_list[-1])
    return ErrorEnvelopeContext()


def _infer_error_code(err: A2uiError, ctx: ErrorEnvelopeContext) -> str:
    """Determines the canonical protocol error code for an A2uiError."""
    if err.code:
        return err.code
    if ctx.action == "callRendererFunction":
        return "INVALID_FUNCTION_CALL"
    if isinstance(err, A2uiRecursionError):
        return "RECURSION_LIMIT_EXCEEDED"
    if isinstance(err, A2uiIntegrityError):
        return "INTEGRITY_ERROR"
    if isinstance(err, A2uiCatalogError):
        return "CATALOG_NOT_FOUND"
    if isinstance(err, A2uiStateError):
        return "SURFACE_NOT_FOUND"
    if isinstance(err, A2uiDataError):
        return "DATA_ERROR"
    if isinstance(err, A2uiExpressionError):
        return "EXPRESSION_ERROR"
    if isinstance(err, A2uiValidationError):
        return "VALIDATION_FAILED"
    return "INTERNAL_ERROR"


def _infer_error_path(err: A2uiError) -> str | None:
    """Resolves the RFC 6901 JSON Pointer path for an A2uiError."""
    if err.path:
        return to_json_pointer(err.path)
    if isinstance(err, A2uiValidationError) and err.details:
        first_path = err.details[0].path
        if first_path:
            return to_json_pointer(first_path)
    return None


def map_error_to_renderer_message(
    err: A2uiError,
    raw_message_or_ctx: Any = None,
) -> dict[str, Any]:
    """Maps an A2uiError into a RendererToAgentMessage / ClientToServerMessage dict."""
    ctx = (
        raw_message_or_ctx
        if isinstance(raw_message_or_ctx, ErrorEnvelopeContext)
        else extract_envelope_error_context(raw_message_or_ctx)
    )
    code = _infer_error_code(err, ctx)
    error_body: dict[str, Any] = {
        "code": code,
        "message": err.message,
    }
    if code == "INVALID_FUNCTION_CALL":
        fc_id = err.function_call_id or ctx.function_call_id or ""
        error_body["functionCallId"] = fc_id
    else:
        sid = err.surface_id if err.surface_id is not None else (ctx.surface_id or "")
        error_body["surfaceId"] = sid
        path = _infer_error_path(err)
        if path:
            error_body["path"] = path

    return {
        "version": ctx.version,
        "error": error_body,
    }
