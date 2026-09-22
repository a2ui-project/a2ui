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

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['v1.0']);
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
