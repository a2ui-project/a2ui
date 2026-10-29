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
 * Function APIs that `@a2ui/web_core` 0.9.x shipped in its basic catalog but
 * that the published v0.9 basic catalog document never defined.
 *
 * They are kept out of `basicCatalog`, whose `toJson()` must match
 * `specification/v0_9/catalogs/basic/catalog.json`, and out of the generated
 * `BASIC_FUNCTION_APIS`, but stay in `BASIC_FUNCTIONS` so catalogs that
 * composed their function list from it keep resolving `add`, `equals`, and
 * the rest.
 *
 * @deprecated Define these functions in your own catalog instead.
 */

import {z} from 'zod';

const nullableNumber = () => z.preprocess(v => (v === null ? undefined : v), z.coerce.number());
const stringArg = () =>
  z.preprocess(v => (v === undefined || v === null ? undefined : String(v)), z.string());
const anyRequired = () => z.any().refine(v => v !== undefined, 'Required');

/**
 * API of the legacy `add` function.
 *
 * @deprecated Define `add` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const AddApi = {
  name: 'add' as const,
  returnType: 'number' as const,
  schema: z.object({'a': nullableNumber(), 'b': nullableNumber()}),
};

/**
 * API of the legacy `subtract` function.
 *
 * @deprecated Define `subtract` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const SubtractApi = {
  name: 'subtract' as const,
  returnType: 'number' as const,
  schema: z.object({'a': nullableNumber(), 'b': nullableNumber()}),
};

/**
 * API of the legacy `multiply` function.
 *
 * @deprecated Define `multiply` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const MultiplyApi = {
  name: 'multiply' as const,
  returnType: 'number' as const,
  schema: z.object({'a': nullableNumber(), 'b': nullableNumber()}),
};

/**
 * API of the legacy `divide` function.
 *
 * @deprecated Define `divide` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const DivideApi = {
  name: 'divide' as const,
  returnType: 'number' as const,
  schema: z.object({'a': nullableNumber(), 'b': nullableNumber()}),
};

/**
 * API of the legacy `equals` function.
 *
 * @deprecated Define `equals` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const EqualsApi = {
  name: 'equals' as const,
  returnType: 'boolean' as const,
  schema: z.object({'a': anyRequired(), 'b': anyRequired()}),
};

/**
 * API of the legacy `not_equals` function.
 *
 * @deprecated Define `not_equals` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const NotEqualsApi = {
  name: 'not_equals' as const,
  returnType: 'boolean' as const,
  schema: z.object({'a': anyRequired(), 'b': anyRequired()}),
};

/**
 * API of the legacy `greater_than` function.
 *
 * @deprecated Define `greater_than` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const GreaterThanApi = {
  name: 'greater_than' as const,
  returnType: 'boolean' as const,
  schema: z.object({'a': nullableNumber(), 'b': nullableNumber()}),
};

/**
 * API of the legacy `less_than` function.
 *
 * @deprecated Define `less_than` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const LessThanApi = {
  name: 'less_than' as const,
  returnType: 'boolean' as const,
  schema: z.object({'a': nullableNumber(), 'b': nullableNumber()}),
};

/**
 * API of the legacy `contains` function.
 *
 * @deprecated Define `contains` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const ContainsApi = {
  name: 'contains' as const,
  returnType: 'boolean' as const,
  schema: z.object({'string': stringArg(), 'substring': stringArg()}),
};

/**
 * API of the legacy `starts_with` function.
 *
 * @deprecated Define `starts_with` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const StartsWithApi = {
  name: 'starts_with' as const,
  returnType: 'boolean' as const,
  schema: z.object({'string': stringArg(), 'prefix': stringArg()}),
};

/**
 * API of the legacy `ends_with` function.
 *
 * @deprecated Define `ends_with` in your own catalog instead; the v0.9 basic
 *   catalog document does not include it.
 */
export const EndsWithApi = {
  name: 'ends_with' as const,
  returnType: 'boolean' as const,
  schema: z.object({'string': stringArg(), 'suffix': stringArg()}),
};

/**
 * The legacy function APIs, in the order `@a2ui/web_core` 0.9.x listed them.
 *
 * @deprecated See the module documentation.
 */
export const LEGACY_V09_FUNCTION_APIS = [
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
];
