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
 *
 * Until now `v1_0/basic_catalog/` shipped argument schemas without bodies, so
 * any v1.0 payload calling `formatCurrency`, `pluralize`, `and` and friends
 * resolved to `undefined`. This module supplies those bodies and assembles the
 * complete v1.0 function set.
 *
 * Semantics follow the Python reference implementation in
 * `a2ui/core/basic_catalog/v1_0/function_impls.py` so that the two engines
 * agree case for case. Two choices are worth calling out:
 *
 * - `formatDate` expands TR35 tokens directly rather than delegating to
 *   `date-fns`. Token expansion reads the timestamp in the offset it was
 *   written with, so output does not depend on the host time zone.
 * - `formatNumber`, `formatCurrency` and `pluralize` use `Intl` with an
 *   explicit `en-US` default rather than the ambient locale, so output does
 *   not depend on the host locale either. Python reaches the same results for
 *   `en-US` through its own locale table.
 */

import {ExpressionParser} from '../../../expressions/expression_parser.js';
import {computed, isSignal, getValue} from '../../../reactivity/signals.js';
import {createFunctionImplementation, FunctionImplementation} from '../../../catalog/types.js';
import {A2uiExpressionError} from '../../../errors.js';
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

/**
 * Locale used when a catalog is built without an explicit one.
 *
 * Pinned rather than left to the host so that formatting output is identical
 * on every machine and matches the Python reference.
 */
const DEFAULT_LOCALE = 'en-US';

/**
 * Coerces a value to a string following the protocol type conversion rules.
 *
 * - Numbers and booleans: standard string representation.
 * - `null` and `undefined`: an empty string.
 * - Objects and arrays: stringified as compact JSON.
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

// Logical

/**
 * Evaluates logical AND across an array of values.
 *
 * Returns true when every value in the array is truthy.
 */
export const AndImplementation = createFunctionImplementation(AndApi, args => {
  return args.values.every((v: unknown) => !!v);
});

/**
 * Evaluates logical OR across an array of values.
 *
 * Returns true when at least one value in the array is truthy.
 */
export const OrImplementation = createFunctionImplementation(OrApi, args => {
  return args.values.some((v: unknown) => !!v);
});

/**
 * Evaluates logical NOT on a single value.
 */
export const NotImplementation = createFunctionImplementation(NotApi, args => !args.value);

// Formatting

/**
 * Formats a template string by resolving embedded expressions against dynamic
 * context.
 *
 * Returns a computed signal so the result updates when a referenced signal
 * changes.
 */
export const FormatStringImplementation = createFunctionImplementation(
  FormatStringApi,
  (args, context) => {
    const parser = new ExpressionParser();
    const parts = parser.parse(args.value);

    if (parts.length === 0) return '';

    const dynamicParts = parts.map(part => {
      // Literals pass through; only expression nodes need resolving.
      if (typeof part !== 'object' || part === null || Array.isArray(part)) {
        return part;
      }
      return context.resolveSignal(part);
    });

    return computed(() => {
      return dynamicParts.map(p => coerceToString(isSignal(p) ? getValue(p) : p)).join('');
    });
  },
);

const numberFormatCache = new Map<string, Intl.NumberFormat>();

function getNumberFormat(locale: string, decimals?: number, grouping?: boolean): Intl.NumberFormat {
  const key = `${locale}:${decimals ?? 'undef'}:${grouping ?? 'true'}`;
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
 * @param locale Optional BCP 47 language tag. Defaults to `en-US`.
 * @returns The function implementation.
 */
export function createFormatNumberImplementation(locale?: string): FunctionImplementation {
  const resolvedLocale = locale ?? DEFAULT_LOCALE;
  return createFunctionImplementation(FormatNumberApi, args => {
    if (isNaN(args.value)) return '';
    return getNumberFormat(resolvedLocale, args.decimals, args.grouping).format(args.value);
  });
}

/**
 * Formats a number with the configured grouping and decimal precision.
 */
export const FormatNumberImplementation = createFormatNumberImplementation();

const currencyFormatCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormat(
  locale: string,
  currency: string,
  decimals?: number,
  grouping?: boolean,
): Intl.NumberFormat {
  const key = `${locale}:${currency}:${decimals ?? 'undef'}:${grouping ?? 'true'}`;
  let formatter = currencyFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    });
    currencyFormatCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Creates the currency formatting function implementation for a specific
 * locale.
 *
 * @param locale Optional BCP 47 language tag. Defaults to `en-US`.
 * @returns The function implementation.
 */
export function createFormatCurrencyImplementation(locale?: string): FunctionImplementation {
  const resolvedLocale = locale ?? DEFAULT_LOCALE;
  return createFunctionImplementation(FormatCurrencyApi, args => {
    if (isNaN(args.value)) return '';
    const currency = String(args.currency).toUpperCase();
    const decimals = args.decimals ?? 2;
    try {
      return getCurrencyFormat(resolvedLocale, currency, decimals, args.grouping).format(
        args.value,
      );
    } catch {
      // An unrecognised ISO 4217 code makes Intl throw. Fall back to the code
      // itself as the symbol, which is what Python's table does.
      const amount = getNumberFormat(resolvedLocale, decimals, args.grouping).format(args.value);
      return `${currency} ${amount}`;
    }
  });
}

/**
 * Formats a number as currency.
 */
export const FormatCurrencyImplementation = createFormatCurrencyImplementation();

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_SHORT = MONTHS_LONG.map(m => m.slice(0, 3));
const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const WEEKDAYS_SHORT = WEEKDAYS_LONG.map(d => d.slice(0, 3));

const DATE_TOKENS = /yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a/g;
const ISO_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parses an ISO 8601 timestamp and shifts it so that UTC accessors report the
 * wall-clock fields the timestamp was written with.
 *
 * A timestamp carrying an offset keeps that offset's local fields. A timestamp
 * with no offset is read literally, matching Python's handling of naive
 * `datetime` values. Either way the result is independent of the host time
 * zone.
 *
 * @param value The timestamp to parse.
 * @returns The shifted date and the original instant, or null if unparseable.
 */
function parseTimestamp(value: string): {shifted: Date; instant: Date} | null {
  const hasOffset = ISO_OFFSET.test(value);
  const instant = new Date(hasOffset ? value : `${value}Z`);
  if (isNaN(instant.getTime())) return null;

  let offsetMinutes = 0;
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(value);
  if (match) {
    const sign = match[1] === '-' ? -1 : 1;
    offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3]));
  }
  return {shifted: new Date(instant.getTime() + offsetMinutes * 60_000), instant};
}

/**
 * Creates the date formatting function implementation for a specific locale.
 *
 * @param locale Optional BCP 47 language tag. Reserved for future month and
 *   weekday name tables; only `en-US` names are currently available.
 * @returns The function implementation.
 */
export function createFormatDateImplementation(locale?: string): FunctionImplementation {
  void locale;
  return createFunctionImplementation(FormatDateApi, args => {
    if (!args.value) return '';
    const parsed = parseTimestamp(String(args.value));
    if (!parsed) return '';

    const {shifted, instant} = parsed;
    const pattern = args.format ? String(args.format) : 'yyyy-MM-dd';
    if (pattern === 'ISO') return instant.toISOString();

    // Monday-based to match the Python reference, which uses date.weekday().
    const weekdayIndex = (shifted.getUTCDay() + 6) % 7;
    const hours = shifted.getUTCHours();
    const hours12 = hours % 12 || 12;

    return pattern.replace(DATE_TOKENS, (token: string) => {
      switch (token) {
        case 'yyyy':
          return String(shifted.getUTCFullYear());
        case 'yy':
          return String(shifted.getUTCFullYear()).slice(-2);
        case 'MMMM':
          return MONTHS_LONG[shifted.getUTCMonth()];
        case 'MMM':
          return MONTHS_SHORT[shifted.getUTCMonth()];
        case 'MM':
          return String(shifted.getUTCMonth() + 1).padStart(2, '0');
        case 'M':
          return String(shifted.getUTCMonth() + 1);
        case 'EEEE':
          return WEEKDAYS_LONG[weekdayIndex];
        case 'E':
          return WEEKDAYS_SHORT[weekdayIndex];
        case 'dd':
          return String(shifted.getUTCDate()).padStart(2, '0');
        case 'd':
          return String(shifted.getUTCDate());
        case 'HH':
          return String(hours).padStart(2, '0');
        case 'H':
          return String(hours);
        case 'hh':
          return String(hours12).padStart(2, '0');
        case 'h':
          return String(hours12);
        case 'mm':
          return String(shifted.getUTCMinutes()).padStart(2, '0');
        case 'ss':
          return String(shifted.getUTCSeconds()).padStart(2, '0');
        case 'a':
          return hours < 12 ? 'AM' : 'PM';
        default:
          return token;
      }
    });
  });
}

/**
 * Formats a timestamp using TR35 pattern tokens, or emits an ISO timestamp.
 */
export const FormatDateImplementation = createFormatDateImplementation();

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/**
 * Creates the pluralization function implementation for a specific locale.
 *
 * Explicit `zero`, `one` and `two` arguments take precedence over the locale's
 * CLDR category for the matching quantity, so a caller can special-case those
 * counts in a locale whose rules would otherwise select `other`.
 *
 * @param locale Optional BCP 47 language tag. Defaults to `en-US`.
 * @returns The function implementation.
 */
export function createPluralizeImplementation(locale?: string): FunctionImplementation {
  const resolvedLocale = locale ?? DEFAULT_LOCALE;
  return createFunctionImplementation(PluralizeApi, args => {
    const all = args as Record<string, unknown>;
    const value = args.value;

    let category: string;
    if (value === 0 && all['zero'] !== undefined) category = 'zero';
    else if (value === 1 && all['one'] !== undefined) category = 'one';
    else if (value === 2 && all['two'] !== undefined) category = 'two';
    else category = getPluralRules(resolvedLocale).select(value);

    return String(all[category] ?? all['other'] ?? '');
  });
}

/**
 * Selects the appropriate plural form for a quantity.
 */
export const PluralizeImplementation = createPluralizeImplementation();

// Actions

/**
 * Opens a specified URL in a new browser tab.
 *
 * @throws {A2uiExpressionError} If the URL is invalid or uses an unsupported
 *   scheme.
 */
export const OpenUrlImplementation = createFunctionImplementation(OpenUrlApi, args => {
  const target = typeof args.url === 'string' ? args.url : undefined;
  if (!target || typeof window === 'undefined' || !window.open) return;

  const baseHref =
    typeof window.location !== 'undefined' && window.location.href
      ? window.location.href
      : undefined;

  let url: URL;
  try {
    url = baseHref ? new URL(target, baseHref) : new URL(target);
  } catch (e) {
    throw new A2uiExpressionError(`Invalid URL specified: ${target}`, 'openUrl', e);
  }

  // Strict protocol allowlist: only HTTP and HTTPS are permitted.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new A2uiExpressionError(`Unsupported URL scheme: ${url.protocol}`, 'openUrl');
  }

  // Always use noopener and noreferrer to prevent reverse tab-nabbing.
  window.open(url.href, '_blank', 'noopener,noreferrer');
});

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

/**
 * Standard function implementations for the v1.0 basic catalog.
 */
export const BASIC_FUNCTIONS: FunctionImplementation[] = createBasicCatalogFunctions();
