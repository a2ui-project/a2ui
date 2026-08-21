from . import common_types_pb2 as _common_types_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TextVariant(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TEXT_VARIANT_UNSPECIFIED: _ClassVar[TextVariant]
    TEXT_VARIANT_BODY: _ClassVar[TextVariant]
    TEXT_VARIANT_CAPTION: _ClassVar[TextVariant]

class ImageFit(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    IMAGE_FIT_UNSPECIFIED: _ClassVar[ImageFit]
    IMAGE_FIT_FILL: _ClassVar[ImageFit]
    IMAGE_FIT_CONTAIN: _ClassVar[ImageFit]
    IMAGE_FIT_COVER: _ClassVar[ImageFit]
    IMAGE_FIT_NONE: _ClassVar[ImageFit]
    IMAGE_FIT_SCALE_DOWN: _ClassVar[ImageFit]

class ImageVariant(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    IMAGE_VARIANT_UNSPECIFIED: _ClassVar[ImageVariant]
    IMAGE_VARIANT_MEDIUM_FEATURE: _ClassVar[ImageVariant]
    IMAGE_VARIANT_ICON: _ClassVar[ImageVariant]
    IMAGE_VARIANT_AVATAR: _ClassVar[ImageVariant]
    IMAGE_VARIANT_SMALL_FEATURE: _ClassVar[ImageVariant]
    IMAGE_VARIANT_LARGE_FEATURE: _ClassVar[ImageVariant]
    IMAGE_VARIANT_HEADER: _ClassVar[ImageVariant]

class StandardIcon(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    STANDARD_ICON_UNSPECIFIED: _ClassVar[StandardIcon]
    ICON_ACCOUNT_CIRCLE: _ClassVar[StandardIcon]
    ICON_ADD: _ClassVar[StandardIcon]
    ICON_ARROW_BACK: _ClassVar[StandardIcon]
    ICON_ARROW_FORWARD: _ClassVar[StandardIcon]
    ICON_ATTACH_FILE: _ClassVar[StandardIcon]
    ICON_CALENDAR_TODAY: _ClassVar[StandardIcon]
    ICON_CALL: _ClassVar[StandardIcon]
    ICON_CAMERA: _ClassVar[StandardIcon]
    ICON_CHECK: _ClassVar[StandardIcon]
    ICON_CLOSE: _ClassVar[StandardIcon]
    ICON_DELETE: _ClassVar[StandardIcon]
    ICON_DOWNLOAD: _ClassVar[StandardIcon]
    ICON_EDIT: _ClassVar[StandardIcon]
    ICON_EVENT: _ClassVar[StandardIcon]
    ICON_ERROR: _ClassVar[StandardIcon]
    ICON_FAST_FORWARD: _ClassVar[StandardIcon]
    ICON_FAVORITE: _ClassVar[StandardIcon]
    ICON_FAVORITE_OFF: _ClassVar[StandardIcon]
    ICON_FOLDER: _ClassVar[StandardIcon]
    ICON_HELP: _ClassVar[StandardIcon]
    ICON_HOME: _ClassVar[StandardIcon]
    ICON_INFO: _ClassVar[StandardIcon]
    ICON_LOCATION_ON: _ClassVar[StandardIcon]
    ICON_LOCK: _ClassVar[StandardIcon]
    ICON_LOCK_OPEN: _ClassVar[StandardIcon]
    ICON_MAIL: _ClassVar[StandardIcon]
    ICON_MENU: _ClassVar[StandardIcon]
    ICON_MORE_VERT: _ClassVar[StandardIcon]
    ICON_MORE_HORIZ: _ClassVar[StandardIcon]
    ICON_NOTIFICATIONS_OFF: _ClassVar[StandardIcon]
    ICON_NOTIFICATIONS: _ClassVar[StandardIcon]
    ICON_PAUSE: _ClassVar[StandardIcon]
    ICON_PAYMENT: _ClassVar[StandardIcon]
    ICON_PERSON: _ClassVar[StandardIcon]
    ICON_PHONE: _ClassVar[StandardIcon]
    ICON_PHOTO: _ClassVar[StandardIcon]
    ICON_PLAY: _ClassVar[StandardIcon]
    ICON_PRINT: _ClassVar[StandardIcon]
    ICON_REFRESH: _ClassVar[StandardIcon]
    ICON_REWIND: _ClassVar[StandardIcon]
    ICON_SEARCH: _ClassVar[StandardIcon]
    ICON_SEND: _ClassVar[StandardIcon]
    ICON_SETTINGS: _ClassVar[StandardIcon]
    ICON_SHARE: _ClassVar[StandardIcon]
    ICON_SHOPPING_CART: _ClassVar[StandardIcon]
    ICON_SKIP_NEXT: _ClassVar[StandardIcon]
    ICON_SKIP_PREVIOUS: _ClassVar[StandardIcon]
    ICON_STAR: _ClassVar[StandardIcon]
    ICON_STAR_HALF: _ClassVar[StandardIcon]
    ICON_STAR_OFF: _ClassVar[StandardIcon]
    ICON_STOP: _ClassVar[StandardIcon]
    ICON_UPLOAD: _ClassVar[StandardIcon]
    ICON_VISIBILITY: _ClassVar[StandardIcon]
    ICON_VISIBILITY_OFF: _ClassVar[StandardIcon]
    ICON_VOLUME_DOWN: _ClassVar[StandardIcon]
    ICON_VOLUME_MUTE: _ClassVar[StandardIcon]
    ICON_VOLUME_OFF: _ClassVar[StandardIcon]
    ICON_VOLUME_UP: _ClassVar[StandardIcon]
    ICON_WARNING: _ClassVar[StandardIcon]

class MainAxisAlignment(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MAIN_AXIS_ALIGNMENT_UNSPECIFIED: _ClassVar[MainAxisAlignment]
    MAIN_AXIS_ALIGNMENT_START: _ClassVar[MainAxisAlignment]
    MAIN_AXIS_ALIGNMENT_CENTER: _ClassVar[MainAxisAlignment]
    MAIN_AXIS_ALIGNMENT_END: _ClassVar[MainAxisAlignment]
    MAIN_AXIS_ALIGNMENT_SPACE_BETWEEN: _ClassVar[MainAxisAlignment]
    MAIN_AXIS_ALIGNMENT_SPACE_AROUND: _ClassVar[MainAxisAlignment]
    MAIN_AXIS_ALIGNMENT_SPACE_EVENLY: _ClassVar[MainAxisAlignment]
    MAIN_AXIS_ALIGNMENT_STRETCH: _ClassVar[MainAxisAlignment]

class CrossAxisAlignment(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CROSS_AXIS_ALIGNMENT_UNSPECIFIED: _ClassVar[CrossAxisAlignment]
    CROSS_AXIS_ALIGNMENT_STRETCH: _ClassVar[CrossAxisAlignment]
    CROSS_AXIS_ALIGNMENT_START: _ClassVar[CrossAxisAlignment]
    CROSS_AXIS_ALIGNMENT_CENTER: _ClassVar[CrossAxisAlignment]
    CROSS_AXIS_ALIGNMENT_END: _ClassVar[CrossAxisAlignment]

class ListDirection(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    LIST_DIRECTION_UNSPECIFIED: _ClassVar[ListDirection]
    LIST_DIRECTION_VERTICAL: _ClassVar[ListDirection]
    LIST_DIRECTION_HORIZONTAL: _ClassVar[ListDirection]

class DividerAxis(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DIVIDER_AXIS_UNSPECIFIED: _ClassVar[DividerAxis]
    DIVIDER_AXIS_HORIZONTAL: _ClassVar[DividerAxis]
    DIVIDER_AXIS_VERTICAL: _ClassVar[DividerAxis]

class ButtonVariant(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    BUTTON_VARIANT_UNSPECIFIED: _ClassVar[ButtonVariant]
    BUTTON_VARIANT_DEFAULT: _ClassVar[ButtonVariant]
    BUTTON_VARIANT_PRIMARY: _ClassVar[ButtonVariant]
    BUTTON_VARIANT_BORDERLESS: _ClassVar[ButtonVariant]

class TextFieldVariant(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TEXT_FIELD_VARIANT_UNSPECIFIED: _ClassVar[TextFieldVariant]
    TEXT_FIELD_VARIANT_SHORT_TEXT: _ClassVar[TextFieldVariant]
    TEXT_FIELD_VARIANT_LONG_TEXT: _ClassVar[TextFieldVariant]
    TEXT_FIELD_VARIANT_NUMBER: _ClassVar[TextFieldVariant]
    TEXT_FIELD_VARIANT_OBSCURED: _ClassVar[TextFieldVariant]

class ChoicePickerVariant(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CHOICE_PICKER_VARIANT_UNSPECIFIED: _ClassVar[ChoicePickerVariant]
    CHOICE_PICKER_VARIANT_MUTUALLY_EXCLUSIVE: _ClassVar[ChoicePickerVariant]
    CHOICE_PICKER_VARIANT_MULTIPLE_SELECTION: _ClassVar[ChoicePickerVariant]

class ChoicePickerDisplayStyle(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CHOICE_PICKER_DISPLAY_STYLE_UNSPECIFIED: _ClassVar[ChoicePickerDisplayStyle]
    CHOICE_PICKER_DISPLAY_STYLE_CHECKBOX: _ClassVar[ChoicePickerDisplayStyle]
    CHOICE_PICKER_DISPLAY_STYLE_CHIPS: _ClassVar[ChoicePickerDisplayStyle]

class BasicFunctionName(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    BASIC_FUNCTION_NAME_UNSPECIFIED: _ClassVar[BasicFunctionName]
    FUNCTION_REQUIRED: _ClassVar[BasicFunctionName]
    FUNCTION_REGEX: _ClassVar[BasicFunctionName]
    FUNCTION_LENGTH: _ClassVar[BasicFunctionName]
    FUNCTION_NUMERIC: _ClassVar[BasicFunctionName]
    FUNCTION_EMAIL: _ClassVar[BasicFunctionName]
    FUNCTION_FORMAT_STRING: _ClassVar[BasicFunctionName]
    FUNCTION_FORMAT_NUMBER: _ClassVar[BasicFunctionName]
    FUNCTION_FORMAT_CURRENCY: _ClassVar[BasicFunctionName]
    FUNCTION_FORMAT_DATE: _ClassVar[BasicFunctionName]
    FUNCTION_PLURALIZE: _ClassVar[BasicFunctionName]
    FUNCTION_OPEN_URL: _ClassVar[BasicFunctionName]
    FUNCTION_AND: _ClassVar[BasicFunctionName]
    FUNCTION_OR: _ClassVar[BasicFunctionName]
    FUNCTION_NOT: _ClassVar[BasicFunctionName]
TEXT_VARIANT_UNSPECIFIED: TextVariant
TEXT_VARIANT_BODY: TextVariant
TEXT_VARIANT_CAPTION: TextVariant
IMAGE_FIT_UNSPECIFIED: ImageFit
IMAGE_FIT_FILL: ImageFit
IMAGE_FIT_CONTAIN: ImageFit
IMAGE_FIT_COVER: ImageFit
IMAGE_FIT_NONE: ImageFit
IMAGE_FIT_SCALE_DOWN: ImageFit
IMAGE_VARIANT_UNSPECIFIED: ImageVariant
IMAGE_VARIANT_MEDIUM_FEATURE: ImageVariant
IMAGE_VARIANT_ICON: ImageVariant
IMAGE_VARIANT_AVATAR: ImageVariant
IMAGE_VARIANT_SMALL_FEATURE: ImageVariant
IMAGE_VARIANT_LARGE_FEATURE: ImageVariant
IMAGE_VARIANT_HEADER: ImageVariant
STANDARD_ICON_UNSPECIFIED: StandardIcon
ICON_ACCOUNT_CIRCLE: StandardIcon
ICON_ADD: StandardIcon
ICON_ARROW_BACK: StandardIcon
ICON_ARROW_FORWARD: StandardIcon
ICON_ATTACH_FILE: StandardIcon
ICON_CALENDAR_TODAY: StandardIcon
ICON_CALL: StandardIcon
ICON_CAMERA: StandardIcon
ICON_CHECK: StandardIcon
ICON_CLOSE: StandardIcon
ICON_DELETE: StandardIcon
ICON_DOWNLOAD: StandardIcon
ICON_EDIT: StandardIcon
ICON_EVENT: StandardIcon
ICON_ERROR: StandardIcon
ICON_FAST_FORWARD: StandardIcon
ICON_FAVORITE: StandardIcon
ICON_FAVORITE_OFF: StandardIcon
ICON_FOLDER: StandardIcon
ICON_HELP: StandardIcon
ICON_HOME: StandardIcon
ICON_INFO: StandardIcon
ICON_LOCATION_ON: StandardIcon
ICON_LOCK: StandardIcon
ICON_LOCK_OPEN: StandardIcon
ICON_MAIL: StandardIcon
ICON_MENU: StandardIcon
ICON_MORE_VERT: StandardIcon
ICON_MORE_HORIZ: StandardIcon
ICON_NOTIFICATIONS_OFF: StandardIcon
ICON_NOTIFICATIONS: StandardIcon
ICON_PAUSE: StandardIcon
ICON_PAYMENT: StandardIcon
ICON_PERSON: StandardIcon
ICON_PHONE: StandardIcon
ICON_PHOTO: StandardIcon
ICON_PLAY: StandardIcon
ICON_PRINT: StandardIcon
ICON_REFRESH: StandardIcon
ICON_REWIND: StandardIcon
ICON_SEARCH: StandardIcon
ICON_SEND: StandardIcon
ICON_SETTINGS: StandardIcon
ICON_SHARE: StandardIcon
ICON_SHOPPING_CART: StandardIcon
ICON_SKIP_NEXT: StandardIcon
ICON_SKIP_PREVIOUS: StandardIcon
ICON_STAR: StandardIcon
ICON_STAR_HALF: StandardIcon
ICON_STAR_OFF: StandardIcon
ICON_STOP: StandardIcon
ICON_UPLOAD: StandardIcon
ICON_VISIBILITY: StandardIcon
ICON_VISIBILITY_OFF: StandardIcon
ICON_VOLUME_DOWN: StandardIcon
ICON_VOLUME_MUTE: StandardIcon
ICON_VOLUME_OFF: StandardIcon
ICON_VOLUME_UP: StandardIcon
ICON_WARNING: StandardIcon
MAIN_AXIS_ALIGNMENT_UNSPECIFIED: MainAxisAlignment
MAIN_AXIS_ALIGNMENT_START: MainAxisAlignment
MAIN_AXIS_ALIGNMENT_CENTER: MainAxisAlignment
MAIN_AXIS_ALIGNMENT_END: MainAxisAlignment
MAIN_AXIS_ALIGNMENT_SPACE_BETWEEN: MainAxisAlignment
MAIN_AXIS_ALIGNMENT_SPACE_AROUND: MainAxisAlignment
MAIN_AXIS_ALIGNMENT_SPACE_EVENLY: MainAxisAlignment
MAIN_AXIS_ALIGNMENT_STRETCH: MainAxisAlignment
CROSS_AXIS_ALIGNMENT_UNSPECIFIED: CrossAxisAlignment
CROSS_AXIS_ALIGNMENT_STRETCH: CrossAxisAlignment
CROSS_AXIS_ALIGNMENT_START: CrossAxisAlignment
CROSS_AXIS_ALIGNMENT_CENTER: CrossAxisAlignment
CROSS_AXIS_ALIGNMENT_END: CrossAxisAlignment
LIST_DIRECTION_UNSPECIFIED: ListDirection
LIST_DIRECTION_VERTICAL: ListDirection
LIST_DIRECTION_HORIZONTAL: ListDirection
DIVIDER_AXIS_UNSPECIFIED: DividerAxis
DIVIDER_AXIS_HORIZONTAL: DividerAxis
DIVIDER_AXIS_VERTICAL: DividerAxis
BUTTON_VARIANT_UNSPECIFIED: ButtonVariant
BUTTON_VARIANT_DEFAULT: ButtonVariant
BUTTON_VARIANT_PRIMARY: ButtonVariant
BUTTON_VARIANT_BORDERLESS: ButtonVariant
TEXT_FIELD_VARIANT_UNSPECIFIED: TextFieldVariant
TEXT_FIELD_VARIANT_SHORT_TEXT: TextFieldVariant
TEXT_FIELD_VARIANT_LONG_TEXT: TextFieldVariant
TEXT_FIELD_VARIANT_NUMBER: TextFieldVariant
TEXT_FIELD_VARIANT_OBSCURED: TextFieldVariant
CHOICE_PICKER_VARIANT_UNSPECIFIED: ChoicePickerVariant
CHOICE_PICKER_VARIANT_MUTUALLY_EXCLUSIVE: ChoicePickerVariant
CHOICE_PICKER_VARIANT_MULTIPLE_SELECTION: ChoicePickerVariant
CHOICE_PICKER_DISPLAY_STYLE_UNSPECIFIED: ChoicePickerDisplayStyle
CHOICE_PICKER_DISPLAY_STYLE_CHECKBOX: ChoicePickerDisplayStyle
CHOICE_PICKER_DISPLAY_STYLE_CHIPS: ChoicePickerDisplayStyle
BASIC_FUNCTION_NAME_UNSPECIFIED: BasicFunctionName
FUNCTION_REQUIRED: BasicFunctionName
FUNCTION_REGEX: BasicFunctionName
FUNCTION_LENGTH: BasicFunctionName
FUNCTION_NUMERIC: BasicFunctionName
FUNCTION_EMAIL: BasicFunctionName
FUNCTION_FORMAT_STRING: BasicFunctionName
FUNCTION_FORMAT_NUMBER: BasicFunctionName
FUNCTION_FORMAT_CURRENCY: BasicFunctionName
FUNCTION_FORMAT_DATE: BasicFunctionName
FUNCTION_PLURALIZE: BasicFunctionName
FUNCTION_OPEN_URL: BasicFunctionName
FUNCTION_AND: BasicFunctionName
FUNCTION_OR: BasicFunctionName
FUNCTION_NOT: BasicFunctionName

class Text(_message.Message):
    __slots__ = ("text", "variant", "weight")
    TEXT_FIELD_NUMBER: _ClassVar[int]
    VARIANT_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    text: _common_types_pb2.DynamicString
    variant: TextVariant
    weight: float
    def __init__(self, text: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., variant: _Optional[_Union[TextVariant, str]] = ..., weight: _Optional[float] = ...) -> None: ...

class Image(_message.Message):
    __slots__ = ("url", "description", "fit", "variant", "weight")
    URL_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    FIT_FIELD_NUMBER: _ClassVar[int]
    VARIANT_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    url: _common_types_pb2.DynamicString
    description: _common_types_pb2.DynamicString
    fit: ImageFit
    variant: ImageVariant
    weight: float
    def __init__(self, url: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., description: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., fit: _Optional[_Union[ImageFit, str]] = ..., variant: _Optional[_Union[ImageVariant, str]] = ..., weight: _Optional[float] = ...) -> None: ...

class IconName(_message.Message):
    __slots__ = ("standard", "svg_path", "data_binding")
    STANDARD_FIELD_NUMBER: _ClassVar[int]
    SVG_PATH_FIELD_NUMBER: _ClassVar[int]
    DATA_BINDING_FIELD_NUMBER: _ClassVar[int]
    standard: StandardIcon
    svg_path: _common_types_pb2.DynamicString
    data_binding: _common_types_pb2.DataBinding
    def __init__(self, standard: _Optional[_Union[StandardIcon, str]] = ..., svg_path: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., data_binding: _Optional[_Union[_common_types_pb2.DataBinding, _Mapping]] = ...) -> None: ...

class Icon(_message.Message):
    __slots__ = ("name", "weight")
    NAME_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    name: IconName
    weight: float
    def __init__(self, name: _Optional[_Union[IconName, _Mapping]] = ..., weight: _Optional[float] = ...) -> None: ...

class Video(_message.Message):
    __slots__ = ("url", "poster_url", "weight")
    URL_FIELD_NUMBER: _ClassVar[int]
    POSTER_URL_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    url: _common_types_pb2.DynamicString
    poster_url: _common_types_pb2.DynamicString
    weight: float
    def __init__(self, url: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., poster_url: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., weight: _Optional[float] = ...) -> None: ...

class AudioPlayer(_message.Message):
    __slots__ = ("url", "description", "weight")
    URL_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    url: _common_types_pb2.DynamicString
    description: _common_types_pb2.DynamicString
    weight: float
    def __init__(self, url: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., description: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., weight: _Optional[float] = ...) -> None: ...

class Row(_message.Message):
    __slots__ = ("children", "justify", "align", "weight")
    CHILDREN_FIELD_NUMBER: _ClassVar[int]
    JUSTIFY_FIELD_NUMBER: _ClassVar[int]
    ALIGN_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    children: _common_types_pb2.ChildList
    justify: MainAxisAlignment
    align: CrossAxisAlignment
    weight: float
    def __init__(self, children: _Optional[_Union[_common_types_pb2.ChildList, _Mapping]] = ..., justify: _Optional[_Union[MainAxisAlignment, str]] = ..., align: _Optional[_Union[CrossAxisAlignment, str]] = ..., weight: _Optional[float] = ...) -> None: ...

class Column(_message.Message):
    __slots__ = ("children", "justify", "align", "weight")
    CHILDREN_FIELD_NUMBER: _ClassVar[int]
    JUSTIFY_FIELD_NUMBER: _ClassVar[int]
    ALIGN_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    children: _common_types_pb2.ChildList
    justify: MainAxisAlignment
    align: CrossAxisAlignment
    weight: float
    def __init__(self, children: _Optional[_Union[_common_types_pb2.ChildList, _Mapping]] = ..., justify: _Optional[_Union[MainAxisAlignment, str]] = ..., align: _Optional[_Union[CrossAxisAlignment, str]] = ..., weight: _Optional[float] = ...) -> None: ...

class List(_message.Message):
    __slots__ = ("children", "direction", "align", "weight")
    CHILDREN_FIELD_NUMBER: _ClassVar[int]
    DIRECTION_FIELD_NUMBER: _ClassVar[int]
    ALIGN_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    children: _common_types_pb2.ChildList
    direction: ListDirection
    align: CrossAxisAlignment
    weight: float
    def __init__(self, children: _Optional[_Union[_common_types_pb2.ChildList, _Mapping]] = ..., direction: _Optional[_Union[ListDirection, str]] = ..., align: _Optional[_Union[CrossAxisAlignment, str]] = ..., weight: _Optional[float] = ...) -> None: ...

class Card(_message.Message):
    __slots__ = ("child", "weight")
    CHILD_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    child: str
    weight: float
    def __init__(self, child: _Optional[str] = ..., weight: _Optional[float] = ...) -> None: ...

class Tab(_message.Message):
    __slots__ = ("title", "child")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CHILD_FIELD_NUMBER: _ClassVar[int]
    title: _common_types_pb2.DynamicString
    child: str
    def __init__(self, title: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., child: _Optional[str] = ...) -> None: ...

class Tabs(_message.Message):
    __slots__ = ("tabs", "weight")
    TABS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    tabs: _containers.RepeatedCompositeFieldContainer[Tab]
    weight: float
    def __init__(self, tabs: _Optional[_Iterable[_Union[Tab, _Mapping]]] = ..., weight: _Optional[float] = ...) -> None: ...

class Modal(_message.Message):
    __slots__ = ("trigger", "content", "weight")
    TRIGGER_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    trigger: str
    content: str
    weight: float
    def __init__(self, trigger: _Optional[str] = ..., content: _Optional[str] = ..., weight: _Optional[float] = ...) -> None: ...

class Divider(_message.Message):
    __slots__ = ("axis", "weight")
    AXIS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    axis: DividerAxis
    weight: float
    def __init__(self, axis: _Optional[_Union[DividerAxis, str]] = ..., weight: _Optional[float] = ...) -> None: ...

class Button(_message.Message):
    __slots__ = ("child", "variant", "action", "checks", "weight")
    CHILD_FIELD_NUMBER: _ClassVar[int]
    VARIANT_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    child: str
    variant: ButtonVariant
    action: _common_types_pb2.Action
    checks: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.CheckRule]
    weight: float
    def __init__(self, child: _Optional[str] = ..., variant: _Optional[_Union[ButtonVariant, str]] = ..., action: _Optional[_Union[_common_types_pb2.Action, _Mapping]] = ..., checks: _Optional[_Iterable[_Union[_common_types_pb2.CheckRule, _Mapping]]] = ..., weight: _Optional[float] = ...) -> None: ...

class TextField(_message.Message):
    __slots__ = ("label", "value", "placeholder", "variant", "checks", "weight")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    PLACEHOLDER_FIELD_NUMBER: _ClassVar[int]
    VARIANT_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    label: _common_types_pb2.DynamicString
    value: _common_types_pb2.DynamicString
    placeholder: _common_types_pb2.DynamicString
    variant: TextFieldVariant
    checks: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.CheckRule]
    weight: float
    def __init__(self, label: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., value: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., placeholder: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., variant: _Optional[_Union[TextFieldVariant, str]] = ..., checks: _Optional[_Iterable[_Union[_common_types_pb2.CheckRule, _Mapping]]] = ..., weight: _Optional[float] = ...) -> None: ...

class CheckBox(_message.Message):
    __slots__ = ("label", "value", "checks", "weight")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    label: _common_types_pb2.DynamicString
    value: _common_types_pb2.DynamicBoolean
    checks: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.CheckRule]
    weight: float
    def __init__(self, label: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., value: _Optional[_Union[_common_types_pb2.DynamicBoolean, _Mapping]] = ..., checks: _Optional[_Iterable[_Union[_common_types_pb2.CheckRule, _Mapping]]] = ..., weight: _Optional[float] = ...) -> None: ...

class ChoicePickerOption(_message.Message):
    __slots__ = ("label", "value")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    label: _common_types_pb2.DynamicString
    value: str
    def __init__(self, label: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., value: _Optional[str] = ...) -> None: ...

class ChoicePicker(_message.Message):
    __slots__ = ("label", "variant", "options", "value", "display_style", "filterable", "checks", "weight")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    VARIANT_FIELD_NUMBER: _ClassVar[int]
    OPTIONS_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_STYLE_FIELD_NUMBER: _ClassVar[int]
    FILTERABLE_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    label: _common_types_pb2.DynamicString
    variant: ChoicePickerVariant
    options: _containers.RepeatedCompositeFieldContainer[ChoicePickerOption]
    value: _common_types_pb2.DynamicStringList
    display_style: ChoicePickerDisplayStyle
    filterable: bool
    checks: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.CheckRule]
    weight: float
    def __init__(self, label: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., variant: _Optional[_Union[ChoicePickerVariant, str]] = ..., options: _Optional[_Iterable[_Union[ChoicePickerOption, _Mapping]]] = ..., value: _Optional[_Union[_common_types_pb2.DynamicStringList, _Mapping]] = ..., display_style: _Optional[_Union[ChoicePickerDisplayStyle, str]] = ..., filterable: _Optional[bool] = ..., checks: _Optional[_Iterable[_Union[_common_types_pb2.CheckRule, _Mapping]]] = ..., weight: _Optional[float] = ...) -> None: ...

class Slider(_message.Message):
    __slots__ = ("label", "min", "max", "value", "steps", "checks", "weight")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    MIN_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    label: _common_types_pb2.DynamicString
    min: float
    max: float
    value: _common_types_pb2.DynamicNumber
    steps: int
    checks: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.CheckRule]
    weight: float
    def __init__(self, label: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., min: _Optional[float] = ..., max: _Optional[float] = ..., value: _Optional[_Union[_common_types_pb2.DynamicNumber, _Mapping]] = ..., steps: _Optional[int] = ..., checks: _Optional[_Iterable[_Union[_common_types_pb2.CheckRule, _Mapping]]] = ..., weight: _Optional[float] = ...) -> None: ...

class DateTimeInput(_message.Message):
    __slots__ = ("value", "enable_date", "enable_time", "min", "max", "label", "checks", "weight")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    ENABLE_DATE_FIELD_NUMBER: _ClassVar[int]
    ENABLE_TIME_FIELD_NUMBER: _ClassVar[int]
    MIN_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicString
    enable_date: bool
    enable_time: bool
    min: _common_types_pb2.DynamicString
    max: _common_types_pb2.DynamicString
    label: _common_types_pb2.DynamicString
    checks: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.CheckRule]
    weight: float
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., enable_date: _Optional[bool] = ..., enable_time: _Optional[bool] = ..., min: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., max: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., label: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., checks: _Optional[_Iterable[_Union[_common_types_pb2.CheckRule, _Mapping]]] = ..., weight: _Optional[float] = ...) -> None: ...

class BasicComponent(_message.Message):
    __slots__ = ("id", "catalog_id", "accessibility", "metadata", "text", "image", "icon", "video", "audio_player", "row", "column", "list", "card", "tabs", "modal", "divider", "button", "text_field", "check_box", "choice_picker", "slider", "date_time_input")
    ID_FIELD_NUMBER: _ClassVar[int]
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESSIBILITY_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    VIDEO_FIELD_NUMBER: _ClassVar[int]
    AUDIO_PLAYER_FIELD_NUMBER: _ClassVar[int]
    ROW_FIELD_NUMBER: _ClassVar[int]
    COLUMN_FIELD_NUMBER: _ClassVar[int]
    LIST_FIELD_NUMBER: _ClassVar[int]
    CARD_FIELD_NUMBER: _ClassVar[int]
    TABS_FIELD_NUMBER: _ClassVar[int]
    MODAL_FIELD_NUMBER: _ClassVar[int]
    DIVIDER_FIELD_NUMBER: _ClassVar[int]
    BUTTON_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_FIELD_NUMBER: _ClassVar[int]
    CHECK_BOX_FIELD_NUMBER: _ClassVar[int]
    CHOICE_PICKER_FIELD_NUMBER: _ClassVar[int]
    SLIDER_FIELD_NUMBER: _ClassVar[int]
    DATE_TIME_INPUT_FIELD_NUMBER: _ClassVar[int]
    id: str
    catalog_id: str
    accessibility: _common_types_pb2.AccessibilityAttributes
    metadata: _common_types_pb2.ComponentMetadata
    text: Text
    image: Image
    icon: Icon
    video: Video
    audio_player: AudioPlayer
    row: Row
    column: Column
    list: List
    card: Card
    tabs: Tabs
    modal: Modal
    divider: Divider
    button: Button
    text_field: TextField
    check_box: CheckBox
    choice_picker: ChoicePicker
    slider: Slider
    date_time_input: DateTimeInput
    def __init__(self, id: _Optional[str] = ..., catalog_id: _Optional[str] = ..., accessibility: _Optional[_Union[_common_types_pb2.AccessibilityAttributes, _Mapping]] = ..., metadata: _Optional[_Union[_common_types_pb2.ComponentMetadata, _Mapping]] = ..., text: _Optional[_Union[Text, _Mapping]] = ..., image: _Optional[_Union[Image, _Mapping]] = ..., icon: _Optional[_Union[Icon, _Mapping]] = ..., video: _Optional[_Union[Video, _Mapping]] = ..., audio_player: _Optional[_Union[AudioPlayer, _Mapping]] = ..., row: _Optional[_Union[Row, _Mapping]] = ..., column: _Optional[_Union[Column, _Mapping]] = ..., list: _Optional[_Union[List, _Mapping]] = ..., card: _Optional[_Union[Card, _Mapping]] = ..., tabs: _Optional[_Union[Tabs, _Mapping]] = ..., modal: _Optional[_Union[Modal, _Mapping]] = ..., divider: _Optional[_Union[Divider, _Mapping]] = ..., button: _Optional[_Union[Button, _Mapping]] = ..., text_field: _Optional[_Union[TextField, _Mapping]] = ..., check_box: _Optional[_Union[CheckBox, _Mapping]] = ..., choice_picker: _Optional[_Union[ChoicePicker, _Mapping]] = ..., slider: _Optional[_Union[Slider, _Mapping]] = ..., date_time_input: _Optional[_Union[DateTimeInput, _Mapping]] = ...) -> None: ...

class RequiredArgs(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicValue
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicValue, _Mapping]] = ...) -> None: ...

class RegexArgs(_message.Message):
    __slots__ = ("value", "pattern")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    PATTERN_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicString
    pattern: str
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., pattern: _Optional[str] = ...) -> None: ...

class LengthArgs(_message.Message):
    __slots__ = ("value", "min", "max")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    MIN_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicString
    min: int
    max: int
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., min: _Optional[int] = ..., max: _Optional[int] = ...) -> None: ...

class NumericArgs(_message.Message):
    __slots__ = ("value", "min", "max")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    MIN_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicNumber
    min: float
    max: float
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicNumber, _Mapping]] = ..., min: _Optional[float] = ..., max: _Optional[float] = ...) -> None: ...

class EmailArgs(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicString
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ...) -> None: ...

class FormatStringArgs(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicString
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ...) -> None: ...

class FormatNumberArgs(_message.Message):
    __slots__ = ("value", "decimals", "grouping")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    DECIMALS_FIELD_NUMBER: _ClassVar[int]
    GROUPING_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicNumber
    decimals: _common_types_pb2.DynamicNumber
    grouping: _common_types_pb2.DynamicBoolean
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicNumber, _Mapping]] = ..., decimals: _Optional[_Union[_common_types_pb2.DynamicNumber, _Mapping]] = ..., grouping: _Optional[_Union[_common_types_pb2.DynamicBoolean, _Mapping]] = ...) -> None: ...

class FormatCurrencyArgs(_message.Message):
    __slots__ = ("value", "currency", "decimals", "grouping")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    DECIMALS_FIELD_NUMBER: _ClassVar[int]
    GROUPING_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicNumber
    currency: _common_types_pb2.DynamicString
    decimals: _common_types_pb2.DynamicNumber
    grouping: _common_types_pb2.DynamicBoolean
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicNumber, _Mapping]] = ..., currency: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., decimals: _Optional[_Union[_common_types_pb2.DynamicNumber, _Mapping]] = ..., grouping: _Optional[_Union[_common_types_pb2.DynamicBoolean, _Mapping]] = ...) -> None: ...

class FormatDateArgs(_message.Message):
    __slots__ = ("value", "format")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicValue
    format: _common_types_pb2.DynamicString
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicValue, _Mapping]] = ..., format: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ...) -> None: ...

class PluralizeArgs(_message.Message):
    __slots__ = ("value", "other", "zero", "one", "two", "few", "many")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    OTHER_FIELD_NUMBER: _ClassVar[int]
    ZERO_FIELD_NUMBER: _ClassVar[int]
    ONE_FIELD_NUMBER: _ClassVar[int]
    TWO_FIELD_NUMBER: _ClassVar[int]
    FEW_FIELD_NUMBER: _ClassVar[int]
    MANY_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicNumber
    other: _common_types_pb2.DynamicString
    zero: _common_types_pb2.DynamicString
    one: _common_types_pb2.DynamicString
    two: _common_types_pb2.DynamicString
    few: _common_types_pb2.DynamicString
    many: _common_types_pb2.DynamicString
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicNumber, _Mapping]] = ..., other: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., zero: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., one: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., two: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., few: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ..., many: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ...) -> None: ...

class OpenUrlArgs(_message.Message):
    __slots__ = ("url",)
    URL_FIELD_NUMBER: _ClassVar[int]
    url: _common_types_pb2.DynamicString
    def __init__(self, url: _Optional[_Union[_common_types_pb2.DynamicString, _Mapping]] = ...) -> None: ...

class AndArgs(_message.Message):
    __slots__ = ("values",)
    VALUES_FIELD_NUMBER: _ClassVar[int]
    values: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.DynamicBoolean]
    def __init__(self, values: _Optional[_Iterable[_Union[_common_types_pb2.DynamicBoolean, _Mapping]]] = ...) -> None: ...

class OrArgs(_message.Message):
    __slots__ = ("values",)
    VALUES_FIELD_NUMBER: _ClassVar[int]
    values: _containers.RepeatedCompositeFieldContainer[_common_types_pb2.DynamicBoolean]
    def __init__(self, values: _Optional[_Iterable[_Union[_common_types_pb2.DynamicBoolean, _Mapping]]] = ...) -> None: ...

class NotArgs(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: _common_types_pb2.DynamicBoolean
    def __init__(self, value: _Optional[_Union[_common_types_pb2.DynamicBoolean, _Mapping]] = ...) -> None: ...

class BasicFunctionCall(_message.Message):
    __slots__ = ("catalog_id", "required", "regex", "length", "numeric", "email", "format_string", "format_number", "format_currency", "format_date", "pluralize", "open_url")
    CATALOG_ID_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_FIELD_NUMBER: _ClassVar[int]
    REGEX_FIELD_NUMBER: _ClassVar[int]
    LENGTH_FIELD_NUMBER: _ClassVar[int]
    NUMERIC_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FORMAT_STRING_FIELD_NUMBER: _ClassVar[int]
    FORMAT_NUMBER_FIELD_NUMBER: _ClassVar[int]
    FORMAT_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    FORMAT_DATE_FIELD_NUMBER: _ClassVar[int]
    PLURALIZE_FIELD_NUMBER: _ClassVar[int]
    OPEN_URL_FIELD_NUMBER: _ClassVar[int]
    AND_FIELD_NUMBER: _ClassVar[int]
    OR_FIELD_NUMBER: _ClassVar[int]
    NOT_FIELD_NUMBER: _ClassVar[int]
    catalog_id: str
    required: RequiredArgs
    regex: RegexArgs
    length: LengthArgs
    numeric: NumericArgs
    email: EmailArgs
    format_string: FormatStringArgs
    format_number: FormatNumberArgs
    format_currency: FormatCurrencyArgs
    format_date: FormatDateArgs
    pluralize: PluralizeArgs
    open_url: OpenUrlArgs
    def __init__(self, catalog_id: _Optional[str] = ..., required: _Optional[_Union[RequiredArgs, _Mapping]] = ..., regex: _Optional[_Union[RegexArgs, _Mapping]] = ..., length: _Optional[_Union[LengthArgs, _Mapping]] = ..., numeric: _Optional[_Union[NumericArgs, _Mapping]] = ..., email: _Optional[_Union[EmailArgs, _Mapping]] = ..., format_string: _Optional[_Union[FormatStringArgs, _Mapping]] = ..., format_number: _Optional[_Union[FormatNumberArgs, _Mapping]] = ..., format_currency: _Optional[_Union[FormatCurrencyArgs, _Mapping]] = ..., format_date: _Optional[_Union[FormatDateArgs, _Mapping]] = ..., pluralize: _Optional[_Union[PluralizeArgs, _Mapping]] = ..., open_url: _Optional[_Union[OpenUrlArgs, _Mapping]] = ..., **kwargs) -> None: ...
