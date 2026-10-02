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

/**
 * Infers child references from property names, for components whose loaded schema
 * declares none.
 *
 * The stream processor needs to know which properties hold child component ids, so it
 * can hold a component back until its children arrive. It reads that from the catalog's
 * reference map. When a catalog lists children as plain strings without a `$ref`, the map
 * is empty even though the component has children, and this file fills the gap by
 * treating properties named like `child` or `children` as references.
 *
 * The basic catalogs don't need this, because they declare every child with a `$ref`. The
 * catalogs in `conformance/agent/legacy/streaming_parser.yaml` use plain strings, and two
 * of its cases, `test_partial_children_lists_v09` and
 * `test_sniff_partial_component_discards_empty_children_dict_v09`, fail without
 * inference.
 *
 * Inference runs only for components with no formal references at all. A component that
 * declares any `$ref` child is taken from the schema alone.
 *
 * Python's streaming parser uses the same gate in `_get_child_fields_for_obj`: a component
 * that the catalog's reference map doesn't cover falls back to
 * `is_v0_8_heuristic_child_prop_key` from `a2ui.core.state`, for every protocol version.
 *
 * Delete this file once the conformance catalogs declare their children with `$ref`
 * (#2978).
 */

const SINGLE_CHILD_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'child',
  'contentChild',
  'entryPointChild',
  'componentId',
]);

const CHILD_LIST_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'children',
  'explicitList',
  'template',
  'tabs',
]);

const NON_CHILD_PROP_KEYS: ReadonlySet<string> = new Set([
  'text',
  'title',
  'label',
  'description',
  'icon',
  'url',
  'path',
  'value',
  'key',
  'id',
  'component',
  'type',
  'variant',
  'size',
  'color',
  'action',
  'style',
  'styles',
  'theme',
  'weight',
  'align',
  'distribution',
  'disabled',
  'selected',
]);

/**
 * Returns whether a property name looks like it holds a list of child ids.
 */
export function isInferredChildListKey(key: string): boolean {
  if (NON_CHILD_PROP_KEYS.has(key.toLowerCase())) return false;
  return (
    CHILD_LIST_PROPERTY_NAMES.has(key) || key.endsWith('children') || key.startsWith('children')
  );
}

/**
 * Returns whether a property name looks like it holds a single child id.
 */
export function isInferredSingleChildKey(key: string): boolean {
  if (NON_CHILD_PROP_KEYS.has(key.toLowerCase())) return false;
  return SINGLE_CHILD_PROPERTY_NAMES.has(key) || key.endsWith('Child') || key.startsWith('child');
}
