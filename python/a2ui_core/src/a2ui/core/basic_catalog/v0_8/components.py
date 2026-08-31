# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Auto-generated. Do not edit manually.
from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional, Union, Annotated
from pydantic import BaseModel, Field, ConfigDict
from ...schema.common_types import (
    Child,
    ChildList,
    ComponentCommon,
    ComponentId,
    ComponentReference,
    DataBinding,
    DynamicBoolean,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    FunctionCall,
    ListReference,
    SingleReference,
    StrictBaseModel,
    TemplateChildList,
)
from ...catalog.components import ModelComponentApi


class TextItem(StrictBaseModel):
    """The value of the text field. This can be a literal string or a reference to a value in the data model ('path', e.g. '/user/name')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_string: str | None = Field(None, alias="literalString")
    path: str | None = Field(None)


class UrlItem(StrictBaseModel):
    """The URL of the audio to be played. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/song/url')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_string: str | None = Field(None, alias="literalString")
    path: str | None = Field(None)


class AltTextItem(StrictBaseModel):
    """The alt text for the image. This can be a literal string ('literal') or a reference to a value in the data model ('path', e.g. '/thumbnail/altText')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_string: str | None = Field(None, alias="literalString")
    path: str | None = Field(None)


class NameItem(StrictBaseModel):
    """The name of the icon to display. This can be a literal string or a reference to a value in the data model ('path', e.g. '/form/submit')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_string: (
        Literal[
            "accountCircle",
            "add",
            "arrowBack",
            "arrowForward",
            "attachFile",
            "calendarToday",
            "call",
            "camera",
            "check",
            "close",
            "delete",
            "download",
            "edit",
            "event",
            "error",
            "favorite",
            "favoriteOff",
            "folder",
            "help",
            "home",
            "info",
            "locationOn",
            "lock",
            "lockOpen",
            "mail",
            "menu",
            "moreVert",
            "moreHoriz",
            "notificationsOff",
            "notifications",
            "payment",
            "person",
            "phone",
            "photo",
            "print",
            "refresh",
            "search",
            "send",
            "settings",
            "share",
            "shoppingCart",
            "star",
            "starHalf",
            "starOff",
            "upload",
            "visibility",
            "visibilityOff",
            "warning",
        ]
        | None
    ) = Field(None, alias="literalString")
    path: str | None = Field(None)


class DescriptionItem(StrictBaseModel):
    """A description of the audio, such as a title or summary. This can be a literal string or a reference to a value in the data model ('path', e.g. '/song/title')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_string: str | None = Field(None, alias="literalString")
    path: str | None = Field(None)


class ChildrenItem(StrictBaseModel):
    """Defines the children. Use 'explicitList' for a fixed set of children, or 'template' to generate children from a data list."""

    model_config = ConfigDict(populate_by_name=True)
    explicit_list: list[str] | None = Field(None, alias="explicitList")
    template: TemplateItem | None = Field(
        None,
        description=(
            "A template for generating a dynamic list of children from a data model"
            " list. `componentId` is the component to use as a template, and"
            " `dataBinding` is the path to the map of components in the data model."
            " Values in the map will define the list of children."
        ),
    )


class TabItemItem(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: TitleItem = Field(
        ...,
        description=(
            "The tab title. Defines the value as either a literal value or a path to"
            " data model value (e.g. '/options/title')."
        ),
    )
    child: str = Field(...)


class ActionItem(StrictBaseModel):
    """The client-side action to be dispatched when the button is clicked. It includes the action's name and an optional context payload."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(...)
    context: list[ContextItem] | None = Field(None)


class LabelItem(StrictBaseModel):
    """The label for the slider. This can be a literal string or a reference to a value in the data model ('path')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_string: str | None = Field(None, alias="literalString")
    path: str | None = Field(None)


class ValueItem(StrictBaseModel):
    """The current value of the slider. This can be a literal number ('literalNumber') or a reference to a value in the data model ('path', e.g. '/restaurant/cost')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_number: float | None = Field(None, alias="literalNumber")
    path: str | None = Field(None)


class SelectionItem(StrictBaseModel):
    """The currently selected values for the component. This can be a literal array of strings or a path to an array in the data model('path', e.g. '/hotel/options')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_array: list[str] | None = Field(None, alias="literalArray")
    path: str | None = Field(None)


class OptionItem(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    label: LabelItem = Field(
        ...,
        description=(
            "The text to display for this option. This can be a literal string or a"
            " reference to a value in the data model (e.g. '/option/label')."
        ),
    )
    value: str = Field(
        ..., description="The value to be associated with this option when selected."
    )


class TemplateItem(StrictBaseModel):
    """A template for generating a dynamic list of children from a data model list. `componentId` is the component to use as a template, and `dataBinding` is the path to the map of components in the data model. Values in the map will define the list of children."""

    model_config = ConfigDict(populate_by_name=True)
    component_id: str = Field(..., alias="componentId")
    data_binding: str = Field(..., alias="dataBinding")


class TitleItem(StrictBaseModel):
    """The tab title. Defines the value as either a literal value or a path to data model value (e.g. '/options/title')."""

    model_config = ConfigDict(populate_by_name=True)
    literal_string: str | None = Field(None, alias="literalString")
    path: str | None = Field(None)


class ContextItem(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    key: str = Field(...)
    value: ValueItem = Field(
        ...,
        description=(
            "Defines the value to be included in the context as either a literal value"
            " or a path to a data model value (e.g. '/user/name')."
        ),
    )


class TextComponent(ComponentCommon):
    component: Literal["Text"] = "Text"
    text: TextItem = Field(
        ...,
        description=(
            "The text content to display. This can be a literal string or a reference"
            " to a value in the data model ('path', e.g., '/doc/title'). While simple"
            " Markdown formatting is supported (i.e. without HTML, images, or links),"
            " utilizing dedicated UI components is generally preferred for a richer and"
            " more structured presentation."
        ),
    )
    usage_hint: Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"] | None = Field(
        None,
        alias="usageHint",
        description=(
            "A hint for the base text style. One of: - `h1`: Largest heading. - `h2`:"
            " Second largest heading. - `h3`: Third largest heading. - `h4`: Fourth"
            " largest heading. - `h5`: Fifth largest heading. - `caption`: Small text"
            " for captions. - `body`: Standard body text."
        ),
    )


class ImageComponent(ComponentCommon):
    component: Literal["Image"] = "Image"
    url: UrlItem = Field(
        ...,
        description=(
            "The URL of the image to display. This can be a literal string ('literal')"
            " or a reference to a value in the data model ('path', e.g."
            " '/thumbnail/url')."
        ),
    )
    alt_text: AltTextItem | None = Field(
        None,
        alias="altText",
        description=(
            "The alt text for the image. This can be a literal string ('literal') or a"
            " reference to a value in the data model ('path', e.g."
            " '/thumbnail/altText')."
        ),
    )
    fit: Literal["contain", "cover", "fill", "none", "scale-down"] | None = Field(
        None,
        description=(
            "Specifies how the image should be resized to fit its container. This"
            " corresponds to the CSS 'object-fit' property."
        ),
    )
    usage_hint: (
        Literal[
            "icon", "avatar", "smallFeature", "mediumFeature", "largeFeature", "header"
        ]
        | None
    ) = Field(
        None,
        alias="usageHint",
        description=(
            "A hint for the image size and style. One of: - `icon`: Small square icon."
            " - `avatar`: Circular avatar image. - `smallFeature`: Small feature image."
            " - `mediumFeature`: Medium feature image. - `largeFeature`: Large feature"
            " image. - `header`: Full-width, full bleed, header image."
        ),
    )


class IconComponent(ComponentCommon):
    component: Literal["Icon"] = "Icon"
    name: NameItem = Field(
        ...,
        description=(
            "The name of the icon to display. This can be a literal string or a"
            " reference to a value in the data model ('path', e.g. '/form/submit')."
        ),
    )


class VideoComponent(ComponentCommon):
    component: Literal["Video"] = "Video"
    url: UrlItem = Field(
        ...,
        description=(
            "The URL of the video to display. This can be a literal string or a"
            " reference to a value in the data model ('path', e.g. '/video/url')."
        ),
    )


class AudioPlayerComponent(ComponentCommon):
    component: Literal["AudioPlayer"] = "AudioPlayer"
    url: UrlItem = Field(
        ...,
        description=(
            "The URL of the audio to be played. This can be a literal string"
            " ('literal') or a reference to a value in the data model ('path', e.g."
            " '/song/url')."
        ),
    )
    description: DescriptionItem | None = Field(
        None,
        description=(
            "A description of the audio, such as a title or summary. This can be a"
            " literal string or a reference to a value in the data model ('path', e.g."
            " '/song/title')."
        ),
    )


class RowComponent(ComponentCommon):
    component: Literal["Row"] = "Row"
    children: ChildrenItem = Field(
        ...,
        description=(
            "Defines the children. Use 'explicitList' for a fixed set of children, or"
            " 'template' to generate children from a data list."
        ),
    )
    distribution: (
        Literal["center", "end", "spaceAround", "spaceBetween", "spaceEvenly", "start"]
        | None
    ) = Field(
        None,
        description=(
            "Defines the arrangement of children along the main axis (horizontally)."
            " This corresponds to the CSS 'justify-content' property."
        ),
    )
    alignment: Literal["start", "center", "end", "stretch"] | None = Field(
        None,
        description=(
            "Defines the alignment of children along the cross axis (vertically). This"
            " corresponds to the CSS 'align-items' property."
        ),
    )


class ColumnComponent(ComponentCommon):
    component: Literal["Column"] = "Column"
    children: ChildrenItem = Field(
        ...,
        description=(
            "Defines the children. Use 'explicitList' for a fixed set of children, or"
            " 'template' to generate children from a data list."
        ),
    )
    distribution: (
        Literal["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly"]
        | None
    ) = Field(
        None,
        description=(
            "Defines the arrangement of children along the main axis (vertically). This"
            " corresponds to the CSS 'justify-content' property."
        ),
    )
    alignment: Literal["center", "end", "start", "stretch"] | None = Field(
        None,
        description=(
            "Defines the alignment of children along the cross axis (horizontally)."
            " This corresponds to the CSS 'align-items' property."
        ),
    )


class ListComponent(ComponentCommon):
    component: Literal["List"] = "List"
    children: ChildrenItem = Field(
        ...,
        description=(
            "Defines the children. Use 'explicitList' for a fixed set of children, or"
            " 'template' to generate children from a data list."
        ),
    )
    direction: Literal["vertical", "horizontal"] | None = Field(
        None, description="The direction in which the list items are laid out."
    )
    alignment: Literal["start", "center", "end", "stretch"] | None = Field(
        None, description="Defines the alignment of children along the cross axis."
    )


class CardComponent(ComponentCommon):
    component: Literal["Card"] = "Card"
    child: str = Field(
        ..., description="The ID of the component to be rendered inside the card."
    )


class TabsComponent(ComponentCommon):
    component: Literal["Tabs"] = "Tabs"
    tab_items: list[TabItemItem] = Field(
        ...,
        alias="tabItems",
        description=(
            "An array of objects, where each object defines a tab with a title and a"
            " child component."
        ),
    )


class DividerComponent(ComponentCommon):
    component: Literal["Divider"] = "Divider"
    axis: Literal["horizontal", "vertical"] | None = Field(
        None, description="The orientation of the divider."
    )


class ModalComponent(ComponentCommon):
    component: Literal["Modal"] = "Modal"
    entry_point_child: str = Field(
        ...,
        alias="entryPointChild",
        description=(
            "The ID of the component that opens the modal when interacted with (e.g., a"
            " button)."
        ),
    )
    content_child: str = Field(
        ...,
        alias="contentChild",
        description="The ID of the component to be displayed inside the modal.",
    )


class ButtonComponent(ComponentCommon):
    component: Literal["Button"] = "Button"
    child: str = Field(
        ...,
        description=(
            "The ID of the component to display in the button, typically a Text"
            " component."
        ),
    )
    primary: bool | None = Field(
        None,
        description="Indicates if this button should be styled as the primary action.",
    )
    action: ActionItem = Field(
        ...,
        description=(
            "The client-side action to be dispatched when the button is clicked. It"
            " includes the action's name and an optional context payload."
        ),
    )


class CheckBoxComponent(ComponentCommon):
    component: Literal["CheckBox"] = "CheckBox"
    label: LabelItem = Field(
        ...,
        description=(
            "The text to display next to the checkbox. Defines the value as either a"
            " literal value or a path to data model ('path', e.g. '/option/label')."
        ),
    )
    value: ValueItem = Field(
        ...,
        description=(
            "The current state of the checkbox (true for checked, false for unchecked)."
            " This can be a literal boolean ('literalBoolean') or a reference to a"
            " value in the data model ('path', e.g. '/filter/open')."
        ),
    )


class TextFieldComponent(ComponentCommon):
    component: Literal["TextField"] = "TextField"
    label: LabelItem = Field(
        ...,
        description=(
            "The text label for the input field. This can be a literal string or a"
            " reference to a value in the data model ('path, e.g. '/user/name')."
        ),
    )
    text: TextItem | None = Field(
        None,
        description=(
            "The value of the text field. This can be a literal string or a reference"
            " to a value in the data model ('path', e.g. '/user/name')."
        ),
    )
    text_field_type: (
        Literal["date", "longText", "number", "shortText", "obscured"] | None
    ) = Field(
        None, alias="textFieldType", description="The type of input field to display."
    )
    validation_regexp: str | None = Field(
        None,
        alias="validationRegexp",
        description=(
            "A regular expression used for client-side validation of the input."
        ),
    )


class DateTimeInputComponent(ComponentCommon):
    component: Literal["DateTimeInput"] = "DateTimeInput"
    value: ValueItem = Field(
        ...,
        description=(
            "The selected date and/or time value in ISO 8601 format. This can be a"
            " literal string ('literalString') or a reference to a value in the data"
            " model ('path', e.g. '/user/dob')."
        ),
    )
    enable_date: bool | None = Field(
        None,
        alias="enableDate",
        description="If true, allows the user to select a date.",
    )
    enable_time: bool | None = Field(
        None,
        alias="enableTime",
        description="If true, allows the user to select a time.",
    )


class MultipleChoiceComponent(ComponentCommon):
    component: Literal["MultipleChoice"] = "MultipleChoice"
    selections: SelectionItem = Field(
        ...,
        description=(
            "The currently selected values for the component. This can be a literal"
            " array of strings or a path to an array in the data model('path', e.g."
            " '/hotel/options')."
        ),
    )
    options: list[OptionItem] = Field(
        ..., description="An array of available options for the user to choose from."
    )
    max_allowed_selections: int | None = Field(
        None,
        alias="maxAllowedSelections",
        description="The maximum number of options that the user is allowed to select.",
    )
    variant: Literal["checkbox", "chips"] | None = Field(
        None, description="The display style of the component."
    )
    filterable: bool | None = Field(
        None, description="If true, displays a search input to filter the options."
    )


class SliderComponent(ComponentCommon):
    component: Literal["Slider"] = "Slider"
    label: LabelItem | None = Field(
        None,
        description=(
            "The label for the slider. This can be a literal string or a reference to a"
            " value in the data model ('path')."
        ),
    )
    value: ValueItem = Field(
        ...,
        description=(
            "The current value of the slider. This can be a literal number"
            " ('literalNumber') or a reference to a value in the data model ('path',"
            " e.g. '/restaurant/cost')."
        ),
    )
    min_value: float | None = Field(
        None, alias="minValue", description="The minimum value of the slider."
    )
    max_value: float | None = Field(
        None, alias="maxValue", description="The maximum value of the slider."
    )


AnyComponent = Annotated[
    TextComponent
    | ImageComponent
    | IconComponent
    | VideoComponent
    | AudioPlayerComponent
    | RowComponent
    | ColumnComponent
    | ListComponent
    | CardComponent
    | TabsComponent
    | DividerComponent
    | ModalComponent
    | ButtonComponent
    | CheckBoxComponent
    | TextFieldComponent
    | DateTimeInputComponent
    | MultipleChoiceComponent
    | SliderComponent,
    Field(..., discriminator="component"),
]

TEXT_COMPONENT_API = ModelComponentApi(TextComponent)

IMAGE_COMPONENT_API = ModelComponentApi(ImageComponent)

ICON_COMPONENT_API = ModelComponentApi(IconComponent)

VIDEO_COMPONENT_API = ModelComponentApi(VideoComponent)

AUDIO_PLAYER_COMPONENT_API = ModelComponentApi(AudioPlayerComponent)

ROW_COMPONENT_API = ModelComponentApi(RowComponent)

COLUMN_COMPONENT_API = ModelComponentApi(ColumnComponent)

LIST_COMPONENT_API = ModelComponentApi(ListComponent)

CARD_COMPONENT_API = ModelComponentApi(CardComponent)

TABS_COMPONENT_API = ModelComponentApi(TabsComponent)

DIVIDER_COMPONENT_API = ModelComponentApi(DividerComponent)

MODAL_COMPONENT_API = ModelComponentApi(ModalComponent)

BUTTON_COMPONENT_API = ModelComponentApi(ButtonComponent)

CHECK_BOX_COMPONENT_API = ModelComponentApi(CheckBoxComponent)

TEXT_FIELD_COMPONENT_API = ModelComponentApi(TextFieldComponent)

DATE_TIME_INPUT_COMPONENT_API = ModelComponentApi(DateTimeInputComponent)

MULTIPLE_CHOICE_COMPONENT_API = ModelComponentApi(MultipleChoiceComponent)

SLIDER_COMPONENT_API = ModelComponentApi(SliderComponent)

BASIC_COMPONENTS = [
    TEXT_COMPONENT_API,
    IMAGE_COMPONENT_API,
    ICON_COMPONENT_API,
    VIDEO_COMPONENT_API,
    AUDIO_PLAYER_COMPONENT_API,
    ROW_COMPONENT_API,
    COLUMN_COMPONENT_API,
    LIST_COMPONENT_API,
    CARD_COMPONENT_API,
    TABS_COMPONENT_API,
    DIVIDER_COMPONENT_API,
    MODAL_COMPONENT_API,
    BUTTON_COMPONENT_API,
    CHECK_BOX_COMPONENT_API,
    TEXT_FIELD_COMPONENT_API,
    DATE_TIME_INPUT_COMPONENT_API,
    MULTIPLE_CHOICE_COMPONENT_API,
    SLIDER_COMPONENT_API,
]
