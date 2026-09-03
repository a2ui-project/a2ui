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

import {ExpressionParser} from '../../../expressions/expression_parser.js';
import {computed, isSignal, getValue} from '../../../reactivity/signals.js';
import {createFunctionImplementation, FunctionImplementation} from '../../../catalog/types.js';
import {format} from 'date-fns';
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
import {A2uiExpressionError} from '../../../errors.js';

// Logical
/**
 * Evaluates logical AND across an array of values.
 *
 * Returns true if all values in the array are truthy.
 */
export const AndImplementation = createFunctionImplementation(AndApi, args => {
  return args.values.every((v: unknown) => !!v);
});
/**
 * Evaluates logical OR across an array of values.
 *
 * Returns true if at least one value in the array is truthy.
 */
export const OrImplementation = createFunctionImplementation(OrApi, args => {
  return args.values.some((v: unknown) => !!v);
});
/**
 * Evaluates logical NOT on a single value.
 *
 * Returns the negation of the value.
 */
export const NotImplementation = createFunctionImplementation(NotApi, args => !args.value);

// Validation
/**
 * Validates that a value is present and non-empty.
 *
 * Checks that the value is not null, undefined, an empty string, or an empty array.
 */
export const RequiredImplementation = createFunctionImplementation(RequiredApi, args => {
  const val = args.value;
  if (val === null || val === undefined) return false;
  if (typeof val === 'string' && val === '') return false;
  if (Array.isArray(val) && val.length === 0) return false;
  return true;
});
/**
 * Validates that a string value matches a regular expression pattern.
 *
 * @throws {A2uiExpressionError} If the pattern is invalid.
 */
export const RegexImplementation = createFunctionImplementation(RegexApi, args => {
  try {
    return new RegExp(args.pattern).test(args.value);
  } catch (e) {
    throw new A2uiExpressionError(`Invalid regex pattern: ${args.pattern}`, 'regex', e);
  }
});
/**
 * Validates that string or array length falls within an optional minimum and maximum range.
 */
export const LengthImplementation = createFunctionImplementation(LengthApi, args => {
  const val = args.value;
  let len = 0;
  if (typeof val === 'string' || Array.isArray(val)) {
    len = val.length;
  }
  if (args.min !== undefined && !isNaN(args.min) && len < args.min) return false;
  if (args.max !== undefined && !isNaN(args.max) && len > args.max) return false;
  return true;
});
/**
 * Validates that a numeric value falls within an optional minimum and maximum range.
 */
export const NumericImplementation = createFunctionImplementation(NumericApi, args => {
  if (isNaN(args.value)) return false;
  if (args.min !== undefined && !isNaN(args.min) && args.value < args.min) return false;
  if (args.max !== undefined && !isNaN(args.max) && args.value > args.max) return false;
  return true;
});
/**
 * Validates that a string matches basic email address syntax.
 */
export const EmailImplementation = createFunctionImplementation(EmailApi, args => {
  // TODO(gspencergoog): Use a "real" email validation function, preferably
  // from an existing package. This is woefully insufficient, real email
  // validation can't be done with a regex.
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(args.value);
});

// Formatting
/**
 * Coerces a value to a string following the protocol type conversion rules.
 *
 * - Numbers and Booleans: Standard string representation.
 * - `null` and `undefined`: An empty string `""`.
 * - Objects and Arrays: Stringified as JSON.
 *
 * @param value The value to coerce.
 * @returns The string representation.
 */
function coerceToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Formats a template string by resolving embedded expressions against dynamic context.
 *
 * Parses a template string and resolves any embedded expressions using the provided context.
 * Returns a computed signal that updates when referenced signals change.
 */
export const FormatStringImplementation = createFunctionImplementation(
  FormatStringApi,
  (args, context) => {
    const template = args.value;
    const parser = new ExpressionParser();
    const parts = parser.parse(template);

    if (parts.length === 0) return '';

    const dynamicParts = parts.map(part => {
      // If it's a literal string (or number/boolean/etc), keep it as is
      if (typeof part !== 'object' || part === null || Array.isArray(part)) {
        return part;
      }
      return context.resolveSignal(part);
    });

    return computed(() => {
      return dynamicParts
        .map(p => {
          const resolved = isSignal(p) ? getValue(p) : p;
          return coerceToString(resolved);
        })
        .join('');
    });
  },
);
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function getNumberFormat(
  locale: string | undefined,
  decimals?: number,
  grouping?: boolean,
): Intl.NumberFormat {
  const key = `${locale ?? 'default'}:${decimals ?? 'undef'}:${grouping ?? 'true'}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    });
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Creates the number formatting function implementation for a specific locale.
 *
 * @param locale Optional BCP 47 language tag.
 * @returns The function implementation.
 */
export function createFormatNumberImplementation(locale?: string): FunctionImplementation {
  return createFunctionImplementation(FormatNumberApi, args => {
    if (isNaN(args.value)) return '';
    try {
      return getNumberFormat(locale, args.decimals, args.grouping).format(args.value);
    } catch (e) {
      console.warn('Error formatting number:', e);
      return args.decimals !== undefined ? args.value.toFixed(args.decimals) : String(args.value);
    }
  });
}

/**
 * Formats a number using `Intl.NumberFormat` with specified decimals and grouping.
 */
export const FormatNumberImplementation = createFormatNumberImplementation();

const currencyFormatCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormat(
  locale: string | undefined,
  currency: string,
  decimals?: number,
  grouping?: boolean,
): Intl.NumberFormat {
  const key = `${locale ?? 'default'}:${currency}:${decimals ?? 'undef'}:${grouping ?? 'true'}`;
  let formatter = currencyFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    });
    currencyFormatCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Creates the currency formatting function implementation for a specific locale.
 *
 * @param locale Optional BCP 47 language tag.
 * @returns The function implementation.
 */
export function createFormatCurrencyImplementation(locale?: string): FunctionImplementation {
  return createFunctionImplementation(FormatCurrencyApi, args => {
    if (isNaN(args.value)) return '';
    try {
      return getCurrencyFormat(locale, args.currency, args.decimals, args.grouping).format(
        args.value,
      );
    } catch (e) {
      console.warn('Error formatting currency:', e);
      return args.value.toFixed(args.decimals ?? 2);
    }
  });
}

/**
 * Formats a number as currency using `Intl.NumberFormat`.
 *
 * Falls back to fixed decimal notation if formatting fails.
 */
export const FormatCurrencyImplementation = createFormatCurrencyImplementation();
/**
 * Formats a date using date-fns pattern string or returns an ISO timestamp.
 */
export const FormatDateImplementation = createFunctionImplementation(FormatDateApi, args => {
  if (!args.value) return '';
  const date = new Date(args.value as string | number | Date);
  if (isNaN(date.getTime())) return '';

  try {
    if (args.format === 'ISO') return date.toISOString();
    return format(date, args.format);
  } catch (e) {
    console.warn('Error formatting date:', e);
    return date.toISOString();
  }
});
const pluralRulesCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale: string | undefined): Intl.PluralRules {
  const key = locale ?? 'default';
  let rules = pluralRulesCache.get(key);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(key, rules);
  }
  return rules;
}

/**
 * Creates the pluralization function implementation for a specific locale.
 *
 * @param locale Optional BCP 47 language tag.
 * @returns The function implementation.
 */
export function createPluralizeImplementation(locale?: string): FunctionImplementation {
  return createFunctionImplementation(PluralizeApi, args => {
    try {
      const rule = getPluralRules(locale).select(args.value);
      return String((args as Record<string, unknown>)[rule] ?? args.other ?? '');
    } catch (e) {
      console.warn('Error in pluralize:', e);
      return String(args.other ?? '');
    }
  });
}

/**
 * Selects the appropriate plural form based on a quantity using `Intl.PluralRules`.
 */
export const PluralizeImplementation = createPluralizeImplementation();

// Actions
/**
 * Opens a specified URL in a new browser tab.
 *
 * @throws {A2uiExpressionError} If the URL is invalid or uses an unsupported scheme.
 */
export const OpenUrlImplementation = createFunctionImplementation(OpenUrlApi, args => {
  if (args.url && typeof window !== 'undefined' && window.open) {
    const baseHref =
      typeof window.location !== 'undefined' && window.location.href
        ? window.location.href
        : undefined;

    let url: URL;
    try {
      url = baseHref ? new URL(args.url, baseHref) : new URL(args.url);
    } catch (e: any) {
      throw new A2uiExpressionError(`Invalid URL specified: ${args.url}`, 'openUrl', e);
    }

    // Strict protocol allowlist: Only HTTP and HTTPS are permitted.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new A2uiExpressionError(`Unsupported URL scheme: ${url.protocol}`, 'openUrl');
    }

    // Always use noopener and noreferrer to prevent reverse tab-nabbing
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
});

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
    FormatDateImplementation,
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
