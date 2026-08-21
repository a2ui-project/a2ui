from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RendererDataModel(_message.Message):
    __slots__ = ("version", "surfaces")
    class SurfacesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _struct_pb2.Struct
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...
    VERSION_FIELD_NUMBER: _ClassVar[int]
    SURFACES_FIELD_NUMBER: _ClassVar[int]
    version: str
    surfaces: _containers.MessageMap[str, _struct_pb2.Struct]
    def __init__(self, version: _Optional[str] = ..., surfaces: _Optional[_Mapping[str, _struct_pb2.Struct]] = ...) -> None: ...
