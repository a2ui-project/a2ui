from . import renderer_to_agent_pb2 as _renderer_to_agent_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RendererToAgentMessageList(_message.Message):
    __slots__ = ("messages",)
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[_renderer_to_agent_pb2.RendererToAgentMessage]
    def __init__(self, messages: _Optional[_Iterable[_Union[_renderer_to_agent_pb2.RendererToAgentMessage, _Mapping]]] = ...) -> None: ...
