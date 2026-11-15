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
 * The functions' schemas are those of the published v1 basic catalog
 * document, loaded with the app's validator; only their execution is defined
 * here.
 */

import {
  implementFunctions,
  memoizeByValidatorAndLocale,
  type FunctionExecutorFactory,
} from '../../../../catalog/basic_catalog_factory.js';
import type {FunctionImplementation} from '../../../../catalog/types.js';
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
  isTruthyOrValid,
} from '../../../../common/basic_functions.js';
import {fromJsonSchema, jsonSchemaDocuments} from '../../../../schema-engine/from-json-schema.js';
import type {JsonSchemaValidator} from '../../../../schema-engine/types.js';
import {INDEX_ARGS, IndexImplementation} from '../../../../v1_0/functions/system_functions.js';
import {V10_VALIDATION_FUNCTION_EXECUTORS} from '../../../../v1_0/functions/validation_functions.js';
import {loadBasicCatalogApi} from '../document.js';

/** Options for the function implementations of the v1 basic catalog. */
export interface BasicFunctionOptions {
  /** The BCP 47 locale the formatting functions format with. Defaults to `en-US`. */
  locale?: string;
}

/**
 * The implementation factory of each function of the v1 basic catalog
 * document, by name. The v1.0 validators return a ValidationResult, so the
 * logical functions read an operand's `valid` member rather than treating
 * every object as truthy.
 */
function specExecutors(locale?: string): Record<string, FunctionExecutorFactory> {
  return {
    ...V10_VALIDATION_FUNCTION_EXECUTORS,
    formatString: api => createFormatStringImplementation(api),
    formatNumber: api => createFormatNumberImplementation(api, locale),
    formatCurrency: api => createFormatCurrencyImplementation(api, locale),
    formatDate: api => createFormatDateImplementation(api, locale),
    pluralize: api => createPluralizeImplementation(api, locale),
    openUrl: api => createOpenUrlImplementation(api),
    and: api => createAndImplementation(api, {truthy: isTruthyOrValid}),
    or: api => createOrImplementation(api, {truthy: isTruthyOrValid}),
    not: api => createNotImplementation(api, {truthy: isTruthyOrValid}),
  };
}

/**
 * Creates the complete function set for a v1.0 basic catalog: the functions
 * declared in `catalogs/basic/v1/catalog.json`, with the document's schemas,
 * plus the `@index` system function, which the `@` namespace makes
 * available to every catalog (its arguments validate against the v1.0 common
 * types' `IndexSystemFunction` arguments).
 *
 * @param validator The JSON Schema validator the functions' arguments validate with.
 * @param options Options such as the locale of the formatting functions.
 * Built once per validator and locale.
 *
 * @returns The implementations, in the document's order, then `@index`.
 */
export const createBasicCatalogFunctions: (
  validator: JsonSchemaValidator,
  options?: BasicFunctionOptions,
) => FunctionImplementation[] = memoizeByValidatorAndLocale((validator, locale) => {
  const catalog = loadBasicCatalogApi(validator);
  const functions = implementFunctions(
    catalog.functions.values(),
    specExecutors(locale),
    catalog.id,
  );
  // The documents the catalog's own function schemas validate with.
  const documents = jsonSchemaDocuments(functions[0]?.schema);
  const index: FunctionImplementation = {
    ...IndexImplementation,
    schema: fromJsonSchema(INDEX_ARGS, validator, {defs: {...documents}}),
  };
  return [...functions, index];
});
