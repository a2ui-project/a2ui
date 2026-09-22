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

import {describe, test, expect} from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {DirectJsonStreamProcessorImpl} from '../../../../src/inference_formats/direct_json/streaming.js';
import {SchemaCatalog} from '../../../../src/types.js';
import {Catalog, ComponentApi} from '../../../../src/internal/web_core.js';
import {} from '../../../../src/errors.js';

interface TestCase {
  name: string;
  catalog: any;
  steps: {
    input: string;
    expect?: any;
    expectError?: any;
  }[];
}

const casesPath = path.resolve(
  __dirname,
  '../../../../tests/streaming_cases/v1_0_direct_json.yaml',
);
const casesContent = fs.readFileSync(casesPath, 'utf8');
const docs = yaml.loadAll(casesContent) as TestCase[][];
const cases = docs.flat();

describe('Direct JSON Streaming Healer v1.0', () => {
  for (const tc of cases) {
    test(tc.name, () => {
      // Mock catalog based on the YAML
      const catalogSchema = tc.catalog.catalogSchema || {};
      const componentsMap = new Map<string, ComponentApi>();
      if (catalogSchema.components) {
        for (const [name, def] of Object.entries(catalogSchema.components)) {
          componentsMap.set(name, {
            name,
            schema: def,
          } as ComponentApi);
        }
      }

      if (!componentsMap.has('Row')) {
        componentsMap.set('Row', {name: 'Row', schema: {}} as ComponentApi);
      }

      const catalog: SchemaCatalog = new Catalog(
        'https://test.com/catalog.json',
        Array.from(componentsMap.values()),
        [],
        undefined,
        undefined,
        'v1.0',
      );

      // Set up cuttable keys
      const progressiveKeys = ['text', 'literalString'];

      const processor = new DirectJsonStreamProcessorImpl(catalog, {progressiveKeys});

      // Inject refMap because the mock catalog uses JSON schemas instead of Zod schemas
      const refMap: any = {};
      if (catalogSchema.components) {
        for (const [name, def] of Object.entries(catalogSchema.components) as any) {
          const singleRefs = new Set<string>();
          const listRefs = new Set<string>();
          if (def.properties) {
            for (const [propName, propDef] of Object.entries(def.properties) as any) {
              if (propDef.title === 'ComponentId' || propDef.title === 'ChildComponentId') {
                singleRefs.add(propName);
              } else if (propDef.type === 'array' && propDef.items?.title === 'ComponentId') {
                listRefs.add(propName);
              } else if (propName === 'children') {
                listRefs.add(propName);
              } else if (propName === 'child') {
                singleRefs.add(propName);
              }
            }
          }
          refMap[name] = {singleRefs, listRefs};
        }
      }
      (processor as any).refMap = refMap;

      for (const step of tc.steps) {
        if (step.expectError) {
          let expectedCategory = step.expectError;
          if (typeof step.expectError === 'object' && step.expectError.category) {
            expectedCategory = step.expectError.category;
          }
          if (expectedCategory === 'RecursionError') {
            expect(() => processor.processChunk(step.input)).toThrowError(/Circular/);
          } else if (expectedCategory === 'IntegrityError') {
            expect(() => processor.processChunk(step.input)).toThrowError(/Integrity/);
          } else {
            expect(() => processor.processChunk(step.input)).toThrowError();
          }
        } else if (step.expect) {
          const parts = processor.processChunk(step.input);
          const adaptedParts = parts.map(p => {
            if (p.type === 'a2ui' && Array.isArray(p.a2ui)) {
              for (const m of p.a2ui) {
                if (m.version) delete (m as any).version;
              }
            }
            if (p.type === 'text') {
              return {text: p.text};
            }
            return {a2ui: p.a2ui};
          });
          expect(adaptedParts).toEqual(step.expect);
        } else {
          processor.processChunk(step.input);
        }
      }
    });
  }
});
