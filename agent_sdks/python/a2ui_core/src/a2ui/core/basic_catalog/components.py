# Copyright 2026 Google LLC
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
from typing import Any, Dict, List, Literal, Optional, Union, Annotated
from pydantic import BaseModel, Field, ConfigDict

from ..schema.common_types import (
    StrictBaseModel,
    ComponentCommon,
    AccessibilityAttributes,
    DynamicString,
    DynamicNumber,
    DynamicBoolean,
    DynamicStringList,
    ChildList,
    Action,
    CheckRule,
    DataBinding,
    ComponentId,
)
from ..catalog.components import ModelComponentApi


class CatalogComponentCommon(ComponentCommon):
    weight: Optional[float] = Field(
        None,
        description="The relative weight of this component within a Row or Column. This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the component is a direct descendant of a Row or Column.",
    )


class OptionItem(StrictBaseModel):
    label: DynamicString = Field(
        ..., description="The text to display for this option."
    )
    value: str = Field(..., description="The stable value associated with this option.")


class SvgPath(StrictBaseModel):
    svg_path: str = Field(..., alias="svgPath")


class TabItem(StrictBaseModel):
    title: DynamicString = Field(..., description="The tab title.")
    child: ComponentId = Field(
        ...,
        description="The ID of the child component. Do NOT define the component inline.",
    )


class TextComponent(CatalogComponentCommon):
    component: Literal["Text"] = "Text"
    text: DynamicString = Field(
        ...,
        description="The text content to display. While simple Markdown formatting is supported (i.e. without HTML, images, or links), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.",
    )
    variant: Optional[Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"]] = Field(
        description="A hint for the base text style.", default="body"
    )


class ImageComponent(CatalogComponentCommon):
    component: Literal["Image"] = "Image"
    url: DynamicString = Field(..., description="The URL of the image to display.")
    description: Optional[DynamicString] = Field(
        None, description="Accessibility text for the image."
    )
    fit: Optional[Literal["contain", "cover", "fill", "none", "scaleDown"]] = Field(
        description="Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
        default="fill",
    )
    variant: Optional[
        Literal[
            "icon", "avatar", "smallFeature", "mediumFeature", "largeFeature", "header"
        ]
    ] = Field(
        description="A hint for the image size and style.", default="mediumFeature"
    )


class IconComponent(CatalogComponentCommon):
    component: Literal["Icon"] = "Icon"
    name: Union[
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
            "fastForward",
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
            "pause",
            "payment",
            "person",
            "phone",
            "photo",
            "play",
            "print",
            "refresh",
            "rewind",
            "search",
            "send",
            "settings",
            "share",
            "shoppingCart",
            "skipNext",
            "skipPrevious",
            "star",
            "starHalf",
            "starOff",
            "stop",
            "upload",
            "visibility",
            "visibilityOff",
            "volumeDown",
            "volumeMute",
            "volumeOff",
            "volumeUp",
            "warning",
        ],
        SvgPath,
        DataBinding,
    ] = Field(..., description="The name of the icon to display.")


class VideoComponent(CatalogComponentCommon):
    component: Literal["Video"] = "Video"
    url: DynamicString = Field(..., description="The URL of the video to display.")


class AudioPlayerComponent(CatalogComponentCommon):
    component: Literal["AudioPlayer"] = "AudioPlayer"
    url: DynamicString = Field(..., description="The URL of the audio to be played.")
    description: Optional[DynamicString] = Field(
        None, description="A description of the audio, such as a title or summary."
    )


class RowComponent(CatalogComponentCommon):
    component: Literal["Row"] = "Row"
    children: ChildList = Field(
        ...,
        description="Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.",
    )
    justify: Optional[
        Literal[
            "center",
            "end",
            "spaceAround",
            "spaceBetween",
            "spaceEvenly",
            "start",
            "stretch",
        ]
    ] = Field(
        description="Defines the arrangement of children along the main axis (horizontally). Use 'spaceBetween' to push items to the edges, or 'start'/'end'/'center' to pack them together.",
        default="start",
    )
    align: Optional[Literal["start", "center", "end", "stretch"]] = Field(
        description="Defines the alignment of children along the cross axis (vertically). This is similar to the CSS 'align-items' property, but uses camelCase values (e.g., 'start').",
        default="stretch",
    )


class ColumnComponent(CatalogComponentCommon):
    component: Literal["Column"] = "Column"
    children: ChildList = Field(
        ...,
        description="Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list. Children cannot be defined inline, they must be referred to by ID.",
    )
    justify: Optional[
        Literal[
            "start",
            "center",
            "end",
            "spaceBetween",
            "spaceAround",
            "spaceEvenly",
            "stretch",
        ]
    ] = Field(
        description="Defines the arrangement of children along the main axis (vertically). Use 'spaceBetween' to push items to the edges (e.g. header at top, footer at bottom), or 'start'/'end'/'center' to pack them together.",
        default="start",
    )
    align: Optional[Literal["center", "end", "start", "stretch"]] = Field(
        description="Defines the alignment of children along the cross axis (horizontally). This is similar to the CSS 'align-items' property.",
        default="stretch",
    )


class ListComponent(CatalogComponentCommon):
    component: Literal["List"] = "List"
    children: ChildList = Field(
        ...,
        description="Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list.",
    )
    direction: Optional[Literal["vertical", "horizontal"]] = Field(
        description="The direction in which the list items are laid out.",
        default="vertical",
    )
    align: Optional[Literal["start", "center", "end", "stretch"]] = Field(
        description="Defines the alignment of children along the cross axis.",
        default="stretch",
    )


class CardComponent(CatalogComponentCommon):
    component: Literal["Card"] = "Card"
    child: ComponentId = Field(
        ...,
        description="The ID of the single child component to be rendered inside the card. To display multiple elements, you MUST wrap them in a layout component (like Column or Row) and pass that container's ID here. Do NOT pass multiple IDs or a non-existent ID. Do NOT define the child component inline.",
    )


class TabsComponent(CatalogComponentCommon):
    component: Literal["Tabs"] = "Tabs"
    tabs: List[TabItem] = Field(
        ...,
        description="An array of objects, where each object defines a tab with a title and a child component.",
    )


class ModalComponent(CatalogComponentCommon):
    component: Literal["Modal"] = "Modal"
    trigger: ComponentId = Field(
        ...,
        description="The ID of the component that opens the modal when interacted with (e.g., a button). Do NOT define the component inline.",
    )
    content: ComponentId = Field(
        ...,
        description="The ID of the component to be displayed inside the modal. Do NOT define the component inline.",
    )


class DividerComponent(CatalogComponentCommon):
    component: Literal["Divider"] = "Divider"
    axis: Optional[Literal["horizontal", "vertical"]] = Field(
        description="The orientation of the divider.", default="horizontal"
    )


class ButtonComponent(CatalogComponentCommon):
    component: Literal["Button"] = "Button"
    checks: Optional[List[CheckRule]] = Field(
        None,
        description="A list of checks to perform. These are function calls that must return a boolean indicating validity.",
    )
    child: ComponentId = Field(
        ...,
        description="The ID of the child component. Use a 'Text' component for a labeled button. Only use an 'Icon' if the requirements explicitly ask for an icon-only button. Do NOT define the child component inline.",
    )
    variant: Optional[Literal["default", "primary", "borderless"]] = Field(
        description="A hint for the button style. If omitted, a default button style is used. 'primary' indicates this is the main call-to-action button. 'borderless' means the button has no visual border or background, making its child content appear like a clickable link.",
        default="default",
    )
    action: Action = Field(...)


class TextFieldComponent(CatalogComponentCommon):
    component: Literal["TextField"] = "TextField"
    checks: Optional[List[CheckRule]] = Field(
        None,
        description="A list of checks to perform. These are function calls that must return a boolean indicating validity.",
    )
    label: DynamicString = Field(..., description="The text label for the input field.")
    value: Optional[DynamicString] = Field(
        None, description="The value of the text field."
    )
    variant: Optional[Literal["longText", "number", "shortText", "obscured"]] = Field(
        description="The type of input field to display.", default="shortText"
    )
    validation_regexp: Optional[str] = Field(
        None,
        alias="validationRegexp",
        description="A regular expression used for client-side validation of the input.",
    )


class CheckBoxComponent(CatalogComponentCommon):
    component: Literal["CheckBox"] = "CheckBox"
    checks: Optional[List[CheckRule]] = Field(
        None,
        description="A list of checks to perform. These are function calls that must return a boolean indicating validity.",
    )
    label: DynamicString = Field(
        ..., description="The text to display next to the checkbox."
    )
    value: DynamicBoolean = Field(
        ...,
        description="The current state of the checkbox (true for checked, false for unchecked).",
    )


class ChoicePickerComponent(CatalogComponentCommon):
    component: Literal["ChoicePicker"] = "ChoicePicker"
    checks: Optional[List[CheckRule]] = Field(
        None,
        description="A list of checks to perform. These are function calls that must return a boolean indicating validity.",
    )
    label: Optional[DynamicString] = Field(
        None, description="The label for the group of options."
    )
    variant: Optional[Literal["multipleSelection", "mutuallyExclusive"]] = Field(
        description="A hint for how the choice picker should be displayed and behave.",
        default="mutuallyExclusive",
    )
    options: List[OptionItem] = Field(
        ..., description="The list of available options to choose from."
    )
    value: DynamicStringList = Field(
        ...,
        description="The list of currently selected values. This should be bound to a string array in the data model.",
    )
    display_style: Optional[Literal["checkbox", "chips"]] = Field(
        alias="displayStyle",
        description="The display style of the component.",
        default="checkbox",
    )
    filterable: Optional[bool] = Field(
        description="If true, displays a search input to filter the options.",
        default=False,
    )


class SliderComponent(CatalogComponentCommon):
    component: Literal["Slider"] = "Slider"
    checks: Optional[List[CheckRule]] = Field(
        None,
        description="A list of checks to perform. These are function calls that must return a boolean indicating validity.",
    )
    label: Optional[DynamicString] = Field(
        None, description="The label for the slider."
    )
    min: Optional[float] = Field(
        description="The minimum value of the slider.", default=0
    )
    max: float = Field(..., description="The maximum value of the slider.")
    value: DynamicNumber = Field(..., description="The current value of the slider.")


class DateTimeInputComponent(CatalogComponentCommon):
    component: Literal["DateTimeInput"] = "DateTimeInput"
    checks: Optional[List[CheckRule]] = Field(
        None,
        description="A list of checks to perform. These are function calls that must return a boolean indicating validity.",
    )
    value: DynamicString = Field(
        ...,
        description="The selected date and/or time value in ISO 8601 format. If not yet set, initialize with an empty string.",
    )
    enable_date: Optional[bool] = Field(
        alias="enableDate",
        description="If true, allows the user to select a date.",
        default=False,
    )
    enable_time: Optional[bool] = Field(
        alias="enableTime",
        description="If true, allows the user to select a time.",
        default=False,
    )
    min: Optional[DynamicString] = Field(
        None, description="The minimum allowed date/time in ISO 8601 format."
    )
    max: Optional[DynamicString] = Field(
        None, description="The maximum allowed date/time in ISO 8601 format."
    )
    label: Optional[DynamicString] = Field(
        None, description="The text label for the input field."
    )


AnyComponent = Annotated[
    Union[
        TextComponent,
        ImageComponent,
        IconComponent,
        VideoComponent,
        AudioPlayerComponent,
        RowComponent,
        ColumnComponent,
        ListComponent,
        CardComponent,
        TabsComponent,
        ModalComponent,
        DividerComponent,
        ButtonComponent,
        TextFieldComponent,
        CheckBoxComponent,
        ChoicePickerComponent,
        SliderComponent,
        DateTimeInputComponent,
    ],
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

MODAL_COMPONENT_API = ModelComponentApi(ModalComponent)

DIVIDER_COMPONENT_API = ModelComponentApi(DividerComponent)

BUTTON_COMPONENT_API = ModelComponentApi(ButtonComponent)

TEXT_FIELD_COMPONENT_API = ModelComponentApi(TextFieldComponent)

CHECK_BOX_COMPONENT_API = ModelComponentApi(CheckBoxComponent)

CHOICE_PICKER_COMPONENT_API = ModelComponentApi(ChoicePickerComponent)

SLIDER_COMPONENT_API = ModelComponentApi(SliderComponent)

DATE_TIME_INPUT_COMPONENT_API = ModelComponentApi(DateTimeInputComponent)

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
    MODAL_COMPONENT_API,
    DIVIDER_COMPONENT_API,
    BUTTON_COMPONENT_API,
    TEXT_FIELD_COMPONENT_API,
    CHECK_BOX_COMPONENT_API,
    CHOICE_PICKER_COMPONENT_API,
    SLIDER_COMPONENT_API,
    DATE_TIME_INPUT_COMPONENT_API,
]
