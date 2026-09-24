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
export const KNOWN_FAILURES = new Map<string, string>([]);

const SUPPORTED_FORMATS = new Set(['direct_json']);

/**
 * Conformance actions this SDK has no implementation for. Their cases are skipped with the
 * reason given, rather than falling through the harness and passing without running.
 */
const UNIMPLEMENTED_ACTIONS = new Map<string, string>([
  ['from_format', 'skill generation is not implemented'],
  ['core_syntax', 'skill generation is not implemented'],
  ['from_catalog', 'skill generation is not implemented'],
  ['skill_set', 'skill generation is not implemented'],
]);

export function classify(testCase: TestCase) {
  const unimplemented = UNIMPLEMENTED_ACTIONS.get(testCase.action);
  if (unimplemented) {
    return {runnable: false, reason: unimplemented};
  }

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
