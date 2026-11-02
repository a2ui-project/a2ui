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
} from './legacy_functions_api.js';
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

export {isSafeRegex, type SafeRegexOptions} from './safe_regex.js';
export * from './legacy_functions_api.js';

// Legacy arithmetic, comparison, and string functions. See
// `legacy_functions_api.ts` for why they are kept.
/**
 * Implementation of the legacy `add` function.
 *
 * @deprecated Define `add` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const AddImplementation = createFunctionImplementation(AddApi, args => args.a + args.b);
/**
 * Implementation of the legacy `subtract` function.
 *
 * @deprecated Define `subtract` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const SubtractImplementation = createFunctionImplementation(
  SubtractApi,
  args => args.a - args.b,
);
/**
 * Implementation of the legacy `multiply` function.
 *
 * @deprecated Define `multiply` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const MultiplyImplementation = createFunctionImplementation(
  MultiplyApi,
  args => args.a * args.b,
);
/**
 * Implementation of the legacy `divide` function.
 *
 * @deprecated Define `divide` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const DivideImplementation = createFunctionImplementation(DivideApi, args => {
  const numA = Number(args.a);
  const numB = Number(args.b);
  if (Number.isNaN(numA) || Number.isNaN(numB)) {
    return NaN;
  }
  if (numB === 0) {
    return Infinity;
  }
  return numA / numB;
});

/**
 * Implementation of the legacy `equals` function.
 *
 * @deprecated Define `equals` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const EqualsImplementation = createFunctionImplementation(
  EqualsApi,
  args => args.a === args.b,
);
/**
 * Implementation of the legacy `not_equals` function.
 *
 * @deprecated Define `not_equals` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const NotEqualsImplementation = createFunctionImplementation(
  NotEqualsApi,
  args => args.a !== args.b,
);
/**
 * Implementation of the legacy `greater_than` function.
 *
 * @deprecated Define `greater_than` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const GreaterThanImplementation = createFunctionImplementation(
  GreaterThanApi,
  args => args.a > args.b,
);
/**
 * Implementation of the legacy `less_than` function.
 *
 * @deprecated Define `less_than` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const LessThanImplementation = createFunctionImplementation(
  LessThanApi,
  args => args.a < args.b,
);

/**
 * Implementation of the legacy `contains` function.
 *
 * @deprecated Define `contains` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const ContainsImplementation = createFunctionImplementation(ContainsApi, args =>
  args.string.includes(args.substring),
);
/**
 * Implementation of the legacy `starts_with` function.
 *
 * @deprecated Define `starts_with` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const StartsWithImplementation = createFunctionImplementation(StartsWithApi, args =>
  args.string.startsWith(args.prefix),
);
/**
 * Implementation of the legacy `ends_with` function.
 *
 * @deprecated Define `ends_with` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const EndsWithImplementation = createFunctionImplementation(EndsWithApi, args =>
  args.string.endsWith(args.suffix),
);

/**
 * The legacy function implementations, in the order `@a2ui/web_core` 0.9.x
 * listed them.
 *
 * @deprecated See `legacy_functions_api.ts`.
 */
export const LEGACY_V09_FUNCTIONS: FunctionImplementation[] = [
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
];

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
 * Creates the function implementations defined by the published v0.9 basic
 * catalog document.
 *
 * @param options Configuration options containing optional locale.
 * @returns Array of function implementations.
 */
export function createV09SpecFunctions(options?: {locale?: string}): FunctionImplementation[] {
  const locale = options?.locale;
  return [
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
    AndImplementation,
    OrImplementation,
    NotImplementation,
  ];
}

/**
 * Function implementations defined by the published v0.9 basic catalog
 * document. This is what `basicCatalog` registers.
 */
export const V09_SPEC_FUNCTIONS: FunctionImplementation[] = createV09SpecFunctions();

/**
 * Creates standard function implementations for the Basic Catalog.
 *
 * Includes the legacy functions of `@a2ui/web_core` 0.9.x ahead of the ones
 * the v0.9 specification defines, so a catalog composed from this list
 * behaves as it did before 1.0. The legacy entries are deprecated; a catalog
 * that should match the published document uses {@link createV09SpecFunctions}.
 *
 * @param options Configuration options containing optional locale.
 * @returns Array of function implementations.
 */
export function createBasicCatalogFunctions(options?: {locale?: string}): FunctionImplementation[] {
  return [...LEGACY_V09_FUNCTIONS, ...createV09SpecFunctions(options)];
}

/**
 * Standard function implementations for the Basic Catalog.
 *
 * Includes arithmetic, comparison, string, logical, validation, formatting,
 * and action functions. The arithmetic, comparison, and string entries are
 * the deprecated legacy functions of 0.9.x; {@link V09_SPEC_FUNCTIONS} holds
 * only the functions the v0.9 specification defines.
 */
export const BASIC_FUNCTIONS: FunctionImplementation[] = createBasicCatalogFunctions();
