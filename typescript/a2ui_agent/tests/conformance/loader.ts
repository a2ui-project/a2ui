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

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {fileURLToPath} from 'url';

// Using __dirname isn't directly available in ESM unless constructed
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFORMANCE_ROOT = path.resolve(__dirname, '../../../../conformance');

export interface TestCase {
  name: string;
  description?: string;
  action: string;
  args?: Record<string, unknown>;
  catalog?: Record<string, unknown>;
  format?: string;
  [key: string]: unknown;
}

export interface LoadedCase extends TestCase {
  sourceFile: string;
}

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['v0.9', 'v1.0']);

/**
 * Conformance cases that run but do not yet pass, with the reason for each.
 *
 * These are expected failures, not skips. The case executes and the suite asserts that it
 * fails, so fixing the underlying gap turns the test red and prompts removal of the entry.
 * Python passes every case listed here, so each one is a real gap in this SDK rather than
 * an aspirational case.
 *
 * Almost none of these are specific to v0.9. The canonical streaming suite is 39 v0.8
 * cases, 41 v0.9 cases and a single v1.0 case, so before v0.9 was enabled this SDK ran one
 * canonical streaming case and relied on local hand-translated fixtures for the rest.
 * Enabling v0.9 is what made the gaps visible; it did not create them.
 */
export const KNOWN_FAILURES = new Map<string, string>([
  // No envelope validation. Python's catalog carries the server-to-client schema and the
  // streaming parser validates messages against it; web_core's Catalog models no such
  // schema, so malformed envelopes pass straight through.
  ['test_create_surface_missing_catalog_id_v09', 'No s2c envelope validation'],
  ['test_strict_begin_rendering_validation_v09', 'No s2c envelope validation'],

  // Partial component emission. The parser yields a component as soon as it can be parsed,
  // where Python holds it back until it satisfies the catalog schema and its children
  // resolve.
  [
    'test_sniff_partial_component_enforces_required_fields_v09',
    'Yields before required props arrive',
  ],
  [
    'test_partial_children_lists_v09',
    'Yields with unresolved children when no placeholder type exists',
  ],
  ['test_partial_template_componentId_v09', 'Yields template child before its path arrives'],
  [
    'test_sniff_partial_component_discards_empty_children_dict_v09',
    'No placeholder for an incomplete child object',
  ],

  // Reachability traversal does not follow a template child reference, so the template
  // component is treated as an orphan and dropped.
  ['test_incremental_data_model_streaming_v09', 'Template child not followed during reachability'],
  ['test_partial_empty_dict_discarded_v09', 'Template child not followed during reachability'],

  // Ordering and state.
  ['test_yield_validation_failure_v09', 'Root existence checked before component validation'],
  ['test_multiple_concurrent_surfaces_v09', 'Active surface overwritten by an interleaved surface'],
  [
    'test_self_reference_detection_v09',
    "web_core raises 'Circular reference detected', case expects 'Self-reference detected'",
  ],

  // Harness gaps rather than SDK gaps.
  ['test_custom_cuttable_keys', 'Harness hardcodes progressiveKeys and ignores customCuttableKeys'],
  [
    'test_generate_system_prompt_with_schema',
    'Harness does not implement the generate_prompt action',
  ],
  [
    'test_generate_system_prompt_v0_9_common_types',
    'Harness does not implement the generate_prompt action',
  ],
]);

const SUPPORTED_FORMATS = new Set(['direct_json']);

export function classify(testCase: TestCase) {
  let version = 'unversioned';
  if (testCase.args?.version) {
    version = testCase.args.version as string;
  } else if (testCase.catalog?.protocolVersion) {
    version = testCase.catalog.protocolVersion as string;
  }

  if (version === '0.9') version = 'v0.9';
  if (version === '1.0') version = 'v1.0';
  if (version === '0.8') version = 'v0.8';

  let format = 'direct_json';
  if (typeof testCase.format === 'string') {
    format = testCase.format;
  } else if (testCase.args && typeof testCase.args.format === 'string') {
    format = testCase.args.format;
  }

  if (version !== 'unversioned' && !SUPPORTED_PROTOCOL_VERSIONS.has(version)) {
    return {runnable: false, reason: `Unsupported protocol version: ${version}`};
  }
  if (!SUPPORTED_FORMATS.has(format)) {
    return {runnable: false, reason: `Unsupported format: ${format}`};
  }

  return {runnable: true, reason: ''};
}

export function loadCases(files: string[]): LoadedCase[] {
  const allCases: LoadedCase[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const docs = yaml.loadAll(content) as Array<
      Record<string, unknown> | Record<string, unknown>[]
    >;
    for (const doc of docs) {
      if (Array.isArray(doc)) {
        for (const item of doc) {
          allCases.push({...(item as TestCase), sourceFile: path.basename(file)});
        }
      } else if (doc) {
        allCases.push({...(doc as TestCase), sourceFile: path.basename(file)});
      }
    }
  }
  return allCases;
}
