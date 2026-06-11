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
    AudioPlayerComponent,
    ButtonComponent,
    CardComponent,
    CheckBoxComponent,
    ChoicePickerComponent,
    ColumnComponent,
    DateTimeInputComponent,
    DividerComponent,
    IconComponent,
    ImageComponent,
    ListComponent,
    ModalComponent,
    RowComponent,
    SliderComponent,
    TabsComponent,
    TextComponent,
    TextFieldComponent,
    VideoComponent,
    AnyComponent,
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
from .operator_apis import (
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
from .function_impls import BASIC_FUNCTION_IMPLEMENTATIONS
from ..schema.constants import SPEC_VERSION, SPEC_BASE_URL
from ..catalog import ModelCatalog


def _basic_catalog_id(spec_version: str) -> str:
    return (
        f"{SPEC_BASE_URL}/{spec_version.replace('.', '_')}/catalogs/basic/catalog.json"
    )


class BasicCatalog(ModelCatalog):

    def __init__(self):
        components_map = {
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
