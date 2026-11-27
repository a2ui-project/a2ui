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

import type {A2uiMetadata} from '../common/metadata.js';
import type {ComponentDefinition} from './model/catalog_model.js';

/** Minimal structural shape of a `ComponentApi` entry (zero schema-library dependency). */
export interface ComponentApiFieldsShape {
  readonly name: string;
  readonly schema?: unknown;
  readonly definition?: ComponentDefinition;
  readonly allowedParents?: readonly string[];
  readonly allowedChildren?: readonly string[];
  readonly metadata?: A2uiMetadata;
}

/**
 * Copies the canonical `ComponentApi` fields of `api`, preserving `definition`
 * and `schema` while stripping renderer-specific implementation fields (such as
 * `tagName`, `element`, `component`, `render`, or `view`).
 */
export function pickComponentApiFields<T extends ComponentApiFieldsShape>(
  api: T,
): Pick<
  T,
  Extract<
    keyof T,
    'name' | 'schema' | 'definition' | 'allowedParents' | 'allowedChildren' | 'metadata'
  >
> {
  const result: Record<string, unknown> = {
    name: api.name,
  };
  if ('schema' in api && api.schema !== undefined) {
    result['schema'] = api.schema;
  }
  if (api.definition !== undefined) {
    result['definition'] = api.definition;
  }
  if (api.allowedParents !== undefined) {
    result['allowedParents'] = api.allowedParents;
  }
  if (api.allowedChildren !== undefined) {
    result['allowedChildren'] = api.allowedChildren;
  }
  if (api.metadata !== undefined) {
    result['metadata'] = api.metadata;
  }
  return result as Pick<
    T,
    Extract<
      keyof T,
      'name' | 'schema' | 'definition' | 'allowedParents' | 'allowedChildren' | 'metadata'
    >
  >;
}
