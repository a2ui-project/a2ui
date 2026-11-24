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
 * Runs `conformance/agent/builder/builder.yaml` against the plain-object component tree
 * and `flattenComponentTree`.
 *
 * The suite was written for typed fluent builders. Its inputs are nested component
 * objects, which is what the tree layer takes, but most goldens also hold the defaults a
 * typed builder fills in for each catalog component. The tree layer emits only what the
 * author wrote, so those cases are skipped with that reason.
 */

import {readFileSync} from 'fs';

import {expect} from 'vitest';

import {ComponentChild, flattenComponentTree, validatePayload} from '../../src/index.js';
import {loadBasicCatalog} from '../helpers/basic-catalogs.js';
import {LoadedCase, loadCases} from './loader.js';
import {
  assertKnownKeys,
  CASE_METADATA_KEYS,
  conformancePath,
  describeSuite,
} from './suite-helpers.js';

const SUITE = 'agent/builder/builder.yaml';
const GOLDEN_DIR = conformancePath('agent/builder/golden');

const BUILDER_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'catalog_id',
  'data_model',
  'golden',
  'id',
  'input',
  'root_id',
  'surface_id',
  'validation',
  'version',
]);

/**
 * The v1.0 cases whose goldens hold builder defaults the input doesn't state, such as
 * `Text.variant: "body"` or `Column.justify: "start"`.
 */
const CASES_WITH_BUILDER_DEFAULTS = new Set([
  '02_nested_hierarchy_and_slots_v1_0',
  '03_automatic_id_allocation_v1_0',
  '04_data_bindings_v1_0',
  '05_accessibility_attributes_v1_0',
  '06_actions_and_function_calls_v1_0',
  '07_dynamic_child_list_v1_0',
  '08_component_references_v1_0',
  '09_surface_lifecycle_envelopes_v1_0',
  '10_validation_rules_v1_0',
  '11_nested_collection_templates_v1_0',
]);

function skipReason(testCase: LoadedCase): string | undefined {
  if (testCase['version'] !== 'v1.0') {
    return 'the component tree layer targets v1.0 only';
  }
  if (CASES_WITH_BUILDER_DEFAULTS.has(testCase.name)) {
    return 'the golden holds catalog defaults that a typed builder fills in; the plain-object tree emits only what the author wrote';
  }
  return undefined;
}

describeSuite(
  `Conformance: ${SUITE}`,
  loadCases([conformancePath(SUITE)]),
  testCase => {
    assertKnownKeys(testCase, BUILDER_CASE_KEYS, 'builder case');
    const input = testCase['input'] as ComponentChild | ComponentChild[];
    const rootId = testCase['root_id'] as string | undefined;
    const surfaceId = testCase['surface_id'] as string;
    const catalogId = testCase['catalog_id'] as string | undefined;
    const dataModel = (testCase['data_model'] ?? {}) as Record<string, unknown>;

    const messages: Record<string, unknown>[] = [];
    if (catalogId !== undefined) {
      messages.push({version: '1.0', createSurface: {surfaceId, catalogId}});
    }
    messages.push({
      version: '1.0',
      updateComponents: {surfaceId, components: flattenComponentTree(input, {rootId})},
    });
    for (const [path, value] of Object.entries(dataModel)) {
      messages.push({version: '1.0', updateDataModel: {surfaceId, path, value}});
    }

    const golden = JSON.parse(
      readFileSync(`${GOLDEN_DIR}/${testCase['golden'] as string}`, 'utf8'),
    ) as unknown;
    expect(messages).toEqual(golden);
    validatePayload([loadBasicCatalog('1.0')], golden);
  },
  {skipReason},
);
