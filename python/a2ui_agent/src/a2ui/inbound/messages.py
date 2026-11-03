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

"""Inbound renderer-to-agent message validation and model formatting."""

from collections.abc import Mapping
import json
from typing import Any, Literal, TypeAlias, Union

from pydantic import RootModel, TypeAdapter, ValidationError

from a2ui.core import A2uiValidationError
from a2ui.core.schema import ProtocolVersion
from a2ui.core.schema.v0_8 import (
    A2uiClientActionMessage as V08ClientActionMessage,
    A2uiRendererErrorMessage as V08ClientErrorMessage,
    ClientToServerMessage as V08ClientToServerMessage,
)
from a2ui.core.schema.v0_9 import (
    A2uiClientActionMessage as V09ClientActionMessage,
    A2uiRendererErrorMessage as V09ClientErrorMessage,
    ClientToServerMessage as V09ClientToServerMessage,
)
from a2ui.core.schema.v1_0 import (
    A2uiGenericError,
    A2uiRendererActionMessage,
    A2uiRendererErrorMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
    RendererToAgentMessage,
)

InboundMessage: TypeAlias = Union[
    RendererToAgentMessage,
    V09ClientToServerMessage,
    V08ClientToServerMessage,
]

InboundMessageKind: TypeAlias = Literal[
    "action",
    "error",
    "callAgentFunction",
    "rendererFunctionResponse",
]

_V10_MESSAGE_KEYS = frozenset({
    "action",
    "error",
    "callAgentFunction",
    "rendererFunctionResponse",
})
_V09_MESSAGE_KEYS = frozenset({"action", "error"})
_V08_MESSAGE_KEYS = frozenset({"userAction", "error"})

_V10_ADAPTER: TypeAdapter[RendererToAgentMessage] = TypeAdapter(RendererToAgentMessage)
_V09_ADAPTER: TypeAdapter[V09ClientToServerMessage] = TypeAdapter(
    V09ClientToServerMessage
)
_V08_ADAPTER: TypeAdapter[V08ClientToServerMessage] = TypeAdapter(
    V08ClientToServerMessage
)


def _resolve_protocol_version(
    version: ProtocolVersion | str,
) -> ProtocolVersion:
    """Resolves a version string or enum into a ProtocolVersion."""
    if isinstance(version, ProtocolVersion):
        return version
    try:
        return ProtocolVersion(version)
    except ValueError as exc:
        raise A2uiValidationError(
            f"Unsupported A2UI protocol version: {version!r}"
        ) from exc


def _unwrap_root(message: Any) -> Any:
    """Unwraps a RootModel envelope if present."""
    if isinstance(message, RootModel):
        return message.root
    return message


def parse_inbound_message(
    data: Mapping[str, Any],
    version: ProtocolVersion | str = ProtocolVersion.V1_0,
) -> InboundMessage:
    """Validates a raw renderer-to-agent message against the versioned wire schema.

    Args:
      data: Raw decoded JSON mapping received from the renderer.
      version: Target A2UI protocol version. Defaults to `ProtocolVersion.V1_0`.

    Returns:
      The validated `InboundMessage` model instance.

    Raises:
      A2uiValidationError: If `data` is not a mapping, violates the envelope
        structure, mismatches the expected protocol version, or fails schema
        validation.
    """
    resolved_version = _resolve_protocol_version(version)
    if not isinstance(data, Mapping):
        raise A2uiValidationError(
            "Inbound renderer message must be a JSON object mapping."
        )

    keys = set(data.keys())
    if resolved_version == ProtocolVersion.V1_0:
        present_keys = keys & _V10_MESSAGE_KEYS
        if len(present_keys) != 1 or keys != {"version", *present_keys}:
            raise A2uiValidationError(
                "v1.0 inbound message must contain 'version' and exactly one of "
                "'action', 'error', 'callAgentFunction', or "
                "'rendererFunctionResponse'."
            )
        if data.get("version") != ProtocolVersion.V1_0.value:
            raise A2uiValidationError(
                "v1.0 inbound message must declare version '1.0', got "
                f"{data.get('version')!r}."
            )
        if "callAgentFunction" in data:
            raw_call = data.get("callAgentFunction")
            if isinstance(raw_call, Mapping):
                raw_cf = raw_call.get("callFunction")
                if isinstance(raw_cf, Mapping) and "@call" not in raw_cf:
                    raise A2uiValidationError(
                        "v1.0 callAgentFunction.callFunction must specify '@call'."
                    )
        if "rendererFunctionResponse" in data:
            raw_resp = data.get("rendererFunctionResponse")
            if isinstance(raw_resp, Mapping):
                has_val = "value" in raw_resp
                has_err = "error" in raw_resp
                if has_val == has_err:
                    raise A2uiValidationError(
                        "v1.0 rendererFunctionResponse must specify exactly one of "
                        "'value' or 'error'."
                    )
        try:
            parsed = _unwrap_root(_V10_ADAPTER.validate_python(dict(data)))
        except ValidationError as exc:
            raise A2uiValidationError(
                f"Invalid v1.0 inbound renderer message: {exc}"
            ) from exc
        if isinstance(parsed, A2uiRendererErrorMessage):
            inner_error = _unwrap_root(parsed.error)
            if isinstance(inner_error, A2uiGenericError):
                has_surface = inner_error.surface_id is not None
                has_fn_call = inner_error.function_call_id is not None
                if has_surface == has_fn_call:
                    raise A2uiValidationError(
                        "v1.0 GenericError must specify exactly one of 'surfaceId' or "
                        "'functionCallId'."
                    )
        return parsed

    if resolved_version in (ProtocolVersion.V0_9, ProtocolVersion.V0_9_1):
        present_keys = keys & _V09_MESSAGE_KEYS
        if len(present_keys) != 1 or keys != {"version", *present_keys}:
            raise A2uiValidationError(
                "v0.9 inbound message must contain 'version' and exactly one of "
                "'action' or 'error'."
            )
        if data.get("version") not in (
            ProtocolVersion.V0_9.value,
            ProtocolVersion.V0_9_1.value,
        ):
            raise A2uiValidationError(
                "v0.9 inbound message must declare version 'v0.9' or 'v0.9.1', got "
                f"{data.get('version')!r}."
            )
        try:
            parsed = _unwrap_root(_V09_ADAPTER.validate_python(dict(data)))
        except ValidationError as exc:
            raise A2uiValidationError(
                f"Invalid v0.9 inbound renderer message: {exc}"
            ) from exc
        if isinstance(parsed, V09ClientErrorMessage):
            inner_error = _unwrap_root(parsed.error)
            if getattr(inner_error, "code", None) != "VALIDATION_FAILED":
                if getattr(inner_error, "surface_id", None) is None:
                    raise A2uiValidationError(
                        "v0.9 GenericError must specify 'surfaceId'."
                    )
        return parsed

    if resolved_version == ProtocolVersion.V0_8:
        if "version" in data and data.get("version") != ProtocolVersion.V0_8.value:
            raise A2uiValidationError(
                "v0.8 inbound message cannot declare mismatched version "
                f"{data.get('version')!r}."
            )
        payload = {k: v for k, v in data.items() if k != "version"}
        present_keys = set(payload.keys()) & _V08_MESSAGE_KEYS
        if len(present_keys) != 1 or set(payload.keys()) != present_keys:
            raise A2uiValidationError(
                "v0.8 inbound message must contain exactly one of 'userAction' or "
                "'error'."
            )
        try:
            return _unwrap_root(_V08_ADAPTER.validate_python(payload))
        except ValidationError as exc:
            raise A2uiValidationError(
                f"Invalid v0.8 inbound renderer message: {exc}"
            ) from exc

    raise A2uiValidationError(
        f"Unsupported A2UI protocol version: {resolved_version!r}"
    )


def get_inbound_message_kind(message: InboundMessage) -> InboundMessageKind:
    """Returns the discriminated kind of a validated inbound message."""
    unwrapped = _unwrap_root(message)
    if isinstance(
        unwrapped,
        (
            A2uiRendererActionMessage,
            V09ClientActionMessage,
            V08ClientActionMessage,
        ),
    ):
        return "action"
    if isinstance(
        unwrapped,
        (
            A2uiRendererErrorMessage,
            V09ClientErrorMessage,
            V08ClientErrorMessage,
        ),
    ):
        return "error"
    if isinstance(unwrapped, CallAgentFunctionMessage):
        return "callAgentFunction"
    if isinstance(unwrapped, RendererFunctionResponseMessage):
        return "rendererFunctionResponse"
    raise A2uiValidationError(f"Unrecognized inbound message type: {type(message)!r}")


def format_inbound_for_model(message: InboundMessage) -> str | None:
    """Formats an inbound action or error message for LLM context consumption.

    Args:
      message: Validated inbound message returned by `parse_inbound_message`.

    Returns:
      A structured text description of the user action or renderer error suitable
      for model input, or `None` for RPC messages (`callAgentFunction` and
      `rendererFunctionResponse`) handled by the orchestration layer.
    """
    unwrapped = _unwrap_root(message)
    if isinstance(unwrapped, (A2uiRendererActionMessage, V09ClientActionMessage)):
        action = unwrapped.action
        return (
            f"User triggered action '{action.name}' on surface "
            f"'{action.surface_id}' (component '{action.source_component_id}') "
            f"with context: {json.dumps(action.context)}"
        )

    if isinstance(unwrapped, V08ClientActionMessage):
        action = unwrapped.user_action
        return (
            f"User triggered action '{action.name}' on surface "
            f"'{action.surface_id}' (component '{action.source_component_id}') "
            f"with context: {json.dumps(action.context)}"
        )

    if isinstance(unwrapped, (A2uiRendererErrorMessage, V09ClientErrorMessage)):
        error = _unwrap_root(unwrapped.error)
        code = error.code.value if hasattr(error.code, "value") else str(error.code)
        path = getattr(error, "path", None)
        surface_id = getattr(error, "surface_id", None)
        function_call_id = getattr(error, "function_call_id", None)
        if path is not None:
            return (
                f"Renderer reported error '{code}' on surface '{surface_id}' "
                f"at path '{path}': {error.message}"
            )
        if surface_id is not None:
            return (
                f"Renderer reported error '{code}' on surface '{surface_id}': "
                f"{error.message}"
            )
        return (
            f"Renderer reported error '{code}' for function call "
            f"'{function_call_id}': {error.message}"
        )

    if isinstance(unwrapped, V08ClientErrorMessage):
        err_dump = unwrapped.error.model_dump(exclude_none=True, by_alias=True)
        return f"Renderer reported error: {json.dumps(err_dump)}"

    if isinstance(
        unwrapped, (CallAgentFunctionMessage, RendererFunctionResponseMessage)
    ):
        return None

    raise A2uiValidationError(f"Unrecognized inbound message type: {type(message)!r}")
