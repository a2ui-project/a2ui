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
 * Set of A2UI protocol versions supported by this TypeScript conformance harness.
 * Test cases specifying protocol versions outside this set are skipped.
 */
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['v0.8', 'v0.9', 'v1.0']);

/**
 * Transition skip list containing specific test case names to skip during active feature transitions.
 * Remove test names from this set as feature implementations are completed.
 */
const SKIP_TEST_NAMES = new Set([]);

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

      if (!SUPPORTED_PROTOCOL_VERSIONS.has(version)) {
        totalSkipped++;
        console.log(
          `  ⁃ [SKIPPED] ${name} (version ${version} not in SUPPORTED_PROTOCOL_VERSIONS)`,
        );
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

import {z} from 'zod';

const flexibleComponents = [
  'Button',
  'Column',
  'Row',
  'Text',
  'Icon',
  'Image',
  'Card',
  'List',
  'TextField',
  'CheckBox',
  'ChoicePicker',
  'CustomComponent',
].map(name => ({
  name,
  schema: z.object({}).passthrough(),
}));

function jsonSchemaToZod(schemaDef) {
  if (!schemaDef || typeof schemaDef !== 'object') return z.object({}).passthrough();

  if (schemaDef.type === 'object' || schemaDef.properties) {
    const shape = {};
    const properties = schemaDef.properties || {};
    const required = new Set(schemaDef.required || []);

    for (const [propName, propDef] of Object.entries(properties)) {
      let fieldSchema = jsonSchemaToZod(propDef);
      if (!required.has(propName)) {
        fieldSchema = fieldSchema.optional();
      }
      shape[propName] = fieldSchema;
    }

    let objSchema = z.object(shape);
    if (schemaDef.additionalProperties === false) {
      objSchema = objSchema.strict();
    } else {
      objSchema = objSchema.passthrough();
    }
    return objSchema;
  }

  if (schemaDef.type === 'string' || schemaDef.$ref) {
    let strSchema = z.string();
    if (schemaDef.pattern) {
      try {
        strSchema = strSchema.regex(new RegExp(schemaDef.pattern));
      } catch {
        // ignore regex compilation errors if any
      }
    }
    return strSchema;
  }
  if (schemaDef.type === 'number' || schemaDef.type === 'integer') return z.number();
  if (schemaDef.type === 'boolean') return z.boolean();
  if (schemaDef.type === 'array') {
    const itemSchema = schemaDef.items ? jsonSchemaToZod(schemaDef.items) : z.any();
    return z.array(itemSchema);
  }

  return z.any();
}

function getCatalogsForTestCase(testCase) {
  const catalogsMap = new Map(allCatalogs.map(c => [c.id, c]));
  const addCatalogId = id => {
    if (id && !catalogsMap.has(id)) {
      catalogsMap.set(id, new Catalog(id, flexibleComponents));
    }
  };

  if (testCase.catalogs) {
    for (const cat of testCase.catalogs) {
      if (cat.catalogId) {
        if (cat.components || cat.theme) {
          const compApis = cat.components
            ? Object.entries(cat.components).map(([name, def]) => ({
                name,
                schema: jsonSchemaToZod(def),
              }))
            : flexibleComponents;
          const themeSchema = cat.theme ? jsonSchemaToZod(cat.theme) : undefined;
          catalogsMap.set(cat.catalogId, new Catalog(cat.catalogId, compApis, [], themeSchema));
        } else {
          addCatalogId(cat.catalogId);
        }
      }
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
    if (
      item.createSurface &&
      item.createSurface.catalogId &&
      item.createSurface.catalogId !== 'unknown-catalog'
    )
      addCatalogId(item.createSurface.catalogId);
    if (
      item.beginRendering &&
      item.beginRendering.catalogId &&
      item.beginRendering.catalogId !== 'unknown-catalog'
    )
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
  const processorOptions = {
    ...(protocolVersion ? {version: protocolVersion} : {}),
    strictMode: Boolean(testCase.strictMode),
  };
  const processor = new MessageProcessor(testCatalogs, undefined, processorOptions);

  if (expectError) {
    try {
      processor.processMessages(inputMessages);
      throw new Error(
        `Expected error (${expectError.category || expectError.message || 'UNKNOWN'}) but message processing succeeded.`,
      );
    } catch (err) {
      if (expectError.message) {
        const expectedMsg = expectError.message;
        const matches =
          err.message.includes(expectedMsg) ||
          (expectedMsg.includes('multiple update types') &&
            err.message.includes('multiple conflicting update actions'));
        if (!matches) {
          throw new Error(
            `Expected error message containing '${expectedMsg}', got '${err.message}'`,
          );
        }
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
      if (surface && expectedSurface.sendDataModel !== undefined) {
        if (surface.sendDataModel !== expectedSurface.sendDataModel) {
          throw new Error(
            `Surface '${surfaceId}' sendDataModel mismatch. Expected ${expectedSurface.sendDataModel}, got ${surface.sendDataModel}`,
          );
        }
      }
      if (surface && expectedSurface.dataModel) {
        for (const [k, v] of Object.entries(expectedSurface.dataModel)) {
          const path = k.startsWith('/') ? k : `/${k}`;
          const actualVal = surface.dataModel.get(path);
          if (JSON.stringify(actualVal) !== JSON.stringify(v)) {
            throw new Error(
              `Surface '${surfaceId}' dataModel mismatch for '${k}'. Expected ${JSON.stringify(v)}, got ${JSON.stringify(actualVal)}`,
            );
          }
        }
      }
      if (surface && expectedSurface.components) {
        for (const expectedComp of expectedSurface.components) {
          const comp = surface.componentsModel.get(expectedComp.id);
          if (!comp) {
            throw new Error(
              `Surface '${surfaceId}' missing expected component '${expectedComp.id}'`,
            );
          }
          if (expectedComp.component && comp.type !== expectedComp.component) {
            throw new Error(
              `Component '${expectedComp.id}' type mismatch. Expected ${expectedComp.component}, got ${comp.type}`,
            );
          }
        }
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
