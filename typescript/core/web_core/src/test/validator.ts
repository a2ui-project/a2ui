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

import type {JsonSchemaValidator} from '../schema-engine/types.js';

// The validator adapters are built after this package (they depend on
// web_core), so they are loaded by computed specifiers: tsc never needs their
// types, and the test scripts build them before running the tests.
const AJV_ADAPTER: string = '@a2ui/validator-ajv';
const CFWORKER_ADAPTER: string = '@a2ui/validator-cfworker';
const ajv = (await import(AJV_ADAPTER)) as {
  createAjvValidator(opts?: {formats?: boolean}): JsonSchemaValidator;
};
const cfworker = (await import(CFWORKER_ADAPTER)) as {
  createCfWorkerValidator(): JsonSchemaValidator;
};

/** Creates the reference (Ajv) {@link JsonSchemaValidator} used by tests. */
export const createAjvValidator = ajv.createAjvValidator;

/** Creates the `@cfworker/json-schema` {@link JsonSchemaValidator}, for cross-engine tests. */
export const createCfWorkerValidator = cfworker.createCfWorkerValidator;

/**
 * One shared reference validator, so the protocol schemas compiled for it are
 * reused across the processors that tests create.
 */
export const testValidator: JsonSchemaValidator = createAjvValidator();
