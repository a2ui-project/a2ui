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

import {describe, expect} from 'vitest';

import {
  ComponentPruningTransformer,
  FileSystemCatalogProvider,
  FunctionPruningTransformer,
} from '../../src/index.js';
import {loadCases} from './loader.js';
import {conformancePath, expectCatalogContents, registerCase} from './suite-helpers.js';

/** Cases that run but do not pass yet, with the reason for each. */
const KNOWN_FAILURES = new Map<string, string>([]);

describe('Conformance: catalog_transformer.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/catalog_transformer.yaml')])) {
    registerCase(testCase, KNOWN_FAILURES, async () => {
      const args = (testCase.args ?? {}) as {
        catalog: string;
        transformers?: Array<{
          component_pruning?: string[] | null;
          function_pruning?: string[] | null;
        }>;
      };

      const filePath = conformancePath(args.catalog);
      const doc = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      let transformed = new FileSystemCatalogProvider(
        filePath,
        typeof doc.protocolVersion === 'string' ? undefined : '1.0',
        typeof doc.catalogId === 'string' ? undefined : args.catalog,
      ).load();
      for (const transformer of args.transformers ?? []) {
        if (transformer?.component_pruning !== undefined) {
          transformed = new ComponentPruningTransformer(transformer.component_pruning).transform(
            transformed,
          );
        }
        if (transformer?.function_pruning !== undefined) {
          transformed = new FunctionPruningTransformer(transformer.function_pruning).transform(
            transformed,
          );
        }
      }

      const expected = testCase.expect as {
        catalog_id?: string;
        protocol_version?: string;
        components?: string[];
        functions?: string[];
        serialized_defs_contain?: string[];
        serialized_defs_omit?: string[];
      };

      if (expected.catalog_id !== undefined) {
        expect(transformed.id).toBe(expected.catalog_id);
      }
      if (expected.protocol_version !== undefined) {
        expect(transformed.protocolVersion).toBe(expected.protocol_version);
      }
      expectCatalogContents(transformed, expected);

      if (expected.serialized_defs_contain || expected.serialized_defs_omit) {
        const serialized = transformed.toJson() as {$defs?: Record<string, unknown>};
        const defs = serialized.$defs ?? {};
        for (const defName of expected.serialized_defs_contain ?? []) {
          expect(defs).toHaveProperty(defName);
        }
        for (const defName of expected.serialized_defs_omit ?? []) {
          expect(defs).not.toHaveProperty(defName);
        }
      }
    });
  }
});
