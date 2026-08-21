from . import common_types_pb2 as _common_types_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SurfaceMetadata(_message.Message):
    __slots__ = ("extensions",)
    EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    extensions: _common_types_pb2.Extensions
    def __init__(self, extensions: _Optional[_Union[_common_types_pb2.Extensions, _Mapping]] = ...) -> None: ...

class Component(_message.Message):
    __slots__ = ("id", "component", "catalog_id", "accessibility", "metadata", "properties")
    ID_FIELD_NUMBER: _ClassVar[int]
    COMPONENT_FIELD_NUMBER: _ClassVar[int]
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESSIBILITY_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    PROPERTIES_FIELD_NUMBER: _ClassVar[int]
    id: str
    component: str
    catalog_id: str
    accessibility: _common_types_pb2.AccessibilityAttributes
    metadata: _common_types_pb2.ComponentMetadata
    properties: _struct_pb2.Struct
    def __init__(self, id: _Optional[str] = ..., component: _Optional[str] = ..., catalog_id: _Optional[str] = ..., accessibility: _Optional[_Union[_common_types_pb2.AccessibilityAttributes, _Mapping]] = ..., metadata: _Optional[_Union[_common_types_pb2.ComponentMetadata, _Mapping]] = ..., properties: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class CreateSurfaceMessage(_message.Message):
    __slots__ = ("surface_id", "catalog_id", "send_data_model", "components", "data_model", "metadata")
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    SEND_DATA_MODEL_FIELD_NUMBER: _ClassVar[int]
    COMPONENTS_FIELD_NUMBER: _ClassVar[int]
    DATA_MODEL_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    surface_id: str
    catalog_id: str
    send_data_model: bool
    components: _containers.RepeatedCompositeFieldContainer[Component]
    data_model: _struct_pb2.Struct
    metadata: SurfaceMetadata
    def __init__(self, surface_id: _Optional[str] = ..., catalog_id: _Optional[str] = ..., send_data_model: _Optional[bool] = ..., components: _Optional[_Iterable[_Union[Component, _Mapping]]] = ..., data_model: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., metadata: _Optional[_Union[SurfaceMetadata, _Mapping]] = ...) -> None: ...

class UpdateComponentsMessage(_message.Message):
    __slots__ = ("surface_id", "components")
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    COMPONENTS_FIELD_NUMBER: _ClassVar[int]
    surface_id: str
    components: _containers.RepeatedCompositeFieldContainer[Component]
    def __init__(self, surface_id: _Optional[str] = ..., components: _Optional[_Iterable[_Union[Component, _Mapping]]] = ...) -> None: ...

class UpdateDataModelMessage(_message.Message):
    __slots__ = ("surface_id", "path", "value")
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    surface_id: str
    path: str
    value: _struct_pb2.Value
    def __init__(self, surface_id: _Optional[str] = ..., path: _Optional[str] = ..., value: _Optional[_Union[_struct_pb2.Value, _Mapping]] = ...) -> None: ...

class DeleteSurfaceMessage(_message.Message):
    __slots__ = ("surface_id",)
    SURFACE_ID_FIELD_NUMBER: _ClassVar[int]
    surface_id: str
    def __init__(self, surface_id: _Optional[str] = ...) -> None: ...

class CallRendererFunctionMessage(_message.Message):
    __slots__ = ("function_call_id", "call_function")
    FUNCTION_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    CALL_FUNCTION_FIELD_NUMBER: _ClassVar[int]
    function_call_id: str
    call_function: _common_types_pb2.FunctionCall
    def __init__(self, function_call_id: _Optional[str] = ..., call_function: _Optional[_Union[_common_types_pb2.FunctionCall, _Mapping]] = ...) -> None: ...

class AgentFunctionResponseMessage(_message.Message):
    __slots__ = ("agent_function_response",)
    AGENT_FUNCTION_RESPONSE_FIELD_NUMBER: _ClassVar[int]
    agent_function_response: _common_types_pb2.FunctionResponse
    def __init__(self, agent_function_response: _Optional[_Union[_common_types_pb2.FunctionResponse, _Mapping]] = ...) -> None: ...

class AgentToRendererMessage(_message.Message):
    __slots__ = ("version", "create_surface", "update_components", "update_data_model", "delete_surface", "call_renderer_function", "agent_function_response")
    VERSION_FIELD_NUMBER: _ClassVar[int]
    CREATE_SURFACE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_COMPONENTS_FIELD_NUMBER: _ClassVar[int]
    UPDATE_DATA_MODEL_FIELD_NUMBER: _ClassVar[int]
    DELETE_SURFACE_FIELD_NUMBER: _ClassVar[int]
    CALL_RENDERER_FUNCTION_FIELD_NUMBER: _ClassVar[int]
    AGENT_FUNCTION_RESPONSE_FIELD_NUMBER: _ClassVar[int]
    version: str
    create_surface: CreateSurfaceMessage
    update_components: UpdateComponentsMessage
    update_data_model: UpdateDataModelMessage
    delete_surface: DeleteSurfaceMessage
    call_renderer_function: CallRendererFunctionMessage
    agent_function_response: AgentFunctionResponseMessage
    def __init__(self, version: _Optional[str] = ..., create_surface: _Optional[_Union[CreateSurfaceMessage, _Mapping]] = ..., update_components: _Optional[_Union[UpdateComponentsMessage, _Mapping]] = ..., update_data_model: _Optional[_Union[UpdateDataModelMessage, _Mapping]] = ..., delete_surface: _Optional[_Union[DeleteSurfaceMessage, _Mapping]] = ..., call_renderer_function: _Optional[_Union[CallRendererFunctionMessage, _Mapping]] = ..., agent_function_response: _Optional[_Union[AgentFunctionResponseMessage, _Mapping]] = ...) -> None: ...
