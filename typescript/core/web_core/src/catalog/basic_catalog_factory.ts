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
 * Helpers the built-in basic catalogs are built with: each is loaded from its
 * published catalog document with `Catalog.fromJson` the first time it is
 * asked for with a validator, never at import.
 */

import type {JsonSchemaValidator} from '../schema-engine/types.js';
import type {FunctionApi, FunctionImplementation} from './types.js';

/**
 * Wraps a factory so that it runs once per validator: later calls with the
 * same validator return the first result. A missing validator is passed
 * through, so the factory reports it.
 *
 * @param build Builds the value for a validator.
 * @returns The memoised factory.
 */
export function memoizeByValidator<T>(
  build: (validator: JsonSchemaValidator) => T,
): (validator: JsonSchemaValidator) => T {
  const built = new WeakMap<object, T>();
  return (validator: JsonSchemaValidator): T => {
    if ((typeof validator !== 'object' && typeof validator !== 'function') || validator === null) {
      return build(validator);
    }
    if (built.has(validator)) return built.get(validator)!;
    const value = build(validator);
    built.set(validator, value);
    return value;
  };
}

/** Builds a function's implementation from its API. */
export type FunctionExecutorFactory = (api: FunctionApi) => FunctionImplementation;

/**
 * Pairs each function API with the implementation of its name.
 *
 * @param apis The functions, such as a loaded catalog's.
 * @param factories The implementation factory of each function, by name.
 * @param catalogId The catalog, for the error message.
 * @returns The implementations, in the order of `apis`.
 * @throws {Error} If a function has no implementation.
 */
export function implementFunctions(
  apis: Iterable<FunctionApi>,
  factories: Readonly<Record<string, FunctionExecutorFactory>>,
  catalogId: string,
): FunctionImplementation[] {
  return [...apis].map(api => {
    const factory = Object.hasOwn(factories, api.name) ? factories[api.name] : undefined;
    if (!factory) {
      throw new Error(`Catalog '${catalogId}' has no implementation of function '${api.name}'.`);
    }
    return factory(api);
  });
}

/**
 * Wraps a factory of a list that depends on a validator and an optional
 * locale so that it runs once per validator and locale. Each call returns a
 * new array of the same entries, so a caller may change the array.
 *
 * @param build Builds the list for a validator and locale.
 * @returns The memoised factory.
 */
export function memoizeByValidatorAndLocale<T>(
  build: (validator: JsonSchemaValidator, locale: string | undefined) => T[],
): (validator: JsonSchemaValidator, options?: {locale?: string}) => T[] {
  const byLocale = memoizeByValidator(() => new Map<string | undefined, T[]>());
  return (validator, options) => {
    if ((typeof validator !== 'object' && typeof validator !== 'function') || validator === null) {
      return build(validator, options?.locale);
    }
    const cache = byLocale(validator);
    const locale = options?.locale;
    let built = cache.get(locale);
    if (!built) {
      built = build(validator, locale);
      cache.set(locale, built);
    }
    return [...built];
  };
}
