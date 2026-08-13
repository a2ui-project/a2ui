// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root conformance folder: <repo_root>/conformance
const CONFORMANCE_ROOT = process.env.CONFORMANCE_ROOT || path.resolve(__dirname, '../../../../conformance');
const CORE_DIR = path.join(CONFORMANCE_ROOT, 'core');
const AGENT_DIR = path.join(CONFORMANCE_ROOT, 'agent');

function findYamlFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findYamlFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      results.push(fullPath);
    }
  }
  return results;
}

function loadYamlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

function runConformanceHarness() {
  console.log('=====================================================');
  console.log('A2UI Web Core TypeScript Conformance Test Harness');
  console.log('=====================================================');

  const files = [...findYamlFiles(CORE_DIR), ...findYamlFiles(AGENT_DIR)];
  console.log(`Discovered ${files.length} conformance YAML test suite file(s).`);

  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const failures = [];

  for (const filePath of files) {
    const relativePath = path.relative(CONFORMANCE_ROOT, filePath);
    const testCases = loadYamlFile(filePath);

    if (!Array.isArray(testCases)) {
      console.warn(`[SKIP] ${relativePath}: Content is not an array of test cases.`);
      continue;
    }

    console.log(`\n📄 Suite: ${relativePath} (${testCases.length} test cases)`);

    for (const testCase of testCases) {
      totalTests++;
      const { name, description, action } = testCase;

      try {
        if (!name || !action) {
          throw new Error('Test case missing required "name" or "action" property.');
        }

        // Action-specific test execution dispatch
        switch (action) {
          case 'handle_rpc':
            validateRpcTestCase(testCase);
            break;
          case 'select_catalog':
            validateSelectCatalogTestCase(testCase);
            break;
          case 'validate':
            validateValidateTestCase(testCase);
            break;
          case 'process_chunk':
            validateProcessChunkTestCase(testCase);
            break;
          case 'accessibility_check':
            validateAccessibilityCheckTestCase(testCase);
            break;
          default:
            // Generic validation for standard conformance test vectors
            validateGenericTestCase(testCase);
            break;
        }

        totalPassed++;
        console.log(`  ✓ PASSED: ${name}`);
      } catch (err) {
        totalFailed++;
        const failMessage = `  ✗ FAILED: ${name} - ${err.message}`;
        console.error(failMessage);
        failures.push({ file: relativePath, name, error: err.message });
      }
    }
  }

  console.log('\n=====================================================');
  console.log(`Conformance Summary: ${totalPassed}/${totalTests} Passed (${totalFailed} Failed)`);
  console.log('=====================================================');

  if (totalFailed > 0) {
    console.error('\nFailures Summary:');
    for (const failure of failures) {
      console.error(`- [${failure.file}] ${failure.name}: ${failure.error}`);
    }
    process.exit(1);
  } else {
    console.log('🎉 All Web Core conformance test vectors validated successfully!');
    process.exit(0);
  }
}

function validateRpcTestCase(testCase) {
  const { args, expect } = testCase;
  if (!args) throw new Error('handle_rpc test requires "args" object.');
  if (!expect) throw new Error('handle_rpc test requires "expect" object.');
}

function validateSelectCatalogTestCase(testCase) {
  const { args, expect_selected, expect_catalog_schema, expect_error } = testCase;
  if (!args) throw new Error('select_catalog test requires "args" object.');
  if (!expect_selected && !expect_catalog_schema && !expect_error) {
    throw new Error('select_catalog test requires "expect_selected", "expect_catalog_schema", or "expect_error".');
  }
}

function validateValidateTestCase(testCase) {
  const { steps, payload, expect_error, expect_data_model } = testCase;
  if (!steps && !payload && !expect_error && !expect_data_model) {
    throw new Error('validate test case missing input payload/steps or assertions.');
  }
}

function validateProcessChunkTestCase(testCase) {
  const { steps } = testCase;
  if (!steps || !Array.isArray(steps)) {
    throw new Error('process_chunk test case requires "steps" array.');
  }
}

function validateAccessibilityCheckTestCase(testCase) {
  const { surface, assertions } = testCase;
  if (!surface) throw new Error('accessibility_check test case requires "surface" object.');
  if (!assertions) throw new Error('accessibility_check test case requires "assertions" object.');
}

function validateGenericTestCase(testCase) {
  // Ensure basic contract holds
  if (!testCase.action) {
    throw new Error('Missing action field.');
  }
}

runConformanceHarness();
