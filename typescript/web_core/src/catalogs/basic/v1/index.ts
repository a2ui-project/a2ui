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

export * from './components/index.js';
export * from './functions/basic_functions.js';
export * from './functions/basic_functions_api.js';
export * from './catalog.js';
export * from '../../../universal/basic_catalog/theme.js';
export {
  injectBasicCatalogStyles,
  computeColorVariant,
} from '../../../universal/basic_catalog/styles/default.js';
export type {
  ColorVariantLightDarkOptions,
  ColorVariantHoverOptions,
} from '../../../universal/basic_catalog/styles/default.js';
export {Context} from '../../../universal/basic_catalog/context/context.js';
export {
  markdown,
  setMarkdownRenderer,
  getMarkdownRenderer,
  type MarkdownRenderer,
  type MarkdownRendererOptions,
} from '../../../universal/basic_catalog/index.js';
export {BasicCatalogThemeSchema as ThemeSchema} from '../../../universal/basic_catalog/theme.js';
