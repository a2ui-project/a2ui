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

/**
 * Function implementations for the v1.0 basic catalog.
 */

import {FunctionImplementation} from '../../../catalog/types.js';
import {V10_VALIDATION_FUNCTION_IMPLEMENTATIONS} from '../../functions/validation_functions.js';
import {IndexImplementation} from '../../functions/system_functions.js';
import {
  AndApi,
  OrApi,
  NotApi,
  FormatStringApi,
  FormatNumberApi,
  FormatCurrencyApi,
  FormatDateApi,
  PluralizeApi,
  OpenUrlApi,
} from './basic_functions_api.js';
import {
  createAndImplementation,
  createOrImplementation,
  createNotImplementation,
  createFormatStringImplementation,
  createFormatNumberImplementation as createCommonFormatNumber,
  createFormatCurrencyImplementation as createCommonFormatCurrency,
  createFormatDateImplementation as createCommonFormatDate,
  createPluralizeImplementation as createCommonPluralize,
  createOpenUrlImplementation,
} from '../../../common/basic_functions.js';

// Logical
export const AndImplementation = createAndImplementation(AndApi);
export const OrImplementation = createOrImplementation(OrApi);
export const NotImplementation = createNotImplementation(NotApi);

// Formatting
export const FormatStringImplementation = createFormatStringImplementation(FormatStringApi);

export function createFormatNumberImplementation(locale?: string): FunctionImplementation {
  return createCommonFormatNumber(FormatNumberApi, locale);
}
export const FormatNumberImplementation = createFormatNumberImplementation();

export function createFormatCurrencyImplementation(locale?: string): FunctionImplementation {
  return createCommonFormatCurrency(FormatCurrencyApi, locale);
}
export const FormatCurrencyImplementation = createFormatCurrencyImplementation();

export function createFormatDateImplementation(locale?: string): FunctionImplementation {
  return createCommonFormatDate(FormatDateApi, locale);
}
export const FormatDateImplementation = createFormatDateImplementation();

export function createPluralizeImplementation(locale?: string): FunctionImplementation {
  return createCommonPluralize(PluralizeApi, locale);
}
export const PluralizeImplementation = createPluralizeImplementation();

// Actions
export const OpenUrlImplementation = createOpenUrlImplementation(OpenUrlApi);

/**
 * Creates the complete function set for a v1.0 basic catalog.
 *
 * The set matches the functions declared in
 * `specification/v1_0/catalogs/basic/catalog.json`, plus the `@index` system
 * function, which the `@` namespace makes available to every catalog.
 *
 * @param options Configuration options containing an optional locale.
 * @returns Array of function implementations.
 */
export function createBasicCatalogFunctions(options?: {locale?: string}): FunctionImplementation[] {
  const locale = options?.locale;
  return [
    ...V10_VALIDATION_FUNCTION_IMPLEMENTATIONS,
    IndexImplementation,
    FormatStringImplementation,
    createFormatNumberImplementation(locale),
    createFormatCurrencyImplementation(locale),
    createFormatDateImplementation(locale),
    createPluralizeImplementation(locale),
    OpenUrlImplementation,
    AndImplementation,
    OrImplementation,
    NotImplementation,
  ];
}

/** Standard function implementations for the v1.0 basic catalog. */
export const BASIC_FUNCTIONS: FunctionImplementation[] = createBasicCatalogFunctions();
