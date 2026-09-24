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
 * Port of Python's legacy v0.8-era fallback in `a2ui_core` (`component_model.py:50-122`).
 *
 * Heuristically identifies child reference property names when catalog schemas do not
 * define formal `$ref` references (such as `ChildList`, `ComponentId`, or `Child`).
 *
 * Real published catalogs (v0.9, v0.9.1, v1.0) define formal `$ref` references for all
 * container and child-holding components (`Row`, `Column`, `List`, `Card`, `Button`,
 * `Modal`, etc.). Therefore, on real catalogs, this fallback is strictly gated and does
 * not apply to any component declaring formal references.
 *
 * The only remaining consumers of this heuristic are simplified conformance and unit
 * test fixtures where component definitions lack formal `$ref` schemas (specifying
 * child properties as unannotated `{type: array, items: {type: string}}` or raw string
 * shapes).
 *
 * IMPORTANT: This fallback applies ONLY to component definitions that declare NO formal
 * child references in their schema. If a component defines any formal singleRefs or
 * listRefs, this heuristic must be gated and ignored.
 *
 * This file should be deleted if and when all test suites and fixtures without formal
 * child references are retired or upgraded to include formal `$ref` definitions.
 */

const LEGACY_SINGLE_REF_FIELDS: ReadonlySet<string> = new Set([
  'child',
  'contentChild',
  'entryPointChild',
  'componentId',
]);

const LEGACY_LIST_REF_FIELDS: ReadonlySet<string> = new Set([
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
 * Evaluates whether a property key name heuristically represents a child list.
 */
export function isLegacyFallbackChildListKey(key: string): boolean {
  if (NON_CHILD_PROP_KEYS.has(key.toLowerCase())) return false;
  return LEGACY_LIST_REF_FIELDS.has(key) || key.endsWith('children') || key.startsWith('children');
}

/**
 * Evaluates whether a property key name heuristically represents a single child reference.
 */
export function isLegacyFallbackSingleChildKey(key: string): boolean {
  if (NON_CHILD_PROP_KEYS.has(key.toLowerCase())) return false;
  return LEGACY_SINGLE_REF_FIELDS.has(key) || key.endsWith('Child') || key.startsWith('child');
}
