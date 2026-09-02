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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/ catalogs via scripts/generate-catalog-schemas.mjs
import {z} from 'zod';
import {
  DataBindingSchema,
  DynamicBooleanSchema,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  FunctionCallSchema,
} from '../../schema/common-types.js';

/**
 * Checks that the value is not null, undefined, or empty.
 */
export const RequiredApi = {
  name: 'required' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    'value': z
      .any()
      .refine(v => v !== undefined, 'Required')
      .describe('The value to check.'),
  }),
};

/**
 * Checks that the value matches a regular expression string.
 */
export const RegexApi = {
  name: 'regex' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    'value': DynamicStringSchema.describe('REF:#/$defs/DynamicString'),
    'pattern': z.string().describe('The regex pattern to match against.'),
  }),
};

/**
 * Checks string length constraints.
 */
export const LengthApi = {
  name: 'length' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    'value': DynamicStringSchema.describe('REF:#/$defs/DynamicString'),
    'min': z.number().int().describe('The minimum allowed length.').optional(),
    'max': z.number().int().describe('The maximum allowed length.').optional(),
  }),
};

/**
 * Checks numeric range constraints.
 */
export const NumericApi = {
  name: 'numeric' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    'value': DynamicNumberSchema.describe('REF:#/$defs/DynamicNumber'),
    'min': z.number().describe('The minimum allowed value.').optional(),
    'max': z.number().describe('The maximum allowed value.').optional(),
  }),
};

/**
 * Checks that the value is a valid email address.
 */
export const EmailApi = {
  name: 'email' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    'value': DynamicStringSchema.describe('REF:#/$defs/DynamicString'),
  }),
};

/**
 * Performs string interpolation of data model values and other functions in the catalog functions list and returns the resulting string. The value string can contain interpolated expressions in the `${expression}` format. Supported expression types include: JSON Pointer paths to the data model (e.g., `${/absolute/path}` or `${relative/path}`), and renderer-side function calls (e.g., `${now()}`). Function arguments must be named (e.g., `${formatDate(value:${/currentDate}, format:'MM-dd')}`). To include a literal `${` sequence, escape it as `\${`.
 */
export const FormatStringApi = {
  name: 'formatString' as const,
  returnType: 'string' as const,
  schema: z.object({
    'value': DynamicStringSchema.describe('REF:#/$defs/DynamicString'),
  }),
};

/**
 * Formats a number with the specified grouping and decimal precision.
 */
export const FormatNumberApi = {
  name: 'formatNumber' as const,
  returnType: 'string' as const,
  schema: z.object({
    'value': DynamicNumberSchema.describe('REF:#/$defs/DynamicNumber|The number to format.'),
    'decimals': DynamicNumberSchema.describe(
      'REF:#/$defs/DynamicNumber|Optional. The number of decimal places to show. Defaults to 0 or 2 depending on locale.',
    ).optional(),
    'grouping': DynamicBooleanSchema.describe(
      "REF:#/$defs/DynamicBoolean|Optional. If true, uses locale-specific grouping separators (e.g. '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true.",
    ).optional(),
  }),
};

/**
 * Formats a number as a currency string.
 */
export const FormatCurrencyApi = {
  name: 'formatCurrency' as const,
  returnType: 'string' as const,
  schema: z.object({
    'value': DynamicNumberSchema.describe('REF:#/$defs/DynamicNumber|The monetary amount.'),
    'currency': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|The ISO 4217 currency code (e.g., 'USD', 'EUR').",
    ),
    'decimals': DynamicNumberSchema.describe(
      'REF:#/$defs/DynamicNumber|Optional. The number of decimal places to show. Defaults to 0 or 2 depending on locale.',
    ).optional(),
    'grouping': DynamicBooleanSchema.describe(
      "REF:#/$defs/DynamicBoolean|Optional. If true, uses locale-specific grouping separators (e.g. '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true.",
    ).optional(),
  }),
};

/**
 * Formats a timestamp into a string using a pattern.
 */
export const FormatDateApi = {
  name: 'formatDate' as const,
  returnType: 'string' as const,
  schema: z.object({
    'value': DynamicValueSchema.describe('REF:#/$defs/DynamicValue|The date to format.'),
    'format': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|A Unicode TR35 date pattern string.\n\nToken Reference:\n- Year: 'yy' (26), 'yyyy' (2026)\n- Month: 'M' (1), 'MM' (01), 'MMM' (Jan), 'MMMM' (January)\n- Day: 'd' (1), 'dd' (01), 'E' (Tue), 'EEEE' (Tuesday)\n- Hour (12h): 'h' (1-12), 'hh' (01-12) - requires 'a' for AM/PM\n- Hour (24h): 'H' (0-23), 'HH' (00-23) - Military Time\n- Minute: 'mm' (00-59)\n- Second: 'ss' (00-59)\n- Period: 'a' (AM/PM)\n\nExamples:\n- 'MMM dd, yyyy' -> 'Jan 16, 2026'\n- 'HH:mm' -> '14:30' (Military)\n- 'h:mm a' -> '2:30 PM'\n- 'EEEE, d MMMM' -> 'Friday, 16 January'",
    ),
  }),
};

/**
 * Returns a localized string based on the Common Locale Data Repository (CLDR) plural category of the count (zero, one, two, few, many, other). Requires an 'other' fallback. For English, just use 'one' and 'other'.
 */
export const PluralizeApi = {
  name: 'pluralize' as const,
  returnType: 'string' as const,
  schema: z.object({
    'value': DynamicNumberSchema.describe(
      'REF:#/$defs/DynamicNumber|The numeric value used to determine the plural category.',
    ),
    'zero': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|String for the 'zero' category (e.g., 0 items).",
    ).optional(),
    'one': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|String for the 'one' category (e.g., 1 item).",
    ).optional(),
    'two': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|String for the 'two' category (used in Arabic, Welsh, etc.).",
    ).optional(),
    'few': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|String for the 'few' category (e.g., small groups in Slavic languages).",
    ).optional(),
    'many': DynamicStringSchema.describe(
      "REF:#/$defs/DynamicString|String for the 'many' category (e.g., large groups in various languages).",
    ).optional(),
    'other': DynamicStringSchema.describe(
      'REF:#/$defs/DynamicString|The default/fallback string (used for general plural cases).',
    ),
  }),
};

/**
 * Opens the specified URL in a browser or handler (requires user activation). This function has no return value.
 */
export const OpenUrlApi = {
  name: 'openUrl' as const,
  returnType: 'void' as const,
  schema: z.object({
    'url': z
      .union([
        z.string(),
        DataBindingSchema.describe('REF:#/$defs/DataBinding'),
        FunctionCallSchema.describe('REF:#/$defs/FunctionCall'),
      ])
      .describe('The URL to open.'),
  }),
};

/**
 * Performs a logical AND operation on a list of boolean values.
 */
export const AndApi = {
  name: 'and' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    'values': z
      .array(DynamicBooleanSchema)
      .min(2)
      .describe('The list of boolean values to evaluate.'),
  }),
};

/**
 * Performs a logical OR operation on a list of boolean values.
 */
export const OrApi = {
  name: 'or' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    'values': z
      .array(DynamicBooleanSchema)
      .min(2)
      .describe('The list of boolean values to evaluate.'),
  }),
};

/**
 * Performs a logical NOT operation on a boolean value.
 */
export const NotApi = {
  name: 'not' as const,
  returnType: 'boolean' as const,
  schema: z.object({
    'value': DynamicBooleanSchema.describe(
      'REF:#/$defs/DynamicBoolean|The boolean value to negate.',
    ),
  }),
};

export const BASIC_FUNCTION_APIS = [
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
];

export const V09_SPEC_FUNCTION_APIS = BASIC_FUNCTION_APIS;
