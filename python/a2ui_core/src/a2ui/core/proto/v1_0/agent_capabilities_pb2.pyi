from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentCapabilitiesV1(_message.Message):
    __slots__ = ("supported_catalog_ids", "accepts_inline_catalogs")
    SUPPORTED_CATALOG_IDS_FIELD_NUMBER: _ClassVar[int]
    ACCEPTS_INLINE_CATALOGS_FIELD_NUMBER: _ClassVar[int]
    supported_catalog_ids: _containers.RepeatedScalarFieldContainer[str]
    accepts_inline_catalogs: bool
    def __init__(
        self,
        supported_catalog_ids: _Optional[_Iterable[str]] = ...,
        accepts_inline_catalogs: _Optional[bool] = ...,
    ) -> None: ...

class AgentCapabilities(_message.Message):
    __slots__ = ("v1_0",)
    V1_0_FIELD_NUMBER: _ClassVar[int]
    v1_0: AgentCapabilitiesV1
    def __init__(
        self, v1_0: _Optional[_Union[AgentCapabilitiesV1, _Mapping]] = ...
    ) -> None: ...
