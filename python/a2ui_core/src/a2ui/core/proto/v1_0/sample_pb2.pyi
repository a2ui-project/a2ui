from . import agent_to_renderer_pb2 as _agent_to_renderer_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CatalogSample(_message.Message):
    __slots__ = ("name", "description", "messages")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    messages: _containers.RepeatedCompositeFieldContainer[
        _agent_to_renderer_pb2.AgentToRendererMessage
    ]
    def __init__(
        self,
        name: _Optional[str] = ...,
        description: _Optional[str] = ...,
        messages: _Optional[
            _Iterable[_Union[_agent_to_renderer_pb2.AgentToRendererMessage, _Mapping]]
        ] = ...,
    ) -> None: ...
