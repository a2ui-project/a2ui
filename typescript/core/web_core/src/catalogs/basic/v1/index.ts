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
  BASIC_CATALOG_ID,
  BASIC_CATALOG_DOCUMENT,
  createBasicCatalog,
  loadBasicCatalogApi,
  type BasicCatalog,
} from './catalog.js';
export {BASIC_CATALOG_ELEMENTS} from '../elements.js';
export type {
  Weight,
  TextProps,
  ImageProps,
  IconProps,
  VideoProps,
  AudioPlayerProps,
  RowProps,
  ColumnProps,
  ListProps,
  CardProps,
  TabsProps,
  ModalProps,
  DividerProps,
  ButtonProps,
  TextFieldProps,
  CheckBoxProps,
  ChoicePickerProps,
  SliderProps,
  DateTimeInputProps,
  BasicCatalogProps,
} from './generated-types.js';
export {
  createBasicCatalogFunctions,
  type BasicFunctionOptions,
} from './functions/basic_functions.js';
export {
  BasicCatalogThemeSchema,
  BasicCatalogThemeSchema as ThemeSchema,
  type BasicCatalogTheme,
  isValidCssColor,
} from '../../../universal/basic_catalog/theme.js';
export {
  injectBasicCatalogStyles,
  computeColorVariant,
} from '../../../universal/basic_catalog/styles/default.js';
export type {
  ColorVariantLightDarkOptions,
  ColorVariantHoverOptions,
} from '../../../universal/basic_catalog/styles/default.js';
export {Context} from '../../../universal/basic_catalog/context/context.js';
export type {
  MarkdownRenderer,
  MarkdownRendererOptions,
  MarkdownRendererTagClassMap,
} from '../../../universal/basic_catalog/context/markdown.js';
export {
  markdown,
  setMarkdownRenderer,
  getMarkdownRenderer,
} from '../../../universal/basic_catalog/directives/directives.js';
