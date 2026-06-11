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

from .components import (
    AudioPlayerComponent as AudioPlayerComponent,
    ButtonComponent as ButtonComponent,
    CardComponent as CardComponent,
    CheckBoxComponent as CheckBoxComponent,
    ChoicePickerComponent as ChoicePickerComponent,
    ColumnComponent as ColumnComponent,
    DateTimeInputComponent as DateTimeInputComponent,
    DividerComponent as DividerComponent,
    IconComponent as IconComponent,
    ImageComponent as ImageComponent,
    ListComponent as ListComponent,
    ModalComponent as ModalComponent,
    RowComponent as RowComponent,
    SliderComponent as SliderComponent,
    TabsComponent as TabsComponent,
    TextComponent as TextComponent,
    TextFieldComponent as TextFieldComponent,
    VideoComponent as VideoComponent,
    AnyComponent as AnyComponent,
)
from .function_apis import (
    RequiredApi as RequiredApi,
    RegexApi as RegexApi,
    LengthApi as LengthApi,
    NumericApi as NumericApi,
    EmailApi as EmailApi,
    FormatStringApi as FormatStringApi,
    FormatNumberApi as FormatNumberApi,
    FormatCurrencyApi as FormatCurrencyApi,
    FormatDateApi as FormatDateApi,
    PluralizeApi as PluralizeApi,
    OpenUrlApi as OpenUrlApi,
    AndApi as AndApi,
    OrApi as OrApi,
    NotApi as NotApi,
)
from .operator_apis import (
    AddApi as AddApi,
    SubtractApi as SubtractApi,
    MultiplyApi as MultiplyApi,
    DivideApi as DivideApi,
    EqualsApi as EqualsApi,
    NotEqualsApi as NotEqualsApi,
    GreaterThanApi as GreaterThanApi,
    LessThanApi as LessThanApi,
    ContainsApi as ContainsApi,
    StartsWithApi as StartsWithApi,
    EndsWithApi as EndsWithApi,
)
from .styles import Theme as Theme
from .function_impls import BASIC_FUNCTION_IMPLEMENTATIONS as BASIC_FUNCTION_IMPLEMENTATIONS
from ..schema.constants import SPEC_VERSION as SPEC_VERSION, SPEC_BASE_URL as SPEC_BASE_URL
from ..catalog import ModelCatalog as ModelCatalog


def _basic_catalog_id(spec_version: str) -> str:
    return (
        f"{SPEC_BASE_URL}/{spec_version.replace('.', '_')}/catalogs/basic/catalog.json"
    )


from typing import Dict, Type
from pydantic import BaseModel


class BasicCatalog(ModelCatalog):

    def __init__(self) -> None:
        components_map: Dict[str, Type[BaseModel]] = {
            "Text": TextComponent,
            "Image": ImageComponent,
            "Icon": IconComponent,
            "Video": VideoComponent,
            "AudioPlayer": AudioPlayerComponent,
            "Row": RowComponent,
            "Column": ColumnComponent,
            "List": ListComponent,
            "Card": CardComponent,
            "Tabs": TabsComponent,
            "Modal": ModalComponent,
            "Divider": DividerComponent,
            "Button": ButtonComponent,
            "TextField": TextFieldComponent,
            "CheckBox": CheckBoxComponent,
            "ChoicePicker": ChoicePickerComponent,
            "Slider": SliderComponent,
            "DateTimeInput": DateTimeInputComponent,
        }

        super().__init__(
            spec_version=SPEC_VERSION,
            catalog_id=_basic_catalog_id(SPEC_VERSION),
            components=components_map,
            functions=BASIC_FUNCTION_IMPLEMENTATIONS,
            theme=Theme,
        )
