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
from .function_impls import (
    BASIC_FUNCTION_IMPLEMENTATIONS,
    create_basic_catalog_functions,
)
from ...schema.v1_0.constants import PROTOCOL_VERSION, PROTOCOL_BASE_URL
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
            instructions=(
                "For layout, use the Row and Column components to organize other"
                " components.\n\n## Catalog Guidelines\n\n1. String Concatenation &"
                " Formatting: A2UI does not support binary operators like '+' or"
                " formatting symbols. To concatenate strings or dynamically inject data"
                " bindings into text, you must use the catalog function"
                " `formatString(value)` where the value string contains placeholders"
                ' formatted as `${expression}`:\n   formatString("Hello'
                ' ${/user/name}")\n\n2. Strict Hierarchy: You must strictly adhere to'
                " the requested component nesting and hierarchy. If the prompt"
                " specifies that a component is 'inside' or 'contained in' another"
                " component, you MUST place it as a child of that specific component,"
                " not as a sibling or in a different container.\n\n3. Validation"
                " Checks: When components support validation checks, specify any custom"
                " error messages directly as the 'message' inside the check. Do NOT"
                " create separate text-display components to display validation"
                " errors.\n\n## Examples\n\nExample 1: Dynamic text form\n```json\n[\n "
                ' {\n    "version": "v1.0",\n    "createSurface": {\n      "surfaceId":'
                ' "main",\n      "catalogId":'
                ' "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",\n '
                '     "components": [\n        {\n          "id": "root",\n         '
                ' "component": "Column",\n          "children": ["repField",'
                ' "valueField"]\n        },\n        {\n          "id": "repField",\n  '
                '        "component": "TextField",\n          "label":'
                ' "Representative",\n          "value": {"@path": "/form/rep"},\n      '
                '    "placeholder": "Enter name"\n        },\n        {\n         '
                ' "id": "valueField",\n          "component": "TextField",\n         '
                ' "label": "Deal Value",\n          "value": {"@path":'
                ' "/form/value"},\n          "placeholder": "0.00",\n         '
                ' "variant": "number",\n          "checks": [\n            {"@call":'
                ' "required"}\n          ]\n        }\n      ],\n      "dataModel": {\n'
                '        "form": {\n          "rep": "John Doe",\n          "value":'
                " 1500.00\n        }\n      }\n    }\n  }\n]\n```\n\nExample 2: Dynamic"
                ' list with templates\n```json\n[\n  {\n    "version": "v1.0",\n   '
                ' "createSurface": {\n      "surfaceId": "main",\n      "catalogId":'
                ' "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",\n '
                '     "components": [\n        {\n          "id": "root",\n         '
                ' "component": "Card",\n          "child": "breedList"\n        },\n   '
                '     {\n          "id": "breedList",\n          "component": "List",\n'
                '          "children": {\n            "path": "/breeds",\n           '
                ' "componentId": "breedTemplate"\n          },\n          "direction":'
                ' "horizontal"\n        },\n        {\n          "id":'
                ' "breedTemplate",\n          "component": "Image",\n          "url":'
                ' {"@path": "url"}\n        }\n      ],\n      "dataModel": {\n       '
                ' "breeds": [\n          {\n            "url":'
                ' "https://example.com/poodle.jpg"\n          },\n          {\n        '
                '    "url": "https://example.com/lab.jpg"\n          }\n        ]\n    '
                "  }\n    }\n  }\n]\n```"
            ),
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
    "BASIC_FUNCTION_IMPLEMENTATIONS",
    "create_basic_catalog_functions",
    "BasicCatalog",
]
