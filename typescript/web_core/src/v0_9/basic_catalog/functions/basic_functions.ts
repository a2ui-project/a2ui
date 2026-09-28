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
 * Function implementations for the v0.9 basic catalog.
 */

import {createFunctionImplementation, FunctionImplementation} from '../../../catalog/types.js';
import {
  AndApi,
  OrApi,
  NotApi,
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
  validateRequired,
  validateRegex,
  validateLength,
  validateNumeric,
  validateEmail,
} from '../../../common/basic_functions.js';

// Logical
export const AndImplementation = createAndImplementation(AndApi);
export const OrImplementation = createOrImplementation(OrApi);
export const NotImplementation = createNotImplementation(NotApi);

// Validation
export const RequiredImplementation = createFunctionImplementation(
  RequiredApi,
  args => validateRequired(args.value).valid,
);

export const RegexImplementation = createFunctionImplementation(
  RegexApi,
  args => validateRegex(args.value, args.pattern).valid,
);

export const LengthImplementation = createFunctionImplementation(
  LengthApi,
  args => validateLength(args.value, args.min, args.max).valid,
);

export const NumericImplementation = createFunctionImplementation(
  NumericApi,
  args => validateNumeric(args.value, args.min, args.max).valid,
);

export const EmailImplementation = createFunctionImplementation(
  EmailApi,
  args => validateEmail(args.value).valid,
);

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
 * Creates standard function implementations for the Basic Catalog.
 *
 * @param options Configuration options containing optional locale.
 * @returns Array of function implementations.
 */
export function createBasicCatalogFunctions(options?: {locale?: string}): FunctionImplementation[] {
  const locale = options?.locale;
  return [
    AndImplementation,
    OrImplementation,
    NotImplementation,
    RequiredImplementation,
    RegexImplementation,
    LengthImplementation,
    NumericImplementation,
    EmailImplementation,
    FormatStringImplementation,
    createFormatNumberImplementation(locale),
    createFormatCurrencyImplementation(locale),
    createFormatDateImplementation(locale),
    createPluralizeImplementation(locale),
    OpenUrlImplementation,
  ];
}

/**
 * Standard function implementations for the Basic Catalog.
 *
 * Includes logical, validation, formatting, and action functions.
 */
export const BASIC_FUNCTIONS: FunctionImplementation[] = createBasicCatalogFunctions();
