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
 *
 * The functions' schemas are those of the published v0.9 basic catalog
 * document, loaded with the app's validator; only their execution is defined
 * here.
 */

import {
  implementFunctions,
  memoizeByValidatorAndLocale,
  type FunctionExecutorFactory,
} from '../../../catalog/basic_catalog_factory.js';
import {
  createFunctionImplementation,
  type FunctionApi,
  type FunctionImplementation,
} from '../../../catalog/types.js';
import {fromJsonSchema} from '../../../schema-engine/from-json-schema.js';
import type {JsonSchema, JsonSchemaValidator} from '../../../schema-engine/types.js';
import {
  createAndImplementation,
  createOrImplementation,
  createNotImplementation,
  createFormatStringImplementation,
  createFormatNumberImplementation,
  createFormatCurrencyImplementation,
  createFormatDateImplementation,
  createPluralizeImplementation,
  createOpenUrlImplementation,
  validateRequired,
  validateRegex,
  validateLength,
  validateNumeric,
  validateEmail,
} from '../../../common/basic_functions.js';
import {loadBasicCatalogApi} from '../document.js';

export {isSafeRegex, type SafeRegexOptions} from './safe_regex.js';

/** Options for the function implementations of the v0.9 basic catalog. */
export interface BasicFunctionOptions {
  /** The BCP 47 locale the formatting functions format with. Defaults to `en-US`. */
  locale?: string;
}

/**
 * The implementation factory of each function of the v0.9 basic catalog
 * document, by name.
 */
function specExecutors(locale?: string): Record<string, FunctionExecutorFactory> {
  return {
    required: api => createFunctionImplementation(api, args => validateRequired(args.value).valid),
    regex: api =>
      createFunctionImplementation(api, args => validateRegex(args.value, args.pattern).valid),
    length: api =>
      createFunctionImplementation(
        api,
        args => validateLength(args.value, args.min, args.max).valid,
      ),
    numeric: api =>
      createFunctionImplementation(
        api,
        args => validateNumeric(args.value, args.min, args.max).valid,
      ),
    email: api => createFunctionImplementation(api, args => validateEmail(args.value).valid),
    formatString: api => createFormatStringImplementation(api),
    formatNumber: api => createFormatNumberImplementation(api, locale),
    formatCurrency: api => createFormatCurrencyImplementation(api, locale),
    formatDate: api => createFormatDateImplementation(api, locale),
    pluralize: api => createPluralizeImplementation(api, locale),
    openUrl: api => createOpenUrlImplementation(api),
    and: api => createAndImplementation(api),
    or: api => createOrImplementation(api),
    not: api => createNotImplementation(api),
  };
}

/**
 * Creates the function implementations of the published v0.9 basic catalog
 * document, with the document's schemas. This is what `createBasicCatalog`
 * registers.
 *
 * Built once per validator and locale.
 *
 * @param validator The JSON Schema validator the functions' arguments validate with.
 * @param options Options such as the locale of the formatting functions.
 * @returns The implementations, in the document's order.
 */
export const createV09SpecFunctions: (
  validator: JsonSchemaValidator,
  options?: BasicFunctionOptions,
) => FunctionImplementation[] = memoizeByValidatorAndLocale((validator, locale) => {
  const catalog = loadBasicCatalogApi(validator);
  return implementFunctions(catalog.functions.values(), specExecutors(locale), catalog.id);
});

// The legacy functions of @a2ui/web_core 0.9.x, which the published v0.9
// basic catalog document never defined. Their schemas are written here as
// JSON Schema; they convert their arguments themselves.

const scalar: JsonSchema = {type: ['number', 'string', 'boolean']};
// Any value, `null` included; `required` rejects a missing one.
const present: JsonSchema = {};

function legacyArgs(properties: Record<string, JsonSchema>): JsonSchema {
  return {type: 'object', properties, required: Object.keys(properties)};
}

interface LegacyFunction {
  readonly name: string;
  readonly returnType: 'number' | 'boolean';
  readonly args: JsonSchema;
  readonly execute: (args: Record<string, unknown>) => unknown;
}

const numbers = legacyArgs({a: scalar, b: scalar});
const values = legacyArgs({a: present, b: present});

const LEGACY_FUNCTIONS: readonly LegacyFunction[] = [
  {name: 'add', returnType: 'number', args: numbers, execute: a => Number(a.a) + Number(a.b)},
  {name: 'subtract', returnType: 'number', args: numbers, execute: a => Number(a.a) - Number(a.b)},
  {name: 'multiply', returnType: 'number', args: numbers, execute: a => Number(a.a) * Number(a.b)},
  {
    name: 'divide',
    returnType: 'number',
    args: numbers,
    execute: a => {
      const numA = Number(a.a);
      const numB = Number(a.b);
      if (Number.isNaN(numA) || Number.isNaN(numB)) return NaN;
      if (numB === 0) return Infinity;
      return numA / numB;
    },
  },
  {name: 'equals', returnType: 'boolean', args: values, execute: a => a.a === a.b},
  {name: 'not_equals', returnType: 'boolean', args: values, execute: a => a.a !== a.b},
  {
    name: 'greater_than',
    returnType: 'boolean',
    args: numbers,
    execute: a => Number(a.a) > Number(a.b),
  },
  {
    name: 'less_than',
    returnType: 'boolean',
    args: numbers,
    execute: a => Number(a.a) < Number(a.b),
  },
  {
    name: 'contains',
    returnType: 'boolean',
    args: legacyArgs({string: scalar, substring: scalar}),
    execute: a => String(a.string).includes(String(a.substring)),
  },
  {
    name: 'starts_with',
    returnType: 'boolean',
    args: legacyArgs({string: scalar, prefix: scalar}),
    execute: a => String(a.string).startsWith(String(a.prefix)),
  },
  {
    name: 'ends_with',
    returnType: 'boolean',
    args: legacyArgs({string: scalar, suffix: scalar}),
    execute: a => String(a.string).endsWith(String(a.suffix)),
  },
];

/** The names of the legacy functions, in the order `@a2ui/web_core` 0.9.x listed them. */
export const LEGACY_V09_FUNCTION_NAMES: readonly string[] = LEGACY_FUNCTIONS.map(f => f.name);

/**
 * Creates the legacy function implementations of `@a2ui/web_core` 0.9.x
 * (`add`, `equals`, `contains` and the rest), which the published v0.9
 * basic catalog document does not define.
 *
 * @deprecated Define these functions in your own catalog instead.
 * @param validator The JSON Schema validator the functions' arguments validate with.
 */
export const createLegacyV09Functions: (
  validator: JsonSchemaValidator,
) => FunctionImplementation[] = memoizeByValidatorAndLocale(validator =>
  LEGACY_FUNCTIONS.map(fn => {
    const api: FunctionApi = {
      name: fn.name,
      returnType: fn.returnType,
      schema: fromJsonSchema(fn.args, validator),
    };
    return createFunctionImplementation(api, args => fn.execute(args as Record<string, unknown>));
  }),
);

/**
 * Creates the standard function implementations for the Basic Catalog: the
 * deprecated legacy functions of `@a2ui/web_core` 0.9.x ahead of the ones
 * the v0.9 specification defines, so a catalog composed from this list
 * behaves as it did before 1.0. A catalog that should match the published
 * document uses {@link createV09SpecFunctions}.
 *
 * @param validator The JSON Schema validator the functions' arguments validate with.
 * @param options Options such as the locale of the formatting functions.
 */
export const createBasicCatalogFunctions: (
  validator: JsonSchemaValidator,
  options?: BasicFunctionOptions,
) => FunctionImplementation[] = memoizeByValidatorAndLocale((validator, locale) => [
  ...createLegacyV09Functions(validator),
  ...createV09SpecFunctions(validator, {locale}),
]);
