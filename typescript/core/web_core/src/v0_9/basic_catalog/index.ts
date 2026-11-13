/*
 * Copyright 2024 Google LLC
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

export {
  A2uiAudioPlayer,
  A2uiButton,
  A2uiCard,
  A2uiCheckBox,
  A2uiChoicePicker,
  A2uiColumn,
  A2uiDateTimeInput,
  A2uiDivider,
  A2uiIcon,
  A2uiImage,
  A2uiList,
  A2uiModal,
  A2uiRow,
  A2uiSlider,
  A2uiTabs,
  A2uiText,
  A2uiTextField,
  A2uiVideo,
  BASIC_COMPONENTS,
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
} from './components/index.js';
export {basicCatalog} from './catalog.js';
export {
  MAX_EXPRESSION_TEMPLATE_LENGTH,
  MAX_EXPRESSION_PARTS,
  ExpressionParser,
} from '../../expressions/expression_parser.js';
export {
  createFormatNumberImplementation,
  createFormatCurrencyImplementation,
  createFormatDateImplementation,
  createPluralizeImplementation,
  createV09SpecFunctions,
  createBasicCatalogFunctions,
  isSafeRegex,
  type SafeRegexOptions,
  AddImplementation,
  SubtractImplementation,
  MultiplyImplementation,
  DivideImplementation,
  EqualsImplementation,
  NotEqualsImplementation,
  GreaterThanImplementation,
  LessThanImplementation,
  ContainsImplementation,
  StartsWithImplementation,
  EndsWithImplementation,
  LEGACY_V09_FUNCTIONS,
  AndImplementation,
  OrImplementation,
  NotImplementation,
  RequiredImplementation,
  RegexImplementation,
  LengthImplementation,
  NumericImplementation,
  EmailImplementation,
  FormatStringImplementation,
  FormatNumberImplementation,
  FormatCurrencyImplementation,
  FormatDateImplementation,
  PluralizeImplementation,
  OpenUrlImplementation,
  V09_SPEC_FUNCTIONS,
  BASIC_FUNCTIONS,
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
  LEGACY_V09_FUNCTION_APIS,
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
  V09_SPEC_FUNCTION_APIS,
} from './functions/basic_functions_api.js';
export {
  isValidCssColor,
  HEX_COLOR_REGEX,
  BasicCatalogThemeSchema,
  type BasicCatalogTheme,
} from '../../universal/basic_catalog/theme.js';
export {
  injectBasicCatalogStyles,
  computeColorVariant,
} from '../../universal/basic_catalog/styles/default.js';
export type {
  ColorVariantLightDarkOptions,
  ColorVariantHoverOptions,
} from '../../universal/basic_catalog/styles/default.js';
export {Context} from '../../universal/basic_catalog/context/context.js';
export type {
  MarkdownRenderer,
  MarkdownRendererOptions,
  MarkdownRendererTagClassMap,
} from '../../universal/basic_catalog/context/markdown.js';
export {
  markdown,
  setMarkdownRenderer,
  getMarkdownRenderer,
} from '../../universal/basic_catalog/directives/directives.js';

/**
 * The theme schema for the basic catalog.
 *
 * Alias of {@link BasicCatalogThemeSchema}, kept for callers that refer to the
 * schema by the version-neutral `ThemeSchema` name.
 */
export {BasicCatalogThemeSchema as ThemeSchema} from '../../universal/basic_catalog/theme.js';
