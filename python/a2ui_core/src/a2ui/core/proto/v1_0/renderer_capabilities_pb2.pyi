from . import catalog_definition_pb2 as _catalog_definition_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RendererCapabilitiesV1(_message.Message):
    __slots__ = ("supported_catalog_ids", "inline_catalogs")
    SUPPORTED_CATALOG_IDS_FIELD_NUMBER: _ClassVar[int]
    INLINE_CATALOGS_FIELD_NUMBER: _ClassVar[int]
    supported_catalog_ids: _containers.RepeatedScalarFieldContainer[str]
    inline_catalogs: _containers.RepeatedCompositeFieldContainer[_catalog_definition_pb2.CatalogDefinition]
    def __init__(self, supported_catalog_ids: _Optional[_Iterable[str]] = ..., inline_catalogs: _Optional[_Iterable[_Union[_catalog_definition_pb2.CatalogDefinition, _Mapping]]] = ...) -> None: ...

class RendererCapabilities(_message.Message):
    __slots__ = ("v1_0",)
    V1_0_FIELD_NUMBER: _ClassVar[int]
    v1_0: RendererCapabilitiesV1
    def __init__(self, v1_0: _Optional[_Union[RendererCapabilitiesV1, _Mapping]] = ...) -> None: ...
