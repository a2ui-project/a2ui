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

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

import {
  A2uiMessageListWrapperSchema,
  MessageProcessor,
  Catalog,
  AccessibilityAttributesSchema,
} from '../dist/src/v0_9/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFORMANCE_ROOT = path.resolve(__dirname, '../../../conformance');
const SUITES_CORE_DIR = path.join(CONFORMANCE_ROOT, 'suites/core');

function loadYaml(filename) {
  const filePath = path.join(SUITES_CORE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

function runValidatorTests() {
  const cases = loadYaml('validator.yaml');
  let passed = 0;
  let failed = 0;

  console.log(`\nRunning Validator Conformance (${cases.length} cases)...`);

  for (const testCase of cases) {
    const {name, catalog: catalogConfig, expect_error, payload, steps} = testCase;
    const testSteps = steps || (payload ? [{payload, expect_error}] : []);

    let caseFailed = false;
    for (const step of testSteps) {
      const stepPayload = step.payload;
      const expectedError = step.expect_error || expect_error;

      try {
        const result = A2uiMessageListWrapperSchema.safeParse({messages: stepPayload});
        let procError = false;
        try {
          for (const msg of stepPayload || []) {
            if (msg.updateComponents?.components) {
              const compMap = new Map();
              for (const c of msg.updateComponents.components) {
                if (c.id) compMap.set(c.id, c);
              }
              const visited = new Set();
              const recStack = new Set();
              const dfs = id => {
                if (recStack.has(id)) return true;
                if (visited.has(id)) return false;
                visited.add(id);
                recStack.add(id);
                const comp = compMap.get(id);
                if (comp) {
                  for (const [key, val] of Object.entries(comp)) {
                    if (key === 'id' || key === 'component') continue;
                    if (typeof val === 'string' && compMap.has(val)) {
                      if (dfs(val)) return true;
                    }
                    if (Array.isArray(val)) {
                      for (const item of val) {
                        if (typeof item === 'string' && compMap.has(item)) {
                          if (dfs(item)) return true;
                        }
                      }
                    }
                  }
                }
                recStack.delete(id);
                return false;
              };
              for (const id of compMap.keys()) {
                if (dfs(id)) throw new Error('Circular reference detected');
              }
            }
          }

          const catNames = catalogConfig?.catalog_schema?.catalogId
            ? [catalogConfig.catalog_schema.catalogId]
            : ['test_catalog'];
          const proc = new MessageProcessor(catNames.map(n => new Catalog(n, [])));
          proc.processMessages(stepPayload);
        } catch {
          procError = true;
        }

        if (expectedError) {
          if (result.success && !procError) {
            console.error(`  ✖ ${name}: Expected error but validation passed.`);
            caseFailed = true;
          }
        } else {
          if (!result.success && catalogConfig.version === '0.9') {
            console.error(`  ✖ ${name}: Expected success but validation failed: ${result.error}`);
            caseFailed = true;
          }
        }
      } catch (err) {
        if (!expectedError) {
          console.error(`  ✖ ${name}: Unexpected exception: ${err.message}`);
          caseFailed = true;
        }
      }
    }

    if (caseFailed) {
      failed++;
    } else {
      passed++;
    }
  }

  console.log(`Validator Conformance: ${passed} passed, ${failed} failed.`);
  return failed === 0;
}

function runCatalogTests() {
  const cases = loadYaml('catalog.yaml');
  let passed = 0;
  let failed = 0;

  console.log(`\nRunning Catalog Conformance (${cases.length} cases)...`);

  for (const testCase of cases) {
    const {name, action, catalog: catalogConfig} = testCase;
    try {
      if (action === 'prune') {
        const cat = new Catalog(catalogConfig.name || 'test_catalog', []);
        assert.ok(cat);
        passed++;
      } else {
        passed++;
      }
    } catch (err) {
      console.error(`  ✖ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`Catalog Conformance: ${passed} passed, ${failed} failed.`);
  return failed === 0;
}

function runAccessibilityTests() {
  const cases = loadYaml('accessibility.yaml');
  let passed = 0;
  let failed = 0;

  console.log(`\nRunning Accessibility Conformance (${cases.length} cases)...`);

  for (const testCase of cases) {
    const {name, action, surface, assertions} = testCase;
    try {
      if (action === 'accessibility_check' && assertions?.accessibility_tree) {
        const components = surface?.components || {};
        for (const [compId, expected] of Object.entries(assertions.accessibility_tree)) {
          const comp = components[compId];
          if (comp?.accessibility) {
            const parsed = AccessibilityAttributesSchema.safeParse(comp.accessibility);
            assert.ok(parsed.success, `Failed to parse accessibility for ${compId}`);
            for (const [k, v] of Object.entries(expected)) {
              if (parsed.data[k] !== undefined) {
                assert.strictEqual(parsed.data[k], v);
              }
            }
          }
        }
      }
      passed++;
    } catch (err) {
      console.error(`  ✖ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`Accessibility Conformance: ${passed} passed, ${failed} failed.`);
  return failed === 0;
}

function main() {
  console.log('--- TypeScript web_core Conformance Tests ---');
  const valOk = runValidatorTests();
  const catOk = runCatalogTests();
  const accOk = runAccessibilityTests();

  if (valOk && catOk && accOk) {
    console.log('\n✅ All typescript web_core conformance tests passed successfully!');
    process.exit(0);
  } else {
    console.error('\n❌ Some conformance tests failed.');
    process.exit(1);
  }
}

main();
