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

import {entrySchema, type AuthoredSchema} from '../catalog/entry-schema.js';
import type {SchemaCursor} from '../schema-engine/nav.js';

/**
 * The JSON Schema discovery reads for a component schema, as a catalog of
 * `protocolVersion` registers it (v1.0 when omitted).
 */
export function cursorOf(schema: AuthoredSchema, protocolVersion?: string): SchemaCursor {
  return entrySchema({name: 'Test', schema}, 'component', {protocolVersion})!.cursor;
}
