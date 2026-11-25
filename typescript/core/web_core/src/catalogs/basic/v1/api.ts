/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The v1 basic catalog's component APIs, functions and theme schema, without
// the Lit custom elements. Renderers that do not run in a browser (React
// Native, server-side validation) import this entry, because './index.js'
// re-exports the custom elements and Lit's browser build defines classes that
// extend HTMLElement as soon as it loads.

export {
  AudioPlayerApi,
  ButtonApi,
  CardApi,
  CheckBoxApi,
  ChoicePickerApi,
  ColumnApi,
  DateTimeInputApi,
  DividerApi,
  IconApi,
  ImageApi,
  ListApi,
  ModalApi,
  RowApi,
  SliderApi,
  TabsApi,
  TextApi,
  TextFieldApi,
  VideoApi,
  WeightSchema,
  BASIC_COMPONENTS,
  BASIC_CATALOG_DOCUMENT_OPTIONS,
} from './components/basic_components.js';
export {
  BASIC_FUNCTIONS,
  createBasicCatalogFunctions,
  AndImplementation,
  OrImplementation,
  NotImplementation,
  FormatStringImplementation,
  FormatNumberImplementation,
  createFormatNumberImplementation,
  FormatCurrencyImplementation,
  createFormatCurrencyImplementation,
  FormatDateImplementation,
  createFormatDateImplementation,
  PluralizeImplementation,
  createPluralizeImplementation,
  OpenUrlImplementation,
} from './functions/basic_functions.js';
export {
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
  BASIC_FUNCTION_APIS,
  V10_SPEC_FUNCTION_APIS,
} from './functions/basic_functions_api.js';
export {
  BasicCatalogThemeSchema,
  BasicCatalogThemeSchema as ThemeSchema,
  type BasicCatalogTheme,
  isValidCssColor,
} from '../../../universal/basic_catalog/theme.js';
