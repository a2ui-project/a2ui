import datetime

from . import common_types_pb2 as _common_types_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ActionMetadata(_message.Message):
    __slots__ = ("extensions",)
    EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    extensions: _common_types_pb2.Extensions
    def __init__(
        self,
        extensions: _Optional[_Union[_common_types_pb2.Extensions, _Mapping]] = ...,
    ) -> None: ...

class ActionEventMessage(_message.Message):
    __slots__ = (
        "name",
        "user_message",
        "surface_id",
        "source_component_id",
        "timestamp",
        "context",
        "metadata",
    )
    NAME_FIELD_NUMBER: _ClassVar[int]
    USER_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_COMPONENT_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    name: str
    user_message: str
    surface_id: str
    source_component_id: str
    timestamp: _timestamp_pb2.Timestamp
    context: _struct_pb2.Struct
    metadata: ActionMetadata
    def __init__(
        self,
        name: _Optional[str] = ...,
        user_message: _Optional[str] = ...,
        surface_id: _Optional[str] = ...,
        source_component_id: _Optional[str] = ...,
        timestamp: _Optional[
            _Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]
        ] = ...,
        context: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
        metadata: _Optional[_Union[ActionMetadata, _Mapping]] = ...,
    ) -> None: ...

class CallAgentFunctionMessage(_message.Message):
    __slots__ = ("surface_id", "function_call_id", "call_function")
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_FUNCTION_FIELD_NUMBER: _ClassVar[int]
    surface_id: str
    function_call_id: str
    call_function: _common_types_pb2.FunctionCall
    def __init__(
        self,
        surface_id: _Optional[str] = ...,
        function_call_id: _Optional[str] = ...,
        call_function: _Optional[
            _Union[_common_types_pb2.FunctionCall, _Mapping]
        ] = ...,
    ) -> None: ...

class RendererFunctionResponseMessage(_message.Message):
    __slots__ = ("renderer_function_response",)
    RENDERER_FUNCTION_RESPONSE_FIELD_NUMBER: _ClassVar[int]
    renderer_function_response: _common_types_pb2.FunctionResponse
    def __init__(
        self,
        renderer_function_response: _Optional[
            _Union[_common_types_pb2.FunctionResponse, _Mapping]
        ] = ...,
    ) -> None: ...

class ValidationFailedError(_message.Message):
    __slots__ = ("code", "surface_id", "path", "message")

    class Code(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        CODE_UNSPECIFIED: _ClassVar[ValidationFailedError.Code]
        VALIDATION_FAILED: _ClassVar[ValidationFailedError.Code]
        UNALLOWED_PARENT: _ClassVar[ValidationFailedError.Code]
        UNALLOWED_CHILD: _ClassVar[ValidationFailedError.Code]

    CODE_UNSPECIFIED: ValidationFailedError.Code
    VALIDATION_FAILED: ValidationFailedError.Code
    UNALLOWED_PARENT: ValidationFailedError.Code
    UNALLOWED_CHILD: ValidationFailedError.Code
    CODE_FIELD_NUMBER: _ClassVar[int]
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    code: ValidationFailedError.Code
    surface_id: str
    path: str
    message: str
    def __init__(
        self,
        code: _Optional[_Union[ValidationFailedError.Code, str]] = ...,
        surface_id: _Optional[str] = ...,
        path: _Optional[str] = ...,
        message: _Optional[str] = ...,
    ) -> None: ...

class GenericError(_message.Message):
    __slots__ = ("code", "message", "surface_id", "function_call_id", "details")
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    DETAILS_FIELD_NUMBER: _ClassVar[int]
    code: str
    message: str
    surface_id: str
    function_call_id: str
    details: _struct_pb2.Struct
    def __init__(
        self,
        code: _Optional[str] = ...,
        message: _Optional[str] = ...,
        surface_id: _Optional[str] = ...,
        function_call_id: _Optional[str] = ...,
        details: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
    ) -> None: ...

class RendererErrorMessage(_message.Message):
    __slots__ = ("validation_error", "generic_error")
    VALIDATION_ERROR_FIELD_NUMBER: _ClassVar[int]
    GENERIC_ERROR_FIELD_NUMBER: _ClassVar[int]
    validation_error: ValidationFailedError
    generic_error: GenericError
    def __init__(
        self,
        validation_error: _Optional[_Union[ValidationFailedError, _Mapping]] = ...,
        generic_error: _Optional[_Union[GenericError, _Mapping]] = ...,
    ) -> None: ...

class RendererToAgentMessage(_message.Message):
    __slots__ = (
        "version",
        "action",
        "call_agent_function",
        "renderer_function_response",
        "error",
    )
    VERSION_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    CALL_AGENT_FUNCTION_FIELD_NUMBER: _ClassVar[int]
    RENDERER_FUNCTION_RESPONSE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    version: str
    action: ActionEventMessage
    call_agent_function: CallAgentFunctionMessage
    renderer_function_response: RendererFunctionResponseMessage
    error: RendererErrorMessage
    def __init__(
        self,
        version: _Optional[str] = ...,
        action: _Optional[_Union[ActionEventMessage, _Mapping]] = ...,
        call_agent_function: _Optional[
            _Union[CallAgentFunctionMessage, _Mapping]
        ] = ...,
        renderer_function_response: _Optional[
            _Union[RendererFunctionResponseMessage, _Mapping]
        ] = ...,
        error: _Optional[_Union[RendererErrorMessage, _Mapping]] = ...,
    ) -> None: ...
