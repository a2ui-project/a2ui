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

import {isAtLeastVersion} from '../common/semver.js';
import type {ProtocolVersion} from '../processing/adapters/base.js';
import V09EnvelopeCatalog from '../v0_9/envelope_catalog.json' with {type: 'json'};
import V10EnvelopeCatalog from '../v1_0/envelope_catalog.json' with {type: 'json'};
import V09CommonTypes from '../v0_9/schemas/common_types.json' with {type: 'json'};
import V091CommonTypes from '../v0_9_1/schemas/common_types.json' with {type: 'json'};
import V10CommonTypes from '../v1_0/schemas/common_types.json' with {type: 'json'};
import type {JsonSchema} from './types.js';

/**
 * The specification's `common_types.json` for a protocol version, which a
 * schema `$ref`s as `common_types.json#/$defs/DynamicString`.
 *
 * The document is shared: it must not be mutated.
 *
 * @param version The protocol version, such as `'v0.9'` or `'v1.0'`.
 * @returns The document, or `undefined` for v0.8, which has none.
 */
export function commonTypesDocument(version: ProtocolVersion): JsonSchema | undefined {
  if (isAtLeastVersion(version, '1.0')) return V10CommonTypes as JsonSchema;
  if (isAtLeastVersion(version, '0.9.1')) return V091CommonTypes as JsonSchema;
  if (isAtLeastVersion(version, '0.9')) return V09CommonTypes as JsonSchema;
  return undefined;
}

/**
 * The protocol version's `catalog.json` envelope document, carrying the
 * `anyFunction` and `anyComponent` unions the common types reference (empty
 * unions, to be completed by a catalog). Shared: must not be mutated.
 *
 * @returns The document, or `undefined` for v0.8.
 */
export function envelopeCatalogDocument(version: ProtocolVersion): JsonSchema | undefined {
  if (isAtLeastVersion(version, '1.0')) return V10EnvelopeCatalog as JsonSchema;
  if (isAtLeastVersion(version, '0.9')) return V09EnvelopeCatalog as JsonSchema;
  return undefined;
}
