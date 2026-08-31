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
from ...schema.v1_0.common_types import (
    Action,
    CheckRule,
    Checkable,
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
    DynamicValue,
    FunctionCall,
    FunctionCommon,
    IndexSystemFunction,
    ListReference,
    SingleReference,
    StrictBaseModel,
    TemplateChildList,
)
from ...catalog.components import ModelComponentApi


class SvgPath(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    svg_path: DynamicString = Field(..., alias="svgPath")


class TabItem(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: DynamicString = Field(..., description="The tab title.")
    child: Child = Field(..., description="The ID of the child component.")


class OptionItem(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    label: DynamicString = Field(
        ..., description="The text to display for this option."
    )
    value: str = Field(..., description="The stable value associated with this option.")


class TextComponent(ComponentCommon):
    component: Literal["Text"] = "Text"
    text: DynamicString = Field(
        ...,
        description=(
            "The text content to display. While simple Markdown formatting is supported"
            " (i.e. without HTML, images, or links), utilizing dedicated UI components"
            " is generally preferred for a richer and more structured presentation."
        ),
    )
    variant: Literal["caption", "body"] | None = Field(
        description="A hint for the base text style.", default="body"
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class ImageComponent(ComponentCommon):
    component: Literal["Image"] = "Image"
    url: DynamicString = Field(..., description="The URL of the image to display.")
    description: DynamicString | None = Field(
        None, description="Accessibility text for the image."
    )
    fit: Literal["contain", "cover", "fill", "none", "scaleDown"] | None = Field(
        description=(
            "Specifies how the image should be resized to fit its container. This"
            " corresponds to the CSS 'object-fit' property."
        ),
        default="fill",
    )
    variant: (
        Literal[
            "icon", "avatar", "smallFeature", "mediumFeature", "largeFeature", "header"
        ]
        | None
    ) = Field(
        description="A hint for the image size and style.", default="mediumFeature"
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class IconComponent(ComponentCommon):
    component: Literal["Icon"] = "Icon"
    name: (
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
        ]
        | SvgPath
        | DataBinding
    ) = Field(..., description="The name of the icon to display.")
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class VideoComponent(ComponentCommon):
    component: Literal["Video"] = "Video"
    url: DynamicString = Field(..., description="The URL of the video to display.")
    poster_url: DynamicString | None = Field(
        None,
        alias="posterUrl",
        description="The URL of the poster image to display before the video plays.",
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class AudioPlayerComponent(ComponentCommon):
    component: Literal["AudioPlayer"] = "AudioPlayer"
    url: DynamicString = Field(..., description="The URL of the audio to be played.")
    description: DynamicString | None = Field(
        None, description="A description of the audio, such as a title or summary."
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class RowComponent(ComponentCommon):
    component: Literal["Row"] = "Row"
    children: ChildList = Field(
        ...,
        description=(
            "Defines the children. Use an array of strings for a fixed set of children,"
            " or a template object to generate children from a data list. Children"
            " cannot be defined inline, they must be referred to by ID."
        ),
    )
    justify: (
        Literal[
            "center",
            "end",
            "spaceAround",
            "spaceBetween",
            "spaceEvenly",
            "start",
            "stretch",
        ]
        | None
    ) = Field(
        description=(
            "Defines the arrangement of children along the main axis (horizontally)."
            " Use 'spaceBetween' to push items to the edges, or 'start'/'end'/'center'"
            " to pack them together."
        ),
        default="start",
    )
    align: Literal["start", "center", "end", "stretch"] | None = Field(
        description=(
            "Defines the alignment of children along the cross axis (vertically). This"
            " is similar to the CSS 'align-items' property, but uses camelCase values"
            " (e.g., 'start')."
        ),
        default="stretch",
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class ColumnComponent(ComponentCommon):
    component: Literal["Column"] = "Column"
    children: ChildList = Field(
        ...,
        description=(
            "Defines the children. Use an array of strings for a fixed set of children,"
            " or a template object to generate children from a data list. Children"
            " cannot be defined inline, they must be referred to by ID."
        ),
    )
    justify: (
        Literal[
            "start",
            "center",
            "end",
            "spaceBetween",
            "spaceAround",
            "spaceEvenly",
            "stretch",
        ]
        | None
    ) = Field(
        description=(
            "Defines the arrangement of children along the main axis (vertically). Use"
            " 'spaceBetween' to push items to the edges (e.g. header at top, footer at"
            " bottom), or 'start'/'end'/'center' to pack them together."
        ),
        default="start",
    )
    align: Literal["center", "end", "start", "stretch"] | None = Field(
        description=(
            "Defines the alignment of children along the cross axis (horizontally)."
            " This is similar to the CSS 'align-items' property."
        ),
        default="stretch",
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class ListComponent(ComponentCommon):
    component: Literal["List"] = "List"
    children: ChildList = Field(
        ...,
        description=(
            "Defines the children. Use an array of strings for a fixed set of children,"
            " or a template object to generate children from a data list."
        ),
    )
    direction: Literal["vertical", "horizontal"] | None = Field(
        description="The direction in which the list items are laid out.",
        default="vertical",
    )
    align: Literal["start", "center", "end", "stretch"] | None = Field(
        description="Defines the alignment of children along the cross axis.",
        default="stretch",
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class CardComponent(ComponentCommon):
    component: Literal["Card"] = "Card"
    child: Child = Field(
        ...,
        description=(
            "The ID of the single child component to be rendered inside the card. To"
            " display multiple elements, you MUST wrap them in a layout component (like"
            " Column or Row) and pass that container's ID here. Do NOT pass multiple"
            " IDs or a non-existent ID."
        ),
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class TabsComponent(ComponentCommon):
    component: Literal["Tabs"] = "Tabs"
    tabs: list[TabItem] = Field(
        ...,
        description=(
            "An array of objects, where each object defines a tab with a title and a"
            " child component."
        ),
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class ModalComponent(ComponentCommon):
    component: Literal["Modal"] = "Modal"
    trigger: Child = Field(
        ...,
        description=(
            "The ID of the component that opens the modal when interacted with (e.g., a"
            " button)."
        ),
    )
    content: Child = Field(
        ..., description="The ID of the component to be displayed inside the modal."
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class DividerComponent(ComponentCommon):
    component: Literal["Divider"] = "Divider"
    axis: Literal["horizontal", "vertical"] | None = Field(
        description="The orientation of the divider.", default="horizontal"
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class ButtonComponent(ComponentCommon):
    component: Literal["Button"] = "Button"
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )
    child: Child = Field(
        ...,
        description=(
            "The ID of the child component. Use a 'Text' component for a labeled"
            " button. Only use an 'Icon' if the requirements explicitly ask for an"
            " icon-only button."
        ),
    )
    variant: Literal["default", "primary", "borderless"] | None = Field(
        description=(
            "A hint for the button style. If omitted, a default button style is used."
            " 'primary' indicates this is the main call-to-action button. 'borderless'"
            " means the button has no visual border or background, making its child"
            " content appear like a clickable link."
        ),
        default="default",
    )
    action: Action = Field(...)
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class TextFieldComponent(ComponentCommon):
    component: Literal["TextField"] = "TextField"
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )
    label: DynamicString = Field(..., description="The text label for the input field.")
    value: DynamicString | None = Field(
        None, description="The value of the text field."
    )
    placeholder: DynamicString | None = Field(
        None, description="The placeholder text for the input field."
    )
    variant: Literal["longText", "number", "shortText", "obscured"] | None = Field(
        description="The type of input field to display.", default="shortText"
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class CheckBoxComponent(ComponentCommon):
    component: Literal["CheckBox"] = "CheckBox"
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )
    label: DynamicString = Field(
        ..., description="The text to display next to the checkbox."
    )
    value: DynamicBoolean = Field(
        ...,
        description=(
            "The current state of the checkbox (true for checked, false for unchecked)."
        ),
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class ChoicePickerComponent(ComponentCommon):
    component: Literal["ChoicePicker"] = "ChoicePicker"
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )
    label: DynamicString | None = Field(
        None, description="The label for the group of options."
    )
    variant: Literal["multipleSelection", "mutuallyExclusive"] | None = Field(
        description="A hint for how the choice picker should be displayed and behave.",
        default="mutuallyExclusive",
    )
    options: list[OptionItem] = Field(
        ..., description="The list of available options to choose from."
    )
    value: DynamicStringList = Field(
        ...,
        description=(
            "The list of currently selected values. This should be bound to a string"
            " array in the data model."
        ),
    )
    display_style: Literal["checkbox", "chips"] | None = Field(
        alias="displayStyle",
        description="The display style of the component.",
        default="checkbox",
    )
    filterable: bool | None = Field(
        description="If true, displays a search input to filter the options.",
        default=False,
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class SliderComponent(ComponentCommon):
    component: Literal["Slider"] = "Slider"
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )
    label: DynamicString | None = Field(None, description="The label for the slider.")
    min: float | None = Field(description="The minimum value of the slider.", default=0)
    max: float = Field(..., description="The maximum value of the slider.")
    value: DynamicNumber = Field(..., description="The current value of the slider.")
    steps: int | None = Field(
        None,
        description=(
            "The number of discrete divisions in the slider range. If specified, the"
            " slider will snap to discrete values."
        ),
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
    )


class DateTimeInputComponent(ComponentCommon):
    component: Literal["DateTimeInput"] = "DateTimeInput"
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )
    value: DynamicString = Field(
        ...,
        description=(
            "The selected date and/or time value in ISO 8601 format. If not yet set,"
            " initialize with an empty string."
        ),
    )
    enable_date: bool | None = Field(
        alias="enableDate",
        description="If true, allows the user to select a date.",
        default=False,
    )
    enable_time: bool | None = Field(
        alias="enableTime",
        description="If true, allows the user to select a time.",
        default=False,
    )
    min: DynamicString | None = Field(
        None, description="The minimum allowed date/time in ISO 8601 format."
    )
    max: DynamicString | None = Field(
        None, description="The maximum allowed date/time in ISO 8601 format."
    )
    label: DynamicString | None = Field(
        None, description="The text label for the input field."
    )
    weight: float | None = Field(
        None,
        description=(
            "The relative weight of this component within a Row or Column. This is"
            " similar to the CSS 'flex-grow' property. Note: this may ONLY be set when"
            " the component is a direct descendant of a Row or Column."
        ),
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
    | ModalComponent
    | DividerComponent
    | ButtonComponent
    | TextFieldComponent
    | CheckBoxComponent
    | ChoicePickerComponent
    | SliderComponent
    | DateTimeInputComponent,
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
