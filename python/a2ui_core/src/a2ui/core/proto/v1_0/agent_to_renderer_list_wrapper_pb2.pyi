from . import agent_to_renderer_list_pb2 as _agent_to_renderer_list_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentToRendererListWrapper(_message.Message):
    __slots__ = ("messages",)
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    messages: _agent_to_renderer_list_pb2.AgentToRendererMessageList
    def __init__(
        self,
        messages: _Optional[
            _Union[_agent_to_renderer_list_pb2.AgentToRendererMessageList, _Mapping]
        ] = ...,
    ) -> None: ...
