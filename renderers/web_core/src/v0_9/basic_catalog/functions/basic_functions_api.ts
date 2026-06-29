/*
 * Copyright 2025 Google LLC
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

import {z} from 'zod';

// Arithmetic
/**
 * Adds two numbers.
 *
 * Arguments:
 * - `a`: The first number.
 * - `b`: The second number.
 */
export const AddApi = {
  name: 'add' as const,
  returnType: 'number' as const,
  schema: z.object({
    a: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
    b: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
  }),
};

/**
 * Subtracts one number from another.
 *
 * Arguments:
 * - `a`: The number to subtract from.
 * - `b`: The number to subtract.
 */
export const SubtractApi = {
  name: 'subtract' as const,
  returnType: 'number' as const,
  schema: z.object({
    a: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
    b: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
  }),
};

/**
 * Multiplies two numbers.
 *
 * Arguments:
 * - `a`: The first number.
 * - `b`: The second number.
 */
export const MultiplyApi = {
  name: 'multiply' as const,
  returnType: 'number' as const,
  schema: z.object({
    a: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
    b: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
  }),
};

/**
 * Divides one number by another.
 *
 * Arguments:
 * - `a`: The dividend.
 * - `b`: The divisor.
 */
export const DivideApi = {
  name: 'divide' as const,
  returnType: 'number' as const,
  schema: z.object({
    a: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
    b: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
  }),
};

// Comparison
/**
 * Checks if two values are equal.
 *
 * Arguments:
 * - `a`: The first value.
 * - `b`: The second value.
 */
export const EqualsApi = {
  name: 'equals' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    a: z.any().refine(v => v !== undefined, 'Required'),
    b: z.any().refine(v => v !== undefined, 'Required'),
  }),
};

/**
 * Checks if two values are not equal.
 *
 * Arguments:
 * - `a`: The first value.
 * - `b`: The second value.
 */
export const NotEqualsApi = {
  name: 'not_equals' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    a: z.any().refine(v => v !== undefined, 'Required'),
    b: z.any().refine(v => v !== undefined, 'Required'),
  }),
};

/**
 * Checks if the first number is greater than the second.
 *
 * Arguments:
 * - `a`: The number to compare.
 * - `b`: The threshold number.
 */
export const GreaterThanApi = {
  name: 'greater_than' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    a: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
    b: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
  }),
};

/**
 * Checks if the first number is less than the second.
 *
 * Arguments:
 * - `a`: The number to compare.
 * - `b`: The threshold number.
 */
export const LessThanApi = {
  name: 'less_than' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    a: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
    b: z.preprocess(v => (v === null ? undefined : v), z.coerce.number()),
  }),
};

// Logical
/**
 * Performs a logical AND operation on a list of boolean values.
 *
 * Arguments:
 * - `values`: List of items to evaluate (minimum 2).
 */
export const AndApi = {
  name: 'and' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    values: z.array(z.any()).min(2),
  }),
};

/**
 * Performs a logical OR operation on a list of boolean values.
 *
 * Arguments:
 * - `values`: List of items to evaluate (minimum 2).
 */
export const OrApi = {
  name: 'or' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    values: z.array(z.any()).min(2),
  }),
};

/**
 * Performs a logical NOT operation on a boolean value.
 *
 * Arguments:
 * - `value`: The value to negate.
 */
export const NotApi = {
  name: 'not' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    value: z.any().refine(v => v !== undefined, 'Required'),
  }),
};

// String
/**
 * Checks if a string contains a substring.
 *
 * Arguments:
 * - `string`: The source string.
 * - `substring`: The substring to search for.
 */
export const ContainsApi = {
  name: 'contains' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    string: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
    substring: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

/**
 * Checks if a string starts with a prefix.
 *
 * Arguments:
 * - `string`: The source string.
 * - `prefix`: The prefix to search for.
 */
export const StartsWithApi = {
  name: 'starts_with' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    string: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
    prefix: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

/**
 * Checks if a string ends with a suffix.
 *
 * Arguments:
 * - `string`: The source string.
 * - `suffix`: The suffix to search for.
 */
export const EndsWithApi = {
  name: 'ends_with' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    string: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
    suffix: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

// Validation
/**
 * Checks that the value is not null, undefined, or empty.
 *
 * Arguments:
 * - `value`: The value to check.
 */
export const RequiredApi = {
  name: 'required' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    value: z.any().refine(v => v !== undefined, 'Required'),
  }),
};

/**
 * Checks that the value matches a regular expression string.
 *
 * Arguments:
 * - `value`: The string to test.
 * - `pattern`: The regex pattern string.
 */
export const RegexApi = {
  name: 'regex' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    value: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
    pattern: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

/**
 * Checks string length constraints.
 *
 * Arguments:
 * - `value`: The value to inspect.
 * - `min`: Optional minimum length.
 * - `max`: Optional maximum length.
 */
export const LengthApi = {
  name: 'length' as const,
  returnType: 'boolean' as const,
  schema: z
    .object({
      value: z.any().refine(v => v !== undefined, 'Required'),
      min: z.coerce.number().optional(),
      max: z.coerce.number().optional(),
    })
    .refine(data => data.min !== undefined || data.max !== undefined, {
      message: "Must provide either 'min' or 'max'",
    }),
};

/**
 * Checks numeric range constraints.
 *
 * Arguments:
 * - `value`: The value to inspect.
 * - `min`: Optional minimum value.
 * - `max`: Optional maximum value.
 */
export const NumericApi = {
  name: 'numeric' as const,
  returnType: 'boolean' as const,
  schema: z
    .object({
      value: z.coerce.number(),
      min: z.coerce.number().optional(),
      max: z.coerce.number().optional(),
    })
    .refine(data => data.min !== undefined || data.max !== undefined, {
      message: "Must provide either 'min' or 'max'",
    }),
};

/**
 * Checks that the value is a valid email address.
 *
 * Arguments:
 * - `value`: The string to inspect.
 */
export const EmailApi = {
  name: 'email' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    value: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

// Formatting
/**
 * Performs string interpolation on a value, resolving model paths and functions.
 *
 * Interpolation uses the `${expression}` syntax. Supported expressions include:
 * - **JSON Pointer paths**: `${/absolute/path}` or `${relative/path}` to access data model values.
 * - **Function calls**: `${now()}` or with named arguments like `${formatDate(value:${/currentDate}, format:'MM-dd')}`.
 *
 * To include a literal `${` sequence, escape it as `\\${`.
 *
 * @example
 * "Hello ${/user/name}"
 * "Total: ${formatCurrency(value:${/total}, currency:'USD')}"
 *
 * Arguments:
 * - `value`: The string template to interpolate.
 */
export const FormatStringApi = {
  name: 'formatString' as const,
  returnType: 'any' as const,
  schema: z.object({
    value: z.coerce.string(),
  }),
};

/**
 * Formats a number with the specified grouping and decimal precision.
 *
 * Arguments:
 * - `value`: The number to format.
 * - `decimals`: Optional number of decimal places.
 * - `grouping`: Whether to use thousands separators, defaults to true.
 */
export const FormatNumberApi = {
  name: 'formatNumber' as const,
  returnType: 'string' as const,
  schema: z.object({
    value: z.coerce.number(),
    decimals: z.coerce.number().optional(),
    grouping: z.boolean().default(true),
  }),
};

/**
 * Formats a number as a currency string.
 *
 * Arguments:
 * - `value`: The number to format.
 * - `currency`: Currency code (e.g. "USD"), defaults to "USD".
 * - `decimals`: Optional number of decimal places.
 * - `grouping`: Whether to use thousands separators, defaults to true.
 */
export const FormatCurrencyApi = {
  name: 'formatCurrency' as const,
  returnType: 'string' as const,
  schema: z.object({
    value: z.coerce.number(),
    currency: z.coerce.string(),
    decimals: z.coerce.number().optional(),
    grouping: z.boolean().default(true),
  }),
};

/**
 * Formats a timestamp into a string using a pattern.
 *
 * Token Reference:
 * - Year: 'yy' (26), 'yyyy' (2026)
 * - Month: 'M' (1), 'MM' (01), 'MMM' (Jan), 'MMMM' (January)
 * - Day: 'd' (1), 'dd' (01), 'E' (Tue), 'EEEE' (Tuesday)
 * - Hour (12h): 'h' (1-12), 'hh' (01-12) - requires 'a' for AM/PM
 * - Hour (24h): 'H' (0-23), 'HH' (00-23) - Military Time
 * - Minute: 'mm' (00-59), Second: 'ss' (00-59)
 * - Period: 'a' (AM/PM)
 *
 * Arguments:
 * - `value`: The date to format.
 * - `format`: A Unicode TR35 date pattern string.
 */
export const FormatDateApi = {
  name: 'formatDate' as const,
  returnType: 'string' as const,
  schema: z.object({
    value: z.any().refine(v => v !== undefined, 'Required'),
    format: z.coerce.string(),
  }),
};

/**
 * Returns a localized string based on the Common Locale Data Repository (CLDR) plural category of the count.
 *
 * Requires an 'other' fallback. For English, just use 'one' and 'other'.
 *
 * Arguments:
 * - `value`: Count to evaluate.
 * - `zero`: Optional text for count 0.
 * - `one`: Optional text for count 1.
 * - `two`: Optional text for count 2.
 * - `few`: Optional text for few items.
 * - `many`: Optional text for many items.
 * - `other`: Default text fallback.
 */
export const PluralizeApi = {
  name: 'pluralize' as const,
  returnType: 'string' as const,
  schema: z.object({
    value: z.coerce.number(),
    zero: z.coerce.string().optional(),
    one: z.coerce.string().optional(),
    two: z.coerce.string().optional(),
    few: z.coerce.string().optional(),
    many: z.coerce.string().optional(),
    other: z.coerce.string(),
  }),
};

// Actions
/**
 * Opens the specified URL in a browser or handler. This function has no return value.
 *
 * Arguments:
 * - `url`: The address URL string.
 */
export const OpenUrlApi = {
  name: 'openUrl' as const,
  returnType: 'void' as const,
  schema: z.object({
    url: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

/**
 * Collection containing ALL available Basic Function API descriptors.
 */
export const BASIC_FUNCTION_APIS = [
  AddApi,
  SubtractApi,
  MultiplyApi,
  DivideApi,
  EqualsApi,
  NotEqualsApi,
  GreaterThanApi,
  LessThanApi,
  AndApi,
  OrApi,
  NotApi,
  ContainsApi,
  StartsWithApi,
  EndsWithApi,
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
];
