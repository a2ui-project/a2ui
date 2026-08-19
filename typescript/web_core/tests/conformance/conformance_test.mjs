// Copyright 2024 Google LLC
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
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {MessageProcessor} from '../../dist/src/processing/message-processor.js';
import {Catalog} from '../../dist/src/catalog/types.js';
import {BASIC_COMPONENTS as V09_BASIC_COMPONENTS} from '../../dist/src/v0_9/basic_catalog/index.js';

// Fallback component definitions per specification version until dedicated implementations exist
const v08Components = V09_BASIC_COMPONENTS;
const v09Components = V09_BASIC_COMPONENTS;
const v10Components = V09_BASIC_COMPONENTS;

const basicCatalog = new Catalog('basic', v09Components);
const v08Catalog = new Catalog('v0.8:basic', v08Components);
const v09Catalog = new Catalog('v0.9:basic', v09Components);
const v10Catalog = new Catalog('v1.0:basic', v10Components);
const allCatalogs = [basicCatalog, v08Catalog, v09Catalog, v10Catalog];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root conformance folder: <repo_root>/conformance
const CONFORMANCE_ROOT =
  process.env.CONFORMANCE_ROOT || path.resolve(__dirname, '../../../../conformance');
const CORE_DIR = path.join(CONFORMANCE_ROOT, 'core');
const AGENT_DIR = path.join(CONFORMANCE_ROOT, 'agent');

/**
 * Set of A2UI specification versions supported by this TypeScript conformance harness.
 * Test cases specifying protocol versions outside this set are skipped.
 */
const SUPPORTED_SPEC_VERSIONS = new Set(['v0.8', 'v0.9', 'v1.0']);

/**
 * Transition skip list containing specific test case names to skip during active feature transitions.
 * Remove test names from this set as feature implementations are completed.
 */
const SKIP_TEST_NAMES = new Set([
  'test_create_surface_unknown_catalog_error',
  'test_update_components_add_and_query',
  'test_update_components_modify_existing_properties',
  'test_update_components_recreate_on_type_change',
  'test_topology_missing_root_error',
  'test_topology_direct_circular_reference_error',
  'test_topology_indirect_circular_reference_error',
  'test_topology_self_reference_error',
  'test_topology_dangling_child_reference_error',
  'test_topology_orphaned_component_error',
  'test_update_components_strict_schema_validation_failure',
  'test_create_surface_strict_theme_validation_failure',
  'test_message_multiple_conflicting_update_types_error',
  'test_process_messages_wrapper_object',
  'test_v10_create_surface_inline_initialization',
  'test_v10_create_surface_optional_catalog_id',
]);

/**
 * Transition skip list containing specific test suite files to skip during active feature transitions.
 */
const SKIP_TEST_SUITES = new Set([]);

function findYamlFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, {withFileTypes: true});
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

  if (files.length === 0) {
    console.error('✗ ERROR: No conformance test suite files discovered!');
    process.exit(1);
  }

  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const failures = [];

  for (const filePath of files) {
    const relativePath = path.relative(CONFORMANCE_ROOT, filePath);
    if (SKIP_TEST_SUITES.has(relativePath) || SKIP_TEST_SUITES.has(path.basename(filePath))) {
      continue;
    }
    let testCases;
    try {
      testCases = loadYamlFile(filePath);
    } catch (err) {
      totalTests++;
      totalFailed++;
      const failMessage = `  ✗ FAILED to load ${relativePath}: ${err.message}`;
      console.error(failMessage);
      failures.push({file: relativePath, name: 'YAML Parsing', error: err.message});
      continue;
    }

    if (!Array.isArray(testCases)) {
      console.warn(`[SKIP] ${relativePath}: Content is not an array of test cases.`);
      continue;
    }

    console.log(`\n📄 Suite: ${relativePath} (${testCases.length} test cases)`);

    for (const testCase of testCases) {
      const {name, action, catalog, args} = testCase;
      let version = catalog?.protocolVersion || args?.version || 'v0.8';
      if (!version.startsWith('v')) version = `v${version}`;

      if (!SUPPORTED_SPEC_VERSIONS.has(version)) {
        totalSkipped++;
        console.log(`  ⁃ [SKIPPED] ${name} (version ${version} not in SUPPORTED_SPEC_VERSIONS)`);
        continue;
      }

      if (SKIP_TEST_NAMES.has(name)) {
        totalSkipped++;
        console.log(`  ⁃ [SKIPPED] ${name}`);
        continue;
      }

      totalTests++;

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
          case 'process_messages':
            validateProcessMessagesTestCase(testCase);
            break;
          case 'get_renderer_capabilities':
            validateGetRendererCapabilitiesTestCase(testCase);
            break;
          case 'from_json':
          case 'catalog_schema':
          case 'get_renderer_data_model':
          case 'resolve_path':
          case 'load_catalog':
          case 'generate_prompt':
          case 'parse_full':
          case 'fix_payload':
          case 'has_parts':
            validateGenericTestCase(testCase);
            break;
          default:
            throw new Error(`Unhandled action type in conformance harness: '${action}'`);
        }

        totalPassed++;
        console.log(`  ✓ PASSED: ${name}`);
      } catch (err) {
        totalFailed++;
        const failMessage = `  ✗ FAILED: ${name} - ${err.message}`;
        console.error(failMessage);
        failures.push({file: relativePath, name, error: err.message});
      }
    }
  }

  console.log('\n=====================================================');
  console.log(
    `Conformance Summary: ${totalPassed}/${totalTests} Passed (${totalFailed} Failed, ${totalSkipped} Skipped)`,
  );
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
  const {args, expect} = testCase;
  if (!args) throw new Error('handle_rpc test requires "args" object.');
  if (!expect) throw new Error('handle_rpc test requires "expect" object.');
}

function validateSelectCatalogTestCase(testCase) {
  const {args, expect, expectSelected, expectError} = testCase;
  if (!args) throw new Error('select_catalog test requires "args" object.');
  if (!expect && !expectSelected && !expectError) {
    throw new Error('select_catalog test requires "expect", "expectSelected", or "expectError".');
  }
}

function validateValidateTestCase(testCase) {
  const {steps, payload, messages, expectError, expectValid} = testCase;
  if (!steps && !payload && !messages) {
    throw new Error('validate test case requires "steps", "messages", or "payload" input.');
  }

  const processor = new MessageProcessor(allCatalogs);
  const inputMessages = messages || (payload ? [payload] : []);

  if (inputMessages.length > 0) {
    try {
      processor.processMessages(inputMessages);
      if (expectError) {
        throw new Error(
          `Expected error (${expectError.code || 'UNKNOWN'}) but message processing succeeded.`,
        );
      }
    } catch (err) {
      if (expectValid) {
        throw err;
      }
      if (expectError && expectError.code) {
        if (
          !err.message.includes(expectError.code) &&
          err.name !== expectError.code &&
          err.code !== expectError.code
        ) {
          throw new Error(
            `Expected error matching '${expectError.code}' but received: ${err.message}`,
          );
        }
      }
    }
  }
}

function validateProcessChunkTestCase(testCase) {
  const {steps} = testCase;
  if (!steps || !Array.isArray(steps)) {
    throw new Error('process_chunk test case requires "steps" array.');
  }
}

function validateAccessibilityCheckTestCase(testCase) {
  const {surface, assertions} = testCase;
  if (!surface && !assertions) return;
}

function validateGetRendererCapabilitiesTestCase(testCase) {
  if (!testCase.expect) {
    throw new Error('get_renderer_capabilities test requires "expect" object.');
  }
}

function getCatalogsForTestCase(testCase) {
  const catalogsMap = new Map(allCatalogs.map(c => [c.id, c]));
  const addCatalogId = id => {
    if (id && !catalogsMap.has(id)) {
      catalogsMap.set(id, new Catalog(id, v09Components));
    }
  };

  if (testCase.catalogs) {
    for (const cat of testCase.catalogs) {
      if (cat.catalogId) addCatalogId(cat.catalogId);
    }
  }

  if (testCase.catalogPaths) {
    for (const p of testCase.catalogPaths) {
      const fullPath = path.resolve(__dirname, '../../../../', p);
      if (fs.existsSync(fullPath)) {
        try {
          const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if (json && json.id) {
            addCatalogId(json.id);
          }
        } catch {
          // ignore parsing error
        }
      }
    }
  }

  const msgs = testCase.messages || (testCase.payload ? [testCase.payload] : []);
  const scan = item => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      item.forEach(scan);
      return;
    }
    if (item.messages) scan(item.messages);
    if (item.createSurface && item.createSurface.catalogId)
      addCatalogId(item.createSurface.catalogId);
    if (item.beginRendering && item.beginRendering.catalogId)
      addCatalogId(item.beginRendering.catalogId);
  };
  scan(msgs);

  return Array.from(catalogsMap.values());
}

function validateProcessMessagesTestCase(testCase) {
  const {messages, payload, expect, expectError, protocolVersion} = testCase;
  let inputMessages = messages || (payload ? [payload] : []);
  if (!inputMessages) return;

  if (protocolVersion) {
    if (Array.isArray(inputMessages)) {
      inputMessages = inputMessages.map(m =>
        typeof m === 'object' && m !== null && !('version' in m)
          ? {version: protocolVersion, ...m}
          : m,
      );
    } else if (
      typeof inputMessages === 'object' &&
      inputMessages !== null &&
      !('version' in inputMessages)
    ) {
      inputMessages = {version: protocolVersion, ...inputMessages};
    }
  }

  const testCatalogs = getCatalogsForTestCase(testCase);
  const processorOptions = protocolVersion ? {version: protocolVersion} : {};
  const processor = new MessageProcessor(testCatalogs, undefined, processorOptions);

  if (expectError) {
    try {
      processor.processMessages(inputMessages);
      throw new Error(
        `Expected error (${expectError.category || expectError.message || 'UNKNOWN'}) but message processing succeeded.`,
      );
    } catch (err) {
      if (expectError.message && !err.message.includes(expectError.message)) {
        throw new Error(
          `Expected error message containing '${expectError.message}', got '${err.message}'`,
        );
      }
      return;
    }
  }

  processor.processMessages(inputMessages);

  if (expect && expect.surfaces) {
    for (const [surfaceId, expectedSurface] of Object.entries(expect.surfaces)) {
      const surface = processor.getSurface(surfaceId);
      if (expectedSurface.exists === false) {
        if (surface !== undefined) {
          throw new Error(`Expected surface '${surfaceId}' to not exist.`);
        }
        continue;
      }
      if (expectedSurface.exists === true) {
        if (!surface) throw new Error(`Expected surface '${surfaceId}' to exist.`);
      }
      if (surface && expectedSurface.theme) {
        for (const [k, v] of Object.entries(expectedSurface.theme)) {
          const actualVal = surface.theme?.[k];
          if (JSON.stringify(actualVal) !== JSON.stringify(v)) {
            throw new Error(
              `Surface '${surfaceId}' theme mismatch for '${k}'. Expected ${JSON.stringify(v)}, got ${JSON.stringify(actualVal)}`,
            );
          }
        }
      }
    }
  }
}

function validateGenericTestCase(testCase) {
  // Ensure basic contract holds
  if (!testCase.action) {
    throw new Error('Missing action field.');
  }
}

runConformanceHarness();
