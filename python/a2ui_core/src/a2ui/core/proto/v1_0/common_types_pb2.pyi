from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LiveMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    LIVE_MODE_UNSPECIFIED: _ClassVar[LiveMode]
    LIVE_MODE_OFF: _ClassVar[LiveMode]
    LIVE_MODE_POLITE: _ClassVar[LiveMode]
    LIVE_MODE_ASSERTIVE: _ClassVar[LiveMode]
LIVE_MODE_UNSPECIFIED: LiveMode
LIVE_MODE_OFF: LiveMode
LIVE_MODE_POLITE: LiveMode
LIVE_MODE_ASSERTIVE: LiveMode

class AccessibilityAttributes(_message.Message):
    __slots__ = ("label", "description", "live", "hidden")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    LIVE_FIELD_NUMBER: _ClassVar[int]
    HIDDEN_FIELD_NUMBER: _ClassVar[int]
    label: DynamicString
    description: DynamicString
    live: LiveMode
    hidden: DynamicBoolean
    def __init__(self, label: _Optional[_Union[DynamicString, _Mapping]] = ..., description: _Optional[_Union[DynamicString, _Mapping]] = ..., live: _Optional[_Union[LiveMode, str]] = ..., hidden: _Optional[_Union[DynamicBoolean, _Mapping]] = ...) -> None: ...

class Extensions(_message.Message):
    __slots__ = ("fields",)
    class FieldsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _struct_pb2.Value
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_struct_pb2.Value, _Mapping]] = ...) -> None: ...
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    fields: _containers.MessageMap[str, _struct_pb2.Value]
    def __init__(self, fields: _Optional[_Mapping[str, _struct_pb2.Value]] = ...) -> None: ...

class ComponentMetadata(_message.Message):
    __slots__ = ("extensions",)
    EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    extensions: Extensions
    def __init__(self, extensions: _Optional[_Union[Extensions, _Mapping]] = ...) -> None: ...

class ComponentCommon(_message.Message):
    __slots__ = ("id", "catalog_id", "accessibility", "metadata")
    ID_FIELD_NUMBER: _ClassVar[int]
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESSIBILITY_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    id: str
    catalog_id: str
    accessibility: AccessibilityAttributes
    metadata: ComponentMetadata
    def __init__(self, id: _Optional[str] = ..., catalog_id: _Optional[str] = ..., accessibility: _Optional[_Union[AccessibilityAttributes, _Mapping]] = ..., metadata: _Optional[_Union[ComponentMetadata, _Mapping]] = ...) -> None: ...

class StaticChildList(_message.Message):
    __slots__ = ("component_ids",)
    COMPONENT_IDS_FIELD_NUMBER: _ClassVar[int]
    component_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, component_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ChildListTemplate(_message.Message):
    __slots__ = ("component_id", "path")
    COMPONENT_ID_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    component_id: str
    path: str
    def __init__(self, component_id: _Optional[str] = ..., path: _Optional[str] = ...) -> None: ...

class ChildList(_message.Message):
    __slots__ = ("static_list", "template")
    STATIC_LIST_FIELD_NUMBER: _ClassVar[int]
    TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    static_list: StaticChildList
    template: ChildListTemplate
    def __init__(self, static_list: _Optional[_Union[StaticChildList, _Mapping]] = ..., template: _Optional[_Union[ChildListTemplate, _Mapping]] = ...) -> None: ...

class DataBinding(_message.Message):
    __slots__ = ("path",)
    PATH_FIELD_NUMBER: _ClassVar[int]
    path: str
    def __init__(self, path: _Optional[str] = ...) -> None: ...

class DynamicValue(_message.Message):
    __slots__ = ("literal_string", "literal_number", "literal_boolean", "literal_list", "literal_object", "data_binding", "function_call")
    LITERAL_STRING_FIELD_NUMBER: _ClassVar[int]
    LITERAL_NUMBER_FIELD_NUMBER: _ClassVar[int]
    LITERAL_BOOLEAN_FIELD_NUMBER: _ClassVar[int]
    LITERAL_LIST_FIELD_NUMBER: _ClassVar[int]
    LITERAL_OBJECT_FIELD_NUMBER: _ClassVar[int]
    DATA_BINDING_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_FIELD_NUMBER: _ClassVar[int]
    literal_string: str
    literal_number: float
    literal_boolean: bool
    literal_list: _struct_pb2.ListValue
    literal_object: _struct_pb2.Struct
    data_binding: DataBinding
    function_call: FunctionCall
    def __init__(self, literal_string: _Optional[str] = ..., literal_number: _Optional[float] = ..., literal_boolean: _Optional[bool] = ..., literal_list: _Optional[_Union[_struct_pb2.ListValue, _Mapping]] = ..., literal_object: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., data_binding: _Optional[_Union[DataBinding, _Mapping]] = ..., function_call: _Optional[_Union[FunctionCall, _Mapping]] = ...) -> None: ...

class DynamicString(_message.Message):
    __slots__ = ("literal_string", "data_binding", "function_call")
    LITERAL_STRING_FIELD_NUMBER: _ClassVar[int]
    DATA_BINDING_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_FIELD_NUMBER: _ClassVar[int]
    literal_string: str
    data_binding: DataBinding
    function_call: FunctionCall
    def __init__(self, literal_string: _Optional[str] = ..., data_binding: _Optional[_Union[DataBinding, _Mapping]] = ..., function_call: _Optional[_Union[FunctionCall, _Mapping]] = ...) -> None: ...

class DynamicNumber(_message.Message):
    __slots__ = ("literal_number", "data_binding", "function_call")
    LITERAL_NUMBER_FIELD_NUMBER: _ClassVar[int]
    DATA_BINDING_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_FIELD_NUMBER: _ClassVar[int]
    literal_number: float
    data_binding: DataBinding
    function_call: FunctionCall
    def __init__(self, literal_number: _Optional[float] = ..., data_binding: _Optional[_Union[DataBinding, _Mapping]] = ..., function_call: _Optional[_Union[FunctionCall, _Mapping]] = ...) -> None: ...

class DynamicBoolean(_message.Message):
    __slots__ = ("literal_boolean", "data_binding", "function_call")
    LITERAL_BOOLEAN_FIELD_NUMBER: _ClassVar[int]
    DATA_BINDING_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_FIELD_NUMBER: _ClassVar[int]
    literal_boolean: bool
    data_binding: DataBinding
    function_call: FunctionCall
    def __init__(self, literal_boolean: _Optional[bool] = ..., data_binding: _Optional[_Union[DataBinding, _Mapping]] = ..., function_call: _Optional[_Union[FunctionCall, _Mapping]] = ...) -> None: ...

class StringList(_message.Message):
    __slots__ = ("values",)
    VALUES_FIELD_NUMBER: _ClassVar[int]
    values: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, values: _Optional[_Iterable[str]] = ...) -> None: ...

class DynamicStringList(_message.Message):
    __slots__ = ("literal_string_list", "data_binding", "function_call")
    LITERAL_STRING_LIST_FIELD_NUMBER: _ClassVar[int]
    DATA_BINDING_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_FIELD_NUMBER: _ClassVar[int]
    literal_string_list: StringList
    data_binding: DataBinding
    function_call: FunctionCall
    def __init__(self, literal_string_list: _Optional[_Union[StringList, _Mapping]] = ..., data_binding: _Optional[_Union[DataBinding, _Mapping]] = ..., function_call: _Optional[_Union[FunctionCall, _Mapping]] = ...) -> None: ...

class FunctionCommon(_message.Message):
    __slots__ = ("catalog_id",)
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    catalog_id: str
    def __init__(self, catalog_id: _Optional[str] = ...) -> None: ...

class FunctionCall(_message.Message):
    __slots__ = ("call", "catalog_id", "args")
    class ArgsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DynamicValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[DynamicValue, _Mapping]] = ...) -> None: ...
    CALL_FIELD_NUMBER: _ClassVar[int]
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    call: str
    catalog_id: str
    args: _containers.MessageMap[str, DynamicValue]
    def __init__(self, call: _Optional[str] = ..., catalog_id: _Optional[str] = ..., args: _Optional[_Mapping[str, DynamicValue]] = ...) -> None: ...

class IndexSystemFunctionArguments(_message.Message):
    __slots__ = ("offset",)
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    offset: DynamicNumber
    def __init__(self, offset: _Optional[_Union[DynamicNumber, _Mapping]] = ...) -> None: ...

class CheckRule(_message.Message):
    __slots__ = ("data_binding", "function_call", "message")
    DATA_BINDING_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    data_binding: DataBinding
    function_call: FunctionCall
    message: str
    def __init__(self, data_binding: _Optional[_Union[DataBinding, _Mapping]] = ..., function_call: _Optional[_Union[FunctionCall, _Mapping]] = ..., message: _Optional[str] = ...) -> None: ...

class Checkable(_message.Message):
    __slots__ = ("checks",)
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    checks: _containers.RepeatedCompositeFieldContainer[CheckRule]
    def __init__(self, checks: _Optional[_Iterable[_Union[CheckRule, _Mapping]]] = ...) -> None: ...

class EventAction(_message.Message):
    __slots__ = ("name", "user_message", "context")
    class ContextEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DynamicValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[DynamicValue, _Mapping]] = ...) -> None: ...
    NAME_FIELD_NUMBER: _ClassVar[int]
    USER_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    name: str
    user_message: DynamicString
    context: _containers.MessageMap[str, DynamicValue]
    def __init__(self, name: _Optional[str] = ..., user_message: _Optional[_Union[DynamicString, _Mapping]] = ..., context: _Optional[_Mapping[str, DynamicValue]] = ...) -> None: ...

class Action(_message.Message):
    __slots__ = ("event", "function_call")
    EVENT_FIELD_NUMBER: _ClassVar[int]
    FUNCTION_CALL_FIELD_NUMBER: _ClassVar[int]
    event: EventAction
    function_call: FunctionCall
    def __init__(self, event: _Optional[_Union[EventAction, _Mapping]] = ..., function_call: _Optional[_Union[FunctionCall, _Mapping]] = ...) -> None: ...

class SurfaceContainer(_message.Message):
    __slots__ = ("component", "child")
    COMPONENT_FIELD_NUMBER: _ClassVar[int]
    CHILD_FIELD_NUMBER: _ClassVar[int]
    component: str
    child: str
    def __init__(self, component: _Optional[str] = ..., child: _Optional[str] = ...) -> None: ...

class FunctionError(_message.Message):
    __slots__ = ("code", "message")
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    code: str
    message: str
    def __init__(self, code: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...

class FunctionResponse(_message.Message):
    __slots__ = ("function_call_id", "value", "error")
    FUNCTION_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    function_call_id: str
    value: _struct_pb2.Value
    error: FunctionError
    def __init__(self, function_call_id: _Optional[str] = ..., value: _Optional[_Union[_struct_pb2.Value, _Mapping]] = ..., error: _Optional[_Union[FunctionError, _Mapping]] = ...) -> None: ...
