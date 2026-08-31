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
from typing import Optional

from .components import (
    SvgPath,
    TabItem,
    OptionItem,
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
    AnyComponent,
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
    BASIC_COMPONENTS,
)
from .function_apis import (
    RequiredApi,
    RegexApi,
    LengthApi,
    NumericApi,
    EmailApi,
    FormatStringApi,
    FormatNumberApi,
    FormatCurrencyApi,
    FormatDateApi,
    PluralizeApi,
    OpenUrlApi,
    AndApi,
    OrApi,
    NotApi,
)
from ..operator_apis import (
    AddApi,
    SubtractApi,
    MultiplyApi,
    DivideApi,
    EqualsApi,
    NotEqualsApi,
    GreaterThanApi,
    LessThanApi,
    ContainsApi,
    StartsWithApi,
    EndsWithApi,
)
from .styles import Theme
from .function_impls import (
    BASIC_FUNCTION_IMPLEMENTATIONS,
    create_basic_catalog_functions,
)
from ...schema.v0_9.constants import PROTOCOL_VERSION, PROTOCOL_BASE_URL
from ...catalog import Catalog, ModelComponentApi, FunctionImplementation


def _basic_catalog_id(protocol_version: str) -> str:
    return (
        f"{PROTOCOL_BASE_URL}/{protocol_version.replace('.', '_')}/catalogs/basic/catalog.json"
    )


class BasicCatalog(Catalog[ModelComponentApi, FunctionImplementation]):

    def __init__(self, locale: str | None = None):
        super().__init__(
            catalog_id=_basic_catalog_id(PROTOCOL_VERSION),
            protocol_version=PROTOCOL_VERSION,
            components=BASIC_COMPONENTS,
            functions=create_basic_catalog_functions(locale=locale),
            theme_schema=Theme.model_json_schema(),
        )


__all__ = [
    "SvgPath",
    "TabItem",
    "OptionItem",
    "TextComponent",
    "ImageComponent",
    "IconComponent",
    "VideoComponent",
    "AudioPlayerComponent",
    "RowComponent",
    "ColumnComponent",
    "ListComponent",
    "CardComponent",
    "TabsComponent",
    "ModalComponent",
    "DividerComponent",
    "ButtonComponent",
    "TextFieldComponent",
    "CheckBoxComponent",
    "ChoicePickerComponent",
    "SliderComponent",
    "DateTimeInputComponent",
    "AnyComponent",
    "TEXT_COMPONENT_API",
    "IMAGE_COMPONENT_API",
    "ICON_COMPONENT_API",
    "VIDEO_COMPONENT_API",
    "AUDIO_PLAYER_COMPONENT_API",
    "ROW_COMPONENT_API",
    "COLUMN_COMPONENT_API",
    "LIST_COMPONENT_API",
    "CARD_COMPONENT_API",
    "TABS_COMPONENT_API",
    "MODAL_COMPONENT_API",
    "DIVIDER_COMPONENT_API",
    "BUTTON_COMPONENT_API",
    "TEXT_FIELD_COMPONENT_API",
    "CHECK_BOX_COMPONENT_API",
    "CHOICE_PICKER_COMPONENT_API",
    "SLIDER_COMPONENT_API",
    "DATE_TIME_INPUT_COMPONENT_API",
    "BASIC_COMPONENTS",
    "RequiredApi",
    "RegexApi",
    "LengthApi",
    "NumericApi",
    "EmailApi",
    "FormatStringApi",
    "FormatNumberApi",
    "FormatCurrencyApi",
    "FormatDateApi",
    "PluralizeApi",
    "OpenUrlApi",
    "AndApi",
    "OrApi",
    "NotApi",
    "AddApi",
    "SubtractApi",
    "MultiplyApi",
    "DivideApi",
    "EqualsApi",
    "NotEqualsApi",
    "GreaterThanApi",
    "LessThanApi",
    "ContainsApi",
    "StartsWithApi",
    "EndsWithApi",
    "Theme",
    "BASIC_FUNCTION_IMPLEMENTATIONS",
    "create_basic_catalog_functions",
    "BasicCatalog",
]
