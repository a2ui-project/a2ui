from . import renderer_to_agent_list_pb2 as _renderer_to_agent_list_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RendererToAgentListWrapper(_message.Message):
    __slots__ = ("messages",)
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    messages: _renderer_to_agent_list_pb2.RendererToAgentMessageList
    def __init__(self, messages: _Optional[_Union[_renderer_to_agent_list_pb2.RendererToAgentMessageList, _Mapping]] = ...) -> None: ...
