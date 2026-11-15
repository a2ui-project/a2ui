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

import type {JsonSchemaValidator} from '@a2ui/web_core';
import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';

import {SignalArray} from 'signal-utils/array';
import {SignalMap} from 'signal-utils/map';
import {SignalObject} from 'signal-utils/object';
import {SignalSet} from 'signal-utils/set';

/** Options for {@link create}. */
export interface SignalA2uiMessageProcessorOptions {
  /**
   * The JSON Schema validator messages are checked with against the v0.8
   * spec, such as `createAjvValidator()` from `@a2ui/validator-ajv`.
   */
  validator: JsonSchemaValidator;
}

/**
 * Creates a v0.8 message processor whose model is built from signal-backed
 * collections, so Lit elements re-render when it changes.
 *
 * @param options The processor options; `validator` is required.
 * @throws {A2uiConfigurationError} If `options.validator` is missing.
 */
export function create(options: SignalA2uiMessageProcessorOptions) {
  return new A2uiMessageProcessor({
    validator: options?.validator,
    arrayCtor: SignalArray as unknown as ArrayConstructor,
    mapCtor: SignalMap as unknown as MapConstructor,
    objCtor: SignalObject as unknown as ObjectConstructor,
    setCtor: SignalSet as unknown as SetConstructor,
  });
}
