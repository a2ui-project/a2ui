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

import {z} from 'zod';

/**
 * v1.0 required validation function.
 * Return type: 'validationResult'.
 */
export const RequiredV1Point0Api = {
  name: 'required' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    value: z.any().refine(v => v !== undefined, 'Required'),
  }),
};

/**
 * v1.0 regex validation function.
 * Return type: 'validationResult'.
 */
export const RegexV1Point0Api = {
  name: 'regex' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    value: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
    pattern: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

/**
 * v1.0 length validation function.
 * Return type: 'validationResult'.
 */
export const LengthV1Point0Api = {
  name: 'length' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    value: z.any(),
    min: z.preprocess(v => (v === undefined ? undefined : Number(v)), z.number().optional()),
    max: z.preprocess(v => (v === undefined ? undefined : Number(v)), z.number().optional()),
  }),
};

/**
 * v1.0 numeric validation function.
 * Return type: 'validationResult'.
 */
export const NumericV1Point0Api = {
  name: 'numeric' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    value: z.preprocess(v => (v === undefined ? undefined : Number(v)), z.number()),
    min: z.preprocess(v => (v === undefined ? undefined : Number(v)), z.number().optional()),
    max: z.preprocess(v => (v === undefined ? undefined : Number(v)), z.number().optional()),
  }),
};

/**
 * v1.0 email validation function.
 * Return type: 'validationResult'.
 */
export const EmailV1Point0Api = {
  name: 'email' as const,
  returnType: 'validationResult' as const,
  schema: z.object({
    value: z.preprocess(v => (v === undefined ? undefined : String(v)), z.string()),
  }),
};

/**
 * v1.0 basic catalog validation APIs.
 */
export const V10_VALIDATION_FUNCTION_APIS = [
  RequiredV1Point0Api,
  RegexV1Point0Api,
  LengthV1Point0Api,
  NumericV1Point0Api,
  EmailV1Point0Api,
];
