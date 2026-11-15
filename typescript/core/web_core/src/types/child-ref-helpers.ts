/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {refKind, type SchemaDoc} from '../schema-engine/nav.js';
import type {JsonSchema} from '../schema-engine/types.js';

/**
 * Classification kind for a schema marked as a child reference.
 */
export type ChildRefKind = 'component-id' | 'child-list';

/**
 * The child reference kind a common types definition name denotes: `Child` and
 * `ComponentId` are single component ids, `ChildList` is a child list.
 *
 * @param defName A `$defs` name, e.g. from {@link refKind}.
 * @returns The child reference kind, or undefined for any other name.
 */
export function childRefKindForDefName(defName: string | undefined): ChildRefKind | undefined {
  if (defName === 'Child' || defName === 'ComponentId') return 'component-id';
  if (defName === 'ChildList') return 'child-list';
  return undefined;
}

/**
 * Extracts the child reference kind of a JSON Schema node: the kind of the
 * common types definition it references through `$ref`, or names in a legacy
 * `REF:` description.
 *
 * @param node JSON Schema node to inspect.
 * @param doc The document that owns `node`.
 * @returns The child reference kind or undefined if the node is not a child reference.
 */
export function childRefKindOf(node: JsonSchema, doc: SchemaDoc): ChildRefKind | undefined {
  try {
    return childRefKindForDefName(refKind(node, doc));
  } catch {
    // An unresolved `$ref` still names its target.
    const ref = typeof node === 'object' ? node['$ref'] : undefined;
    return typeof ref === 'string'
      ? childRefKindForDefName(/\/\$defs\/([^/]+)$/.exec(ref)?.[1])
      : undefined;
  }
}
