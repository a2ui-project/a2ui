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
 * Shared basic catalog function implementations and formatting helpers.
 *
 * Provides shared execution algorithms, caching layers, and implementation
 * factory functions consumed by all version-specific basic catalog definitions.
 */

import {ExpressionParser} from '../expressions/expression_parser.js';
import {computed, isSignal, getValue, Signal} from '../reactivity/signals.js';
import {createFunctionImplementation, FunctionImplementation} from '../catalog/types.js';
import {A2uiExpressionError} from '../errors.js';
import {DataContext} from '../resolution/data-context.js';

/**
 * Default BCP 47 locale used when a catalog is built without an explicit one.
 *
 * Pinned to en-US so formatting output is consistent across machines.
 */
export const DEFAULT_LOCALE = 'en-US';

/**
 * Resolves the locale tag a catalog was built with to one the formatters can use.
 *
 * Falls back to {@link DEFAULT_LOCALE} in three cases, each of which the Python
 * engine also falls back for:
 *
 * - No tag was supplied.
 * - The tag is malformed, such as `en_US`, which makes `Intl` throw a
 *   `RangeError` from every constructor it is handed to.
 * - The tag is well formed but no locale data matches it, such as `xx-YY`. Here
 *   `Intl` would silently format with the host's ambient locale, which this
 *   module promises never to depend on.
 *
 * @param locale Optional BCP 47 language tag.
 * @returns A tag `Intl` both accepts and has data for.
 */
export function resolveLocale(locale?: string): string {
  if (!locale) return DEFAULT_LOCALE;
  try {
    return Intl.NumberFormat.supportedLocalesOf(locale).length > 0 ? locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Standard validation result. */
export interface ValidationResult {
  /** Whether validation passed. */
  valid: boolean;
  /** Explanatory message when validation failed. */
  message?: string;
}

/**
 * Coerces a value to a string following protocol type conversion rules.
 *
 * - Numbers and booleans: standard string representation.
 * - `null` and `undefined`: an empty string `""`.
 * - Objects and arrays: stringified as compact JSON.
 *
 * @param value The value to coerce.
 * @returns The string representation.
 */
export function coerceToString(value: unknown): string {
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

// ---------------------------------------------------------------------------
// Validation Execution Helpers
// ---------------------------------------------------------------------------

/** Validates that a value is present and non-empty. */
export function validateRequired(val: unknown): ValidationResult {
  let isValid = true;
  if (val === null || val === undefined) isValid = false;
  else if (typeof val === 'string' && val === '') isValid = false;
  else if (Array.isArray(val) && val.length === 0) isValid = false;
  return {
    valid: isValid,
    ...(isValid ? {} : {message: 'This field is required.'}),
  };
}

/** Validates that a string value matches a regular expression pattern. */
export function validateRegex(val: unknown, pattern: string): ValidationResult {
  try {
    const isValid = new RegExp(pattern).test(String(val ?? ''));
    return {
      valid: isValid,
      ...(isValid ? {} : {message: 'Value does not match required pattern.'}),
    };
  } catch (e) {
    throw new A2uiExpressionError(`Invalid regex pattern: ${pattern}`, 'regex', e);
  }
}

/** Validates that string or array length falls within an optional range. */
export function validateLength(val: unknown, min?: number, max?: number): ValidationResult {
  let len = 0;
  if (typeof val === 'string' || Array.isArray(val)) {
    len = val.length;
  }
  let isValid = true;
  let message: string | undefined;

  if (min !== undefined && !isNaN(min) && len < min) {
    isValid = false;
    message = `Minimum length is ${min}.`;
  } else if (max !== undefined && !isNaN(max) && len > max) {
    isValid = false;
    message = `Maximum length is ${max}.`;
  }

  return {
    valid: isValid,
    ...(message ? {message} : {}),
  };
}

/** Validates that a numeric value falls within an optional range. */
export function validateNumeric(val: unknown, min?: number, max?: number): ValidationResult {
  const num = Number(val);
  if (isNaN(num)) {
    return {valid: false, message: 'Value must be a valid number.'};
  }
  let isValid = true;
  let message: string | undefined;

  if (min !== undefined && !isNaN(min) && num < min) {
    isValid = false;
    message = `Minimum value is ${min}.`;
  } else if (max !== undefined && !isNaN(max) && num > max) {
    isValid = false;
    message = `Maximum value is ${max}.`;
  }

  return {
    valid: isValid,
    ...(message ? {message} : {}),
  };
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Validates that a string matches basic email address syntax. */
export function validateEmail(val: unknown): ValidationResult {
  const isValid = typeof val === 'string' && EMAIL_REGEX.test(val);
  return {
    valid: isValid,
    ...(isValid ? {} : {message: 'Must be a valid email address.'}),
  };
}

// ---------------------------------------------------------------------------
// Formatting Caching & Helpers
// ---------------------------------------------------------------------------

const numberFormatCache = new Map<string, Intl.NumberFormat>();

export function getNumberFormat(
  locale: string,
  decimals?: number,
  grouping?: boolean,
): Intl.NumberFormat {
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

const currencyFormatCache = new Map<string, Intl.NumberFormat>();

export function getCurrencyFormat(
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
 * An assigned code, formatted only to discover where the locale places a
 * currency. Its own symbol is never shown.
 */
const PLACEHOLDER_CURRENCY = 'USD';

const currencyCodeFormatCache = new Map<string, Intl.NumberFormat>();

/**
 * Returns a formatter that renders the currency as its ISO code rather than as
 * a symbol, which makes the locale's placement and spacing observable through
 * `formatToParts`.
 */
export function getCurrencyCodeFormat(
  locale: string,
  decimals?: number,
  grouping?: boolean,
): Intl.NumberFormat {
  const key = `${locale}:${decimals ?? 'undef'}:${grouping ?? 'true'}`;
  let formatter = currencyCodeFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: PLACEHOLDER_CURRENCY,
      currencyDisplay: 'code',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    });
    currencyCodeFormatCache.set(key, formatter);
  }
  return formatter;
}

/** Month and weekday names for one locale, indexed for `formatDate`. */
export interface DateNames {
  /** Full month names, January first. */
  monthsLong: string[];
  /** Abbreviated month names, January first. */
  monthsShort: string[];
  /** Full weekday names, Monday first. */
  weekdaysLong: string[];
  /** Abbreviated weekday names, Monday first. */
  weekdaysShort: string[];
}

const dateNamesCache = new Map<string, DateNames>();

/** Builds month and weekday name tables for a locale using `Intl.DateTimeFormat`. */
export function getDateNames(locale: string): DateNames {
  let names = dateNamesCache.get(locale);
  if (!names) {
    const render = (options: Intl.DateTimeFormatOptions, dates: Date[]) => {
      const formatter = new Intl.DateTimeFormat(locale, {...options, timeZone: 'UTC'});
      return dates.map(d => formatter.format(d));
    };
    const months = Array.from({length: 12}, (_, i) => new Date(Date.UTC(2021, i, 15)));
    const weekdays = Array.from({length: 7}, (_, i) => new Date(Date.UTC(2021, 2, 1 + i)));
    names = {
      monthsLong: render({month: 'long'}, months),
      monthsShort: render({month: 'short'}, months),
      weekdaysLong: render({weekday: 'long'}, weekdays),
      weekdaysShort: render({weekday: 'short'}, weekdays),
    };
    dateNamesCache.set(locale, names);
  }
  return names;
}

export const DATE_TOKENS = /yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a/g;
export const ISO_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parses an ISO 8601 timestamp and shifts it so that UTC accessors report
 * the wall-clock fields the timestamp was written with.
 */
export function parseTimestamp(value: string): {shifted: Date; instant: Date} | null {
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

const pluralRulesCache = new Map<string, Intl.PluralRules>();

export function getPluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Execution Functions
// ---------------------------------------------------------------------------

/** Evaluates logical AND across an array of values. */
export function executeAnd(values: unknown[]): boolean {
  return Array.isArray(values) ? values.every(v => !!v) : false;
}

/** Evaluates logical OR across an array of values. */
export function executeOr(values: unknown[]): boolean {
  return Array.isArray(values) ? values.some(v => !!v) : false;
}

/** Evaluates logical NOT on a single value. */
export function executeNot(value: unknown): boolean {
  return !value;
}

/** Formats a template string by resolving embedded expressions. */
export function executeFormatString(
  template: string,
  context: DataContext,
): Signal<string> | string {
  const parser = new ExpressionParser();
  const parts = parser.parse(template);

  if (parts.length === 0) return '';

  const dynamicParts = parts.map(part => {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      return part;
    }
    return context.resolveSignal(part);
  });

  return computed(() => {
    return dynamicParts.map(p => coerceToString(isSignal(p) ? getValue(p) : p)).join('');
  });
}

/** Formats a number with configured precision and grouping. */
export function executeFormatNumber(
  value: number,
  decimals?: number,
  grouping?: boolean,
  locale: string = DEFAULT_LOCALE,
): string {
  if (isNaN(value)) return '';
  return getNumberFormat(locale, decimals, grouping).format(value);
}

/** Formats a number as currency. */
export function executeFormatCurrency(
  value: number,
  currencyInput: string,
  decimals: number = 2,
  grouping?: boolean,
  locale: string = DEFAULT_LOCALE,
): string {
  if (isNaN(value)) return '';
  const currency = String(currencyInput).toUpperCase();
  try {
    return getCurrencyFormat(locale, currency, decimals, grouping).format(value);
  } catch {
    // Intl throws only for a malformed code, meaning one that is not three
    // ASCII letters. A well-formed but unassigned code such as `XYZ` does
    // not reach here; Intl accepts it and uses it as its own symbol.
    //
    // Babel throws for nothing, so the Python engine lays a malformed code
    // out exactly as the locale's currency pattern dictates. Recover that
    // same layout by formatting a placeholder currency as a code and
    // substituting, which keeps the two engines byte-identical.
    return getCurrencyCodeFormat(locale, decimals, grouping)
      .formatToParts(value)
      .map(part => (part.type === 'currency' ? currency : part.value))
      .join('');
  }
}

/** Formats a timestamp using TR35 pattern tokens, or emits an ISO timestamp. */
export function executeFormatDate(
  value: unknown,
  formatPattern: string = 'yyyy-MM-dd',
  locale: string = DEFAULT_LOCALE,
): string {
  if (!value) return '';
  const parsed = parseTimestamp(String(value));
  if (!parsed) return '';

  const {shifted, instant} = parsed;
  const pattern = formatPattern || 'yyyy-MM-dd';
  if (pattern === 'ISO') return instant.toISOString();

  const names = getDateNames(locale);
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
        return names.monthsLong[shifted.getUTCMonth()];
      case 'MMM':
        return names.monthsShort[shifted.getUTCMonth()];
      case 'MM':
        return String(shifted.getUTCMonth() + 1).padStart(2, '0');
      case 'M':
        return String(shifted.getUTCMonth() + 1);
      case 'EEEE':
        return names.weekdaysLong[weekdayIndex];
      case 'E':
        return names.weekdaysShort[weekdayIndex];
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
}

/** Selects the appropriate plural form for a quantity. */
export function executePluralize(
  value: number,
  forms: Record<string, unknown>,
  locale: string = DEFAULT_LOCALE,
): string {
  let category: string;
  if (value === 0 && forms['zero'] !== undefined) category = 'zero';
  else if (value === 1 && forms['one'] !== undefined) category = 'one';
  else if (value === 2 && forms['two'] !== undefined) category = 'two';
  else category = getPluralRules(locale).select(value);

  return String(forms[category] ?? forms['other'] ?? '');
}

/** Opens a specified URL in a new browser tab. */
export function executeOpenUrl(urlInput: unknown): void {
  const target = typeof urlInput === 'string' ? urlInput : undefined;
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

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new A2uiExpressionError(`Unsupported URL scheme: ${url.protocol}`, 'openUrl');
  }

  window.open(url.href, '_blank', 'noopener,noreferrer');
}

// ---------------------------------------------------------------------------
// Implementation Factory Functions
// ---------------------------------------------------------------------------

export function createAndImplementation(api: any): FunctionImplementation {
  return createFunctionImplementation(api, args => executeAnd(args.values));
}

export function createOrImplementation(api: any): FunctionImplementation {
  return createFunctionImplementation(api, args => executeOr(args.values));
}

export function createNotImplementation(api: any): FunctionImplementation {
  return createFunctionImplementation(api, args => executeNot(args.value));
}

export function createFormatStringImplementation(api: any): FunctionImplementation {
  return createFunctionImplementation(api, (args, context) =>
    executeFormatString(args.value, context),
  );
}

export function createFormatNumberImplementation(
  api: any,
  locale?: string,
): FunctionImplementation {
  const resolvedLocale = resolveLocale(locale);
  return createFunctionImplementation(api, args =>
    executeFormatNumber(args.value, args.decimals, args.grouping, resolvedLocale),
  );
}

export function createFormatCurrencyImplementation(
  api: any,
  locale?: string,
): FunctionImplementation {
  const resolvedLocale = resolveLocale(locale);
  return createFunctionImplementation(api, args =>
    executeFormatCurrency(
      args.value,
      args.currency,
      args.decimals ?? 2,
      args.grouping,
      resolvedLocale,
    ),
  );
}

export function createFormatDateImplementation(api: any, locale?: string): FunctionImplementation {
  const resolvedLocale = resolveLocale(locale);
  return createFunctionImplementation(api, args =>
    executeFormatDate(args.value, args.format, resolvedLocale),
  );
}

export function createPluralizeImplementation(api: any, locale?: string): FunctionImplementation {
  const resolvedLocale = resolveLocale(locale);
  return createFunctionImplementation(api, args =>
    executePluralize(args.value, args as Record<string, unknown>, resolvedLocale),
  );
}

export function createOpenUrlImplementation(api: any): FunctionImplementation {
  return createFunctionImplementation(api, args => executeOpenUrl(args.url));
}
