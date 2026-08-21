from . import common_types_pb2 as _common_types_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ReturnType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RETURN_TYPE_UNSPECIFIED: _ClassVar[ReturnType]
    RETURN_TYPE_STRING: _ClassVar[ReturnType]
    RETURN_TYPE_NUMBER: _ClassVar[ReturnType]
    RETURN_TYPE_BOOLEAN: _ClassVar[ReturnType]
    RETURN_TYPE_ARRAY: _ClassVar[ReturnType]
    RETURN_TYPE_OBJECT: _ClassVar[ReturnType]
    RETURN_TYPE_VALIDATION_RESULT: _ClassVar[ReturnType]
    RETURN_TYPE_ANY: _ClassVar[ReturnType]
    RETURN_TYPE_VOID: _ClassVar[ReturnType]

class AllowedCallers(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ALLOWED_CALLERS_UNSPECIFIED: _ClassVar[AllowedCallers]
    ALLOWED_CALLERS_RENDERER_ONLY: _ClassVar[AllowedCallers]
    ALLOWED_CALLERS_AGENT_ONLY: _ClassVar[AllowedCallers]
    ALLOWED_CALLERS_RENDERER_OR_AGENT: _ClassVar[AllowedCallers]

class ValidationSeverity(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VALIDATION_SEVERITY_UNSPECIFIED: _ClassVar[ValidationSeverity]
    VALIDATION_SEVERITY_ERROR: _ClassVar[ValidationSeverity]
    VALIDATION_SEVERITY_WARNING: _ClassVar[ValidationSeverity]
    VALIDATION_SEVERITY_INFO: _ClassVar[ValidationSeverity]

RETURN_TYPE_UNSPECIFIED: ReturnType
RETURN_TYPE_STRING: ReturnType
RETURN_TYPE_NUMBER: ReturnType
RETURN_TYPE_BOOLEAN: ReturnType
RETURN_TYPE_ARRAY: ReturnType
RETURN_TYPE_OBJECT: ReturnType
RETURN_TYPE_VALIDATION_RESULT: ReturnType
RETURN_TYPE_ANY: ReturnType
RETURN_TYPE_VOID: ReturnType
ALLOWED_CALLERS_UNSPECIFIED: AllowedCallers
ALLOWED_CALLERS_RENDERER_ONLY: AllowedCallers
ALLOWED_CALLERS_AGENT_ONLY: AllowedCallers
ALLOWED_CALLERS_RENDERER_OR_AGENT: AllowedCallers
VALIDATION_SEVERITY_UNSPECIFIED: ValidationSeverity
VALIDATION_SEVERITY_ERROR: ValidationSeverity
VALIDATION_SEVERITY_WARNING: ValidationSeverity
VALIDATION_SEVERITY_INFO: ValidationSeverity

class ComponentDefinitionMetadata(_message.Message):
    __slots__ = ("extensions",)
    EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    extensions: _common_types_pb2.Extensions
    def __init__(
        self,
        extensions: _Optional[_Union[_common_types_pb2.Extensions, _Mapping]] = ...,
    ) -> None: ...

class ComponentDefinition(_message.Message):
    __slots__ = ("allowed_parents", "allowed_children", "metadata", "schema")
    ALLOWED_PARENTS_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_CHILDREN_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    allowed_parents: _containers.RepeatedScalarFieldContainer[str]
    allowed_children: _containers.RepeatedScalarFieldContainer[str]
    metadata: ComponentDefinitionMetadata
    schema: _struct_pb2.Struct
    def __init__(
        self,
        allowed_parents: _Optional[_Iterable[str]] = ...,
        allowed_children: _Optional[_Iterable[str]] = ...,
        metadata: _Optional[_Union[ComponentDefinitionMetadata, _Mapping]] = ...,
        schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
    ) -> None: ...

class FunctionDefinition(_message.Message):
    __slots__ = (
        "description",
        "return_type",
        "allowed_callers",
        "requires_user_activation",
        "args_schema",
    )
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    RETURN_TYPE_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_CALLERS_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_USER_ACTIVATION_FIELD_NUMBER: _ClassVar[int]
    ARGS_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    description: str
    return_type: ReturnType
    allowed_callers: AllowedCallers
    requires_user_activation: bool
    args_schema: _struct_pb2.Struct
    def __init__(
        self,
        description: _Optional[str] = ...,
        return_type: _Optional[_Union[ReturnType, str]] = ...,
        allowed_callers: _Optional[_Union[AllowedCallers, str]] = ...,
        requires_user_activation: _Optional[bool] = ...,
        args_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
    ) -> None: ...

class ValidationResult(_message.Message):
    __slots__ = ("valid", "code", "message", "severity")
    VALID_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    SEVERITY_FIELD_NUMBER: _ClassVar[int]
    valid: bool
    code: str
    message: str
    severity: ValidationSeverity
    def __init__(
        self,
        valid: _Optional[bool] = ...,
        code: _Optional[str] = ...,
        message: _Optional[str] = ...,
        severity: _Optional[_Union[ValidationSeverity, str]] = ...,
    ) -> None: ...

class CatalogDefinition(_message.Message):
    __slots__ = (
        "schema",
        "id",
        "protocol_version",
        "title",
        "description",
        "catalog_id",
        "instructions",
        "components",
        "functions",
    )

    class ComponentsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: ComponentDefinition
        def __init__(
            self,
            key: _Optional[str] = ...,
            value: _Optional[_Union[ComponentDefinition, _Mapping]] = ...,
        ) -> None: ...

    class FunctionsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: FunctionDefinition
        def __init__(
            self,
            key: _Optional[str] = ...,
            value: _Optional[_Union[FunctionDefinition, _Mapping]] = ...,
        ) -> None: ...

    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_VERSION_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    COMPONENTS_FIELD_NUMBER: _ClassVar[int]
    FUNCTIONS_FIELD_NUMBER: _ClassVar[int]
    schema: str
    id: str
    protocol_version: str
    title: str
    description: str
    catalog_id: str
    instructions: str
    components: _containers.MessageMap[str, ComponentDefinition]
    functions: _containers.MessageMap[str, FunctionDefinition]
    def __init__(
        self,
        schema: _Optional[str] = ...,
        id: _Optional[str] = ...,
        protocol_version: _Optional[str] = ...,
        title: _Optional[str] = ...,
        description: _Optional[str] = ...,
        catalog_id: _Optional[str] = ...,
        instructions: _Optional[str] = ...,
        components: _Optional[_Mapping[str, ComponentDefinition]] = ...,
        functions: _Optional[_Mapping[str, FunctionDefinition]] = ...,
    ) -> None: ...
