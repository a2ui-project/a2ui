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
    BASIC_COMPONENTS,
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
from .function_impls import BASIC_FUNCTION_IMPLEMENTATIONS, create_basic_catalog_functions
from ..schema.constants import SPEC_VERSION, SPEC_BASE_URL
from ..catalog import Catalog, ModelComponentApi, FunctionImplementation


def _basic_catalog_id(spec_version: str) -> str:
    return (
        f"{SPEC_BASE_URL}/{spec_version.replace('.', '_')}/catalogs/basic/catalog.json"
    )


class BasicCatalog(Catalog[ModelComponentApi, FunctionImplementation]):

    def __init__(self, locale: Optional[str] = None):
        super().__init__(
            catalog_id=_basic_catalog_id(SPEC_VERSION),
            spec_version=SPEC_VERSION,
            components=BASIC_COMPONENTS,
            functions=create_basic_catalog_functions(locale),
            theme_schema=Theme.model_json_schema(),
        )
