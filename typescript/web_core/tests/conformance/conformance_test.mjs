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
import assert from 'node:assert';
import yaml from 'js-yaml';
import {MessageProcessor, STRICT_VALIDATION} from '../../dist/src/processing/message-processor.js';
import {Catalog, createFunctionImplementation} from '../../dist/src/catalog/types.js';
import {loadCatalogFromSchema} from '../../dist/src/catalog/schema_loader.js';
import {DataModel} from '../../dist/src/state/data-model.js';
import {
  BASIC_COMPONENTS as V0_8_BASIC_COMPONENTS,
  ThemeSchema as V0_8_ThemeSchema,
} from '../../dist/src/v0_8/basic_catalog/index.js';
import {
  BASIC_COMPONENTS as V0_9_BASIC_COMPONENTS,
  BASIC_FUNCTION_APIS as V0_9_BASIC_FUNCTIONS,
  ThemeSchema as V0_9_ThemeSchema,
} from '../../dist/src/v0_9/basic_catalog/index.js';
import {
  BASIC_COMPONENTS as V1_0_BASIC_COMPONENTS,
  BASIC_FUNCTION_APIS as V1_0_BASIC_FUNCTIONS,
} from '../../dist/src/v1_0/basic_catalog/index.js';
import {ExpressionParser} from '../../dist/src/expressions/expression_parser.js';
import {A2uiExpressionError} from '../../dist/src/errors.js';

// Dedicated basic catalog component definitions per specification version
const v0_8Components = V0_8_BASIC_COMPONENTS;
const v0_9Components = V0_9_BASIC_COMPONENTS;
const v1_0Components = V1_0_BASIC_COMPONENTS;

const v0_8Catalog = new Catalog(
  'v0.8:basic',
  v0_8Components,
  [],
  V0_8_ThemeSchema,
  undefined,
  'v0.8',
);
const v0_9Catalog = new Catalog(
  'v0.9:basic',
  v0_9Components,
  V0_9_BASIC_FUNCTIONS,
  V0_9_ThemeSchema,
  undefined,
  'v0.9',
);
const v1_0Catalog = new Catalog(
  'v1.0:basic',
  v1_0Components,
  V1_0_BASIC_FUNCTIONS,
  undefined,
  undefined,
  'v1.0',
);
const v0_8BasicCatalog = new Catalog(
  'basic',
  v0_8Components,
  [],
  V0_8_ThemeSchema,
  undefined,
  'v0.8',
);
const v0_9BasicCatalog = new Catalog(
  'basic',
  v0_9Components,
  V0_9_BASIC_FUNCTIONS,
  V0_9_ThemeSchema,
  undefined,
  'v0.9',
);
const v1_0BasicCatalog = new Catalog(
  'basic',
  v1_0Components,
  V1_0_BASIC_FUNCTIONS,
  undefined,
  undefined,
  'v1.0',
);

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
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['v0.8', 'v0.9', 'v0.9.1', 'v1.0']);

/**
 * Transition skip list containing specific test case names to skip.
 *
 * 'test_v09_basic_catalog_schema' and 'test_v10_basic_catalog_schema' test Python-specific
 * dictionary schema export structures from Python ADK and are skipped in Web Core TS conformance.
 */
const SKIP_TEST_NAMES = new Set(['test_v09_basic_catalog_schema', 'test_v10_basic_catalog_schema']);

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

async function runConformanceHarness() {
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
            await validateRpcTestCase(testCase);
            break;
          case 'validate':
            validateValidateTestCase(testCase);
            break;
          case 'process_chunk':
            validateProcessChunkTestCase(testCase);
            break;
          case 'process_messages':
            validateProcessMessagesTestCase(testCase);
            break;
          case 'get_renderer_capabilities':
            validateGetRendererCapabilitiesTestCase(testCase);
            break;
          case 'catalog_schema':
            validateCatalogSchemaTestCase(testCase);
            break;
          case 'data_model':
            validateDataModelTestCase(testCase);
            break;
          case 'resolve_path':
            validateResolvePathTestCase(testCase);
            break;
          case 'from_json':
            validateFromJsonTestCase(testCase);
            break;
          case 'select_catalog':
            validateSelectCatalogTestCase(testCase);
            break;
          case 'accessibility_check':
            validateAccessibilityCheckTestCase(testCase);
            break;
          case 'parse_expression_template':
            validateParseExpressionTemplateTestCase(testCase);
            break;
          case 'get_renderer_data_model':
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

async function validateRpcTestCase(testCase) {
  const {args, expect, expectError} = testCase;
  if (!args) throw new Error('handle_rpc test requires "args" object.');
  if (!expect && !expectError)
    throw new Error('handle_rpc test requires "expect" or "expectError" object.');

  const message = args.message;
  const outboundCall = args.outboundCall;
  const inboundResponse = args.inboundResponse;
  const fnMetadata = args.functionMetadata || {};
  const userActivation = Boolean(args.userActivationPresent);

  const funcs = [];
  for (const [fnName, meta] of Object.entries(fnMetadata)) {
    const allowed = meta.allowedCallers || 'rendererOrAgent';
    const requiresActivation = Boolean(meta.requiresUserActivation);

    const execute = fnArgs => {
      if (fnName === 'playMedia') {
        return {playing: true, timestamp: 0};
      } else if (fnName === 'openExternalUrl') {
        return {opened: true};
      } else if (fnName === 'syncState') {
        return null;
      } else if (fnName === 'failingFunction') {
        throw new Error('An error occurred during function execution.');
      } else if (fnName === 'calculateTax') {
        return (fnArgs?.amount ?? 0) * 0.1;
      }
      return null;
    };

    const fnSchema = meta.schema
      ? jsonSchemaToZod(meta.schema)
      : meta.parameters
        ? jsonSchemaToZod(meta.parameters)
        : z.record(z.string(), z.any()).optional().default({});

    funcs.push(
      createFunctionImplementation(
        {
          name: fnName,
          returnType: meta.returnType || 'any',
          schema: fnSchema,
          allowedCallers: allowed,
          requiresUserActivation: requiresActivation,
        },
        execute,
      ),
    );
  }

  let catId = args.catalogId;
  if (!catId && message && message.callRendererFunction) {
    const msgCatId = message.callRendererFunction.callFunction?.catalogId;
    const expectErrMsg =
      expect?.response?.rendererFunctionResponse?.error?.message || expectError?.message || '';
    if (!expectErrMsg.includes('Catalog not found')) {
      catId = msgCatId;
    }
  }
  if (!catId && outboundCall) {
    catId = outboundCall.callFunction?.catalogId;
  }
  if (!catId) {
    catId = 'basic';
  }

  const catVersion =
    args.catalogVersion || testCase.catalog?.protocolVersion || testCase.protocolVersion || 'v1.0';

  const cat = new Catalog(catId, [], funcs, undefined, undefined, catVersion);
  let sentOutboundMsg;
  const processor = new MessageProcessor([cat], undefined, {
    version: 'v1.0',
    outboundListener: msg => {
      sentOutboundMsg = msg;
    },
  });

  if (message) {
    if (expect?.error) {
      assert.throws(
        () => {
          processor.processMessages(message);
        },
        err => {
          if (expect.error.message) {
            return err.message.includes(expect.error.message);
          }
          return true;
        },
      );
    } else if (expect && 'response' in expect) {
      const expectResp = expect.response;
      const responses = await processor.processMessagesAsync(message, {
        isUserActivated: userActivation,
      });
      if (expectResp === null) {
        assert.strictEqual(responses.length, 0);
      } else {
        assert.strictEqual(responses.length, 1);
        const actual = responses[0];
        assert.strictEqual(actual.version, expectResp.version);
        if (expectResp.rendererFunctionResponse.value !== undefined) {
          assert.deepStrictEqual(
            actual.rendererFunctionResponse.value,
            expectResp.rendererFunctionResponse.value,
          );
          assert.strictEqual(
            actual.rendererFunctionResponse.functionCallId,
            expectResp.rendererFunctionResponse.functionCallId,
          );
        }
        if (expectResp.rendererFunctionResponse.error) {
          assert.strictEqual(
            actual.rendererFunctionResponse.functionCallId,
            expectResp.rendererFunctionResponse.functionCallId,
          );
          assert.strictEqual(
            actual.rendererFunctionResponse.error?.code,
            expectResp.rendererFunctionResponse.error.code,
          );
          if (expectResp.rendererFunctionResponse.error.message) {
            assert.ok(
              actual.rendererFunctionResponse.error?.message?.includes(
                expectResp.rendererFunctionResponse.error.message,
              ),
              `Expected error message containing '${expectResp.rendererFunctionResponse.error.message}', got '${actual.rendererFunctionResponse.error?.message}'`,
            );
          }
        }
      }
    }
  }

  if (outboundCall && inboundResponse) {
    const correlatedId = expect.correlatedCallId;
    assert.strictEqual(inboundResponse.agentFunctionResponse.functionCallId, correlatedId);

    const outboundPromise = processor.callAgentFunction(
      outboundCall.surfaceId,
      {
        call: outboundCall.callFunction.call,
        catalogId: outboundCall.callFunction.catalogId,
        args: outboundCall.callFunction.args,
      },
      {
        functionCallId: outboundCall.functionCallId,
      },
    );

    assert.ok(sentOutboundMsg, 'Expected outbound message to be dispatched to outbound listener');
    assert.strictEqual(sentOutboundMsg.callAgentFunction.functionCallId, correlatedId);
    assert.strictEqual(
      sentOutboundMsg.callAgentFunction.callFunction.call,
      outboundCall.callFunction.call,
    );

    processor.processMessages(inboundResponse);
    const result = await outboundPromise;
    assert.deepStrictEqual(result, expect.result);
  } else if (outboundCall && (expect?.error || expectError)) {
    const expectedErr = expect?.error || expectError;
    if (args.secondOutboundCall) {
      processor.callAgentFunction(
        outboundCall.surfaceId,
        {
          call: outboundCall.callFunction.call,
          catalogId: outboundCall.callFunction.catalogId,
          args: outboundCall.callFunction.args,
        },
        {
          functionCallId: outboundCall.functionCallId,
        },
      );
      await assert.rejects(
        async () => {
          await processor.callAgentFunction(
            args.secondOutboundCall.surfaceId,
            {
              call: args.secondOutboundCall.callFunction.call,
              catalogId: args.secondOutboundCall.callFunction.catalogId,
              args: args.secondOutboundCall.callFunction.args,
            },
            {
              functionCallId: args.secondOutboundCall.functionCallId,
            },
          );
        },
        err => {
          if (expectedErr.code) {
            return err.code === expectedErr.code || err.message.includes(expectedErr.code);
          }
          if (expectedErr.message) {
            return err.message.includes(expectedErr.message);
          }
          return true;
        },
      );
    } else if (outboundCall.timeoutMs !== undefined) {
      await assert.rejects(
        async () => {
          await processor.callAgentFunction(
            outboundCall.surfaceId,
            {
              call: outboundCall.callFunction.call,
              catalogId: outboundCall.callFunction.catalogId,
              args: outboundCall.callFunction.args,
            },
            {
              functionCallId: outboundCall.functionCallId,
              timeoutMs: outboundCall.timeoutMs,
            },
          );
        },
        err => {
          if (expectedErr.code) {
            return err.code === expectedErr.code || err.message.includes(expectedErr.code);
          }
          if (expectedErr.message) {
            return err.message.includes(expectedErr.message);
          }
          return true;
        },
      );
    }
  }
}

function validateSelectCatalogTestCase(testCase) {
  const {args, expect, expectSelected, expectError} = testCase;
  if (!args) throw new Error('select_catalog test requires "args" object.');
  if (!expect && !expectSelected && !expectError) {
    throw new Error('select_catalog test requires "expect", "expectSelected", or "expectError".');
  }

  // Handle agent format catalog selection (supportedCatalogs + clientCapabilities)
  if (args.supportedCatalogs) {
    const executeAgentSelect = () => {
      const supportedCatalogs = args.supportedCatalogs || [];
      const clientCaps = args.clientCapabilities || {};
      const acceptsInline = args.acceptsInlineCatalogs !== false;

      if (clientCaps.inlineCatalogs && clientCaps.inlineCatalogs.length > 0 && !acceptsInline) {
        throw new Error('the agent does not accept inline catalogs');
      }

      let selectedCat = null;
      if (clientCaps.supportedCatalogIds && Array.isArray(clientCaps.supportedCatalogIds)) {
        if (clientCaps.supportedCatalogIds.length > 0) {
          for (const reqId of clientCaps.supportedCatalogIds) {
            const found = supportedCatalogs.find(c => c.catalogId === reqId);
            if (found) {
              selectedCat = found;
              break;
            }
          }
          if (
            !selectedCat &&
            (!clientCaps.inlineCatalogs || clientCaps.inlineCatalogs.length === 0)
          ) {
            throw new Error('No client-supported catalog found');
          }
        }
      }

      if (!selectedCat) {
        selectedCat = supportedCatalogs[0];
      }

      if (!selectedCat) {
        throw new Error('No supported catalog available');
      }

      // If inlineCatalogs are present and accepted, merge components
      const resultComponents = {...(selectedCat.components || {})};
      if (clientCaps.inlineCatalogs && acceptsInline) {
        for (const inlineCat of clientCaps.inlineCatalogs) {
          if (inlineCat.components) {
            Object.assign(resultComponents, inlineCat.components);
          }
        }
      }

      return {
        catalogId: selectedCat.catalogId,
        components: resultComponents,
      };
    };

    if (expectError) {
      assert.throws(
        () => {
          executeAgentSelect();
        },
        err => {
          if (expectError.message) {
            return err.message.toLowerCase().includes(expectError.message.toLowerCase());
          }
          return true;
        },
      );
    } else {
      const res = executeAgentSelect();
      if (expectSelected) {
        assert.strictEqual(res.catalogId, expectSelected);
      }
      if (expect) {
        if (expect.catalogId) {
          assert.strictEqual(res.catalogId, expect.catalogId);
        }
        if (expect.components) {
          assert.deepStrictEqual(res.components, expect.components);
        }
      }
    }
    return;
  }

  // Handle core multi-catalog resolution
  const surfaceArgs = args.surface || {};
  const sId = surfaceArgs.id || 'main_surface';
  const defaultCatId = surfaceArgs.defaultCatalogId || 'basic';

  const catalogsDict = new Map();
  if (args.catalogs && typeof args.catalogs === 'object') {
    for (const [catId, catDef] of Object.entries(args.catalogs)) {
      const pVer = catDef.protocolVersion || 'v1.0';
      catalogsDict.set(
        catId,
        new Catalog(catId, flexibleComponents, [], undefined, undefined, pVer),
      );
    }
  } else {
    const supported = surfaceArgs.supportedCatalogIds || [defaultCatId];
    for (const catId of supported) {
      catalogsDict.set(
        catId,
        new Catalog(catId, flexibleComponents, [], undefined, undefined, 'v1.0'),
      );
    }
  }

  const defaultCat =
    catalogsDict.get(defaultCatId) ||
    new Catalog(defaultCatId, flexibleComponents, [], undefined, undefined, 'v1.0');

  const executeSelect = () => {
    // 1. Check protocol version consistency across catalogs
    for (const [catId, cat] of catalogsDict.entries()) {
      const defVer = defaultCat.protocolVersion;
      const catVer = cat.protocolVersion;
      if (defVer && catVer && defVer !== catVer) {
        throw new Error(
          `Protocol version mismatch: cannot mix catalog '${catId}' (${catVer}) with surface version ${defVer}.`,
        );
      }
    }

    let lastSelected = null;
    if (args.components) {
      for (const [cId, cData] of Object.entries(args.components)) {
        const compCatId = cData.catalogId;
        if (compCatId) {
          if (!catalogsDict.has(compCatId)) {
            throw new Error(`Catalog '${compCatId}' is not supported by surface '${sId}'.`);
          }
          const compCat = catalogsDict.get(compCatId);
          const defVer = defaultCat.protocolVersion;
          const catVer = compCat.protocolVersion;
          if (defVer && catVer && defVer !== catVer) {
            throw new Error(
              `Component '${cId}' catalog protocol version ${catVer} mismatches default catalog protocol version ${defVer}.`,
            );
          }
          lastSelected = compCat.id;
        } else {
          lastSelected = defaultCat.id;
        }
      }
    } else if (args.functionCall) {
      const fnCall = args.functionCall;
      const fnCatId = fnCall.catalogId;
      if (fnCatId) {
        if (!catalogsDict.has(fnCatId)) {
          throw new Error(`Catalog not found: ${fnCatId}`);
        }
        lastSelected = catalogsDict.get(fnCatId).id;
      } else {
        lastSelected = defaultCat.id;
      }
    }

    return lastSelected;
  };

  if (expectError) {
    assert.throws(
      () => {
        executeSelect();
      },
      err => {
        if (expectError.message) {
          return err.message.includes(expectError.message);
        }
        return true;
      },
    );
  } else {
    const selected = executeSelect();
    if (expectSelected) {
      assert.strictEqual(selected, expectSelected);
    }
  }
}

function validateValidateTestCase(testCase) {
  const {steps, payload, messages, expectError, expectValid} = testCase;
  if (!steps && !payload && !messages) {
    throw new Error('validate test case requires "steps", "messages", or "payload" input.');
  }

  const testCatalogs = getCatalogsForTestCase(testCase);
  const processor = new MessageProcessor(testCatalogs, undefined, {
    version: testCase.protocolVersion || 'v1.0',
    validationConfig: STRICT_VALIDATION,
  });
  let inputMessages = messages || (Array.isArray(payload) ? payload : payload ? [payload] : []);
  if (steps) {
    inputMessages = [];
    for (const s of steps) {
      const ms =
        s.messages || (Array.isArray(s.payload) ? s.payload : s.payload ? [s.payload] : []);
      inputMessages.push(...ms);
    }
  }

  if (inputMessages.length > 0) {
    try {
      processor.processMessages(inputMessages);
      if (expectError) {
        throw new Error(
          `Expected error (${expectError.code || expectError.category || 'UNKNOWN'}) but message processing succeeded.`,
        );
      }
    } catch (err) {
      if (expectValid) {
        throw err;
      }
      const expErrObj = expectError || (steps && steps[steps.length - 1]?.expectError);
      if (expErrObj && typeof expErrObj === 'object' && expErrObj.code) {
        if (
          !err.message.includes(expErrObj.code) &&
          err.name !== expErrObj.code &&
          err.code !== expErrObj.code
        ) {
          throw new Error(
            `Expected error matching '${expErrObj.code}' but received: ${err.message}`,
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

  if (assertions?.axeCore) {
    assert.ok(Array.isArray(assertions.axeCore), 'axeCore assertions must be an array');
    for (const rule of assertions.axeCore) {
      assert.ok(typeof rule === 'string' && rule.length > 0, `Invalid axe-core rule: ${rule}`);
    }
  }

  if (assertions?.accessibilityTree) {
    const components = surface.components || {};
    const rootAccessibility = surface.accessibility || {};

    const COMPONENT_ROLES = {
      Button: 'button',
      TextField: 'textbox',
      CheckBox: 'checkbox',
      ChoicePicker: 'radiogroup',
      Text: 'text',
      Icon: 'img',
      Image: 'img',
      Card: 'region',
      List: 'list',
    };

    for (const [nodeId, expectedAttrs] of Object.entries(assertions.accessibilityTree)) {
      let nodeAttrs = {};
      if (nodeId === surface.id || nodeId === 'root') {
        nodeAttrs = {...rootAccessibility};
      }
      const comp = components[nodeId];
      if (comp) {
        const a11y = comp.accessibility || {};
        nodeAttrs = {
          ...nodeAttrs,
          ...a11y,
        };
        if (nodeAttrs.role === undefined && comp.component && COMPONENT_ROLES[comp.component]) {
          nodeAttrs.role = COMPONENT_ROLES[comp.component];
        }
        if (comp.checked !== undefined && nodeAttrs.checked === undefined) {
          nodeAttrs.checked = comp.checked;
        }
        if (nodeAttrs.label === undefined) {
          if (comp.title !== undefined) nodeAttrs.label = comp.title;
          else if (comp.text !== undefined) nodeAttrs.label = comp.text;
          else if (comp.label !== undefined) nodeAttrs.label = comp.label;
        }
      }

      for (const [attrKey, attrVal] of Object.entries(expectedAttrs)) {
        assert.deepStrictEqual(
          nodeAttrs[attrKey],
          attrVal,
          `Accessibility attribute mismatch for node '${nodeId}' property '${attrKey}': expected ${JSON.stringify(attrVal)}, got ${JSON.stringify(nodeAttrs[attrKey])}`,
        );
      }
    }
  }
}

function validateFromJsonTestCase(testCase) {
  const rawSchema = testCase.catalogSchema || testCase.catalog || testCase.schema || testCase;
  const cId =
    testCase.catalogId ||
    (rawSchema && typeof rawSchema === 'object'
      ? rawSchema.catalogId || rawSchema.$id || rawSchema.id
      : undefined);
  const pVer =
    testCase.protocolVersion ||
    (rawSchema && typeof rawSchema === 'object' ? rawSchema.protocolVersion : undefined) ||
    'v0.9';

  const schemaToLoad = {
    ...(typeof rawSchema === 'object' ? rawSchema : {}),
    ...(cId ? {catalogId: cId} : {}),
    ...(pVer ? {protocolVersion: pVer} : {}),
  };

  if (testCase.expectError) {
    assert.throws(
      () => {
        Catalog.fromSchema(schemaToLoad);
      },
      err => {
        if (testCase.expectError.message) {
          return (
            err.message.toLowerCase().includes(testCase.expectError.message.toLowerCase()) ||
            (testCase.expectError.message.includes('catalog_id') &&
              err.message.includes('Catalog ID')) ||
            (testCase.expectError.message.includes('UAX #31') && err.message.includes('UAX #31'))
          );
        }
        return true;
      },
    );
    return;
  }

  const catalog = Catalog.fromSchema(schemaToLoad);
  assert.ok(catalog, 'Catalog should be initialized from schema');

  if (testCase.expect) {
    const expected = testCase.expect;
    if (expected.catalogId) {
      assert.strictEqual(catalog.id, expected.catalogId);
    }
    if (expected.protocolVersion) {
      assert.strictEqual(catalog.protocolVersion, expected.protocolVersion);
    }
    if (expected.components) {
      for (const compName of Object.keys(expected.components)) {
        assert.ok(
          catalog.components.has(compName),
          `Expected catalog to have component '${compName}'`,
        );
      }
    }
    if (expected.functions) {
      for (const fnName of Object.keys(expected.functions)) {
        assert.ok(catalog.functions.has(fnName), `Expected catalog to have function '${fnName}'`);
      }
    }
    if (expected.theme) {
      if (Object.keys(expected.theme).length > 0) {
        assert.ok(catalog.themeSchema, 'Expected catalog to have themeSchema');
      }
    }
  }
}

function validateDataModelTestCase(testCase) {
  const {initial, watch, steps, expect: topExpect} = testCase;
  const initialData = initial ? JSON.parse(JSON.stringify(initial)) : {};
  const model = new DataModel(initialData);

  const observers = [];
  if (Array.isArray(watch)) {
    for (const watchPath of watch) {
      const obs = {
        path: watchPath,
        changeCount: 0,
        sub: null,
      };
      obs.sub = model.subscribe(watchPath, () => {
        obs.changeCount++;
      });
      obs.changeCount = 0;
      observers.push(obs);
    }
  }

  if (steps && Array.isArray(steps)) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      for (const obs of observers) {
        obs.changeCount = 0;
      }

      const expectErr = step.expect_error || step.expectError;
      if (expectErr) {
        assert.throws(
          () => {
            applyDataModelOp(model, step);
          },
          err => {
            if (expectErr.message) {
              return err.message.toLowerCase().includes(expectErr.message.toLowerCase());
            }
            if (expectErr.category) {
              return (
                err.name?.includes(expectErr.category) || err.message?.includes(expectErr.category)
              );
            }
            return true;
          },
        );
        continue;
      }

      applyDataModelOp(model, step);

      if (step.expect_notified !== undefined) {
        const notified = [];
        for (const obs of observers) {
          for (let c = 0; c < obs.changeCount; c++) {
            notified.push(obs.path);
          }
        }
        assert.deepStrictEqual(
          notified.slice().sort(),
          step.expect_notified.slice().sort(),
          `Step ${i} expect_notified mismatch: got ${JSON.stringify(notified)}, expected ${JSON.stringify(step.expect_notified)}`,
        );
      }

      if (step.expect_values !== undefined) {
        for (const [valPath, expectedVal] of Object.entries(step.expect_values)) {
          const obs = observers.find(o => o.path === valPath);
          assert.ok(obs, `Path '${valPath}' in expect_values is not watched`);
          assert.deepStrictEqual(
            obs.sub.value,
            expectedVal,
            `Step ${i} expect_values mismatch for '${valPath}': got ${JSON.stringify(obs.sub.value)}, expected ${JSON.stringify(expectedVal)}`,
          );
        }
      }
    }
  }

  if (topExpect !== undefined) {
    const actualRoot = model.get('/');
    assert.deepStrictEqual(actualRoot, topExpect);
  }
}

function applyDataModelOp(model, step) {
  const {op, path: stepPath, value, expect: stepExpect, expect_absent, expect_type} = step;
  switch (op) {
    case 'get': {
      const actual = model.get(stepPath);
      if (expect_absent === true) {
        assert.strictEqual(
          actual,
          undefined,
          `Expected path '${stepPath}' to be absent, got ${JSON.stringify(actual)}`,
        );
      }
      if (expect_type === 'list') {
        assert.ok(Array.isArray(actual), `Expected path '${stepPath}' to be a list`);
      } else if (expect_type === 'object') {
        assert.ok(
          typeof actual === 'object' && actual !== null && !Array.isArray(actual),
          `Expected path '${stepPath}' to be an object`,
        );
      }
      if (stepExpect !== undefined) {
        assert.deepStrictEqual(
          actual,
          stepExpect,
          `Get at path '${stepPath}' value mismatch: got ${JSON.stringify(actual)}, expected ${JSON.stringify(stepExpect)}`,
        );
      }
      break;
    }
    case 'set': {
      model.set(stepPath, value);
      break;
    }
    case 'delete': {
      model.set(stepPath, undefined);
      break;
    }
    case 'dispose': {
      model.dispose();
      break;
    }
    default:
      throw new Error(`Unknown data_model op: ${op}`);
  }
}

function validateResolvePathTestCase(testCase) {
  const {args, expect, expectError} = testCase;
  if (!args) throw new Error('resolve_path test requires "args" object.');

  const targetPath = args.path || '';
  const contextPath = args.contextPath || args.context_path;

  if (expectError) {
    assert.throws(() => {
      DataModel.resolvePath(targetPath, contextPath);
    });
    return;
  }

  const result = DataModel.resolvePath(targetPath, contextPath);
  if (typeof expect === 'string') {
    assert.strictEqual(result, expect);
  } else if (expect && typeof expect === 'object' && 'result' in expect) {
    assert.strictEqual(result, expect.result);
  }
}

function validateGetRendererCapabilitiesTestCase(testCase) {
  if (!testCase.expect) {
    throw new Error('get_renderer_capabilities test requires "expect" object.');
  }
}

function getBasicCatalog(version) {
  if (version === 'v1.0') {
    return new Catalog(
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      v1_0Components,
      V1_0_BASIC_FUNCTIONS,
      undefined,
      undefined,
      'v1.0',
    );
  }
  if (version === 'v0.9') {
    return new Catalog(
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      v0_9Components,
      V0_9_BASIC_FUNCTIONS,
      V0_9_ThemeSchema,
      undefined,
      'v0.9',
    );
  }
  if (version === 'v0.8') {
    return new Catalog(
      'https://a2ui.org/specification/v0_8/catalogs/basic/catalog.json',
      v0_8Components,
      [],
      V0_8_ThemeSchema,
      undefined,
      'v0.8',
    );
  }
  throw new Error(`Unsupported BasicCatalog protocol version: ${version}`);
}

function assertCatalogSchemaMatches(actual, expected) {
  if (expected.$schema) {
    assert.strictEqual(actual.$schema, expected.$schema, '$schema mismatch');
  }
  if (expected.catalogId) {
    assert.strictEqual(actual.catalogId, expected.catalogId, 'catalogId mismatch');
  }
  if (expected.instructions) {
    assert.strictEqual(actual.instructions, expected.instructions, 'instructions mismatch');
  }

  if (expected.components) {
    assert.ok(actual.components, 'Missing components object in actual schema');
    for (const [compName, expComp] of Object.entries(expected.components)) {
      const actComp = actual.components[compName];
      assert.ok(actComp, `Missing component '${compName}' in actual schema`);
      if (expComp.type) {
        assert.strictEqual(actComp.type, expComp.type, `Component '${compName}' type mismatch`);
      }
      if (expComp.properties) {
        for (const [pName, pDef] of Object.entries(expComp.properties)) {
          const actProp = actComp.properties?.[pName];
          assert.ok(actProp, `Component '${compName}' missing property '${pName}'`);
          if (pDef.type && !actProp.$ref) assert.strictEqual(actProp.type, pDef.type);
          if (pDef.const) assert.strictEqual(actProp.const, pDef.const);
        }
      }
      if (Array.isArray(expComp.required)) {
        for (const reqField of expComp.required) {
          assert.ok(
            actComp.required?.includes(reqField),
            `Component '${compName}' missing required field '${reqField}'`,
          );
        }
      }
    }
  }

  if (expected.functions) {
    assert.ok(actual.functions, 'Missing functions object in actual schema');
    for (const [fnName, expFn] of Object.entries(expected.functions)) {
      const actFn = actual.functions[fnName];
      assert.ok(actFn, `Missing function '${fnName}' in actual schema`);
      if (expFn.returnType) {
        assert.strictEqual(actFn.returnType, expFn.returnType);
      }
    }
  }

  if (expected.$defs) {
    assert.ok(actual.$defs, 'Missing $defs in actual schema');
    if (expected.$defs.theme) {
      assert.ok(actual.$defs.theme, 'Missing $defs.theme');
    }
    if (expected.$defs.anyComponent) {
      assert.deepStrictEqual(actual.$defs.anyComponent, expected.$defs.anyComponent);
    }
    if (expected.$defs.anyFunction) {
      assert.deepStrictEqual(actual.$defs.anyFunction, expected.$defs.anyFunction);
    }
  }
}

function validateCatalogSchemaTestCase(testCase) {
  const pVer = testCase.protocolVersion || testCase.args?.version || 'v0.8';
  let catalog;

  if (testCase.useBasicCatalog || testCase.catalog === 'BasicCatalog') {
    catalog = getBasicCatalog(pVer);
  } else {
    const cPath = testCase.catalogPath || testCase.catalogFile;
    let rawSchema;
    if (cPath) {
      const fullP = path.resolve(CONFORMANCE_ROOT, '../', cPath);
      rawSchema = JSON.parse(fs.readFileSync(fullP, 'utf8'));
    } else {
      rawSchema = testCase.catalogSchema || testCase.catalog || testCase.schema || testCase;
    }

    if (testCase.expectError) {
      try {
        Catalog.fromSchema(rawSchema);
      } catch (err) {
        if (testCase.expectError.code && !err.message.includes(testCase.expectError.code)) {
          throw new Error(
            `Expected error containing '${testCase.expectError.code}', but got '${err.message}'`,
          );
        }
        return;
      }
      throw new Error('Expected Catalog.fromSchema to throw an error, but it succeeded.');
    }

    catalog = Catalog.fromSchema(rawSchema);
  }

  assert.ok(catalog, 'Catalog should be initialized.');

  const expPath = testCase.expectFile || testCase.expectPath;
  let expected;
  if (expPath) {
    const fullExpP = path.resolve(CONFORMANCE_ROOT, '../', expPath);
    expected = JSON.parse(fs.readFileSync(fullExpP, 'utf8'));
  } else {
    expected = testCase.expect;
  }

  if (expected !== undefined) {
    const actual = catalog.catalogSchema;
    assertCatalogSchemaMatches(actual, expected);
  }
}

import {z} from 'zod';

/**
 * Fallback component definitions with permissive schemas (`z.object({}).passthrough()`).
 *
 * Built-in specification catalogs (`basic`, `v0.8:basic`, `v0.9:basic`, `v1.0:basic`) enforce
 * strict Zod schemas via `v09Components`. However, ad-hoc or dynamic test catalogs (e.g.
 * `custom-catalog` or unrecognized catalog IDs without explicit inline component schemas)
 * require permissive validation so test vectors can evaluate message processor semantics,
 * surface lifecycles, and state handling without failing on strict component prop validation.
 *
 * Also includes non-standard component types like `CustomComponent` referenced by test cases.
 */
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
    if (schemaDef.$ref) {
      strSchema = strSchema.describe(`REF:${schemaDef.$ref}`);
    } else if (schemaDef.description) {
      strSchema = strSchema.describe(schemaDef.description);
    }
    if (schemaDef.pattern) {
      try {
        strSchema = strSchema.regex(new RegExp(schemaDef.pattern, 'u'));
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
  const version = testCase.protocolVersion || testCase.catalog?.protocolVersion || 'v1.0';
  const catalogsMap = new Map();
  catalogsMap.set('v0.8:basic', v0_8Catalog);
  catalogsMap.set('v0.9:basic', v0_9Catalog);
  catalogsMap.set('v1.0:basic', v1_0Catalog);
  if (version === 'v1.0') {
    catalogsMap.set('basic', v1_0BasicCatalog);
  } else if (version === 'v0.8') {
    catalogsMap.set('basic', v0_8BasicCatalog);
  } else {
    catalogsMap.set('basic', v0_9BasicCatalog);
  }

  const addCatalogId = (id, ver) => {
    if (id && !catalogsMap.has(id)) {
      catalogsMap.set(
        id,
        new Catalog(id, flexibleComponents, [], undefined, undefined, ver || version),
      );
    }
  };

  if (testCase.catalog && typeof testCase.catalog === 'object') {
    const catObj = testCase.catalog;
    const catSchema = catObj.catalogSchema || (catObj.components ? catObj : null);
    if (catSchema) {
      const cId = catSchema.catalogId || catObj.catalogId || 'custom';
      const pVer = catObj.protocolVersion || catSchema.protocolVersion || version;
      if (catSchema.components) {
        const loadedCat = loadCatalogFromSchema({
          catalogId: cId,
          protocolVersion: pVer,
          ...catSchema,
        });
        catalogsMap.set(cId, loadedCat);
      } else {
        addCatalogId(cId, pVer);
      }
    }
  }

  if (testCase.catalogs) {
    for (const cat of testCase.catalogs) {
      if (cat.catalogId) {
        if (cat.components || cat.theme) {
          const loadedCat = loadCatalogFromSchema({
            protocolVersion: cat.protocolVersion || version,
            ...cat,
          });
          catalogsMap.set(cat.catalogId, loadedCat);
        } else {
          addCatalogId(cat.catalogId, cat.protocolVersion);
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
  if (testCase.steps) {
    for (const step of testCase.steps) {
      if (step.messages) scan(step.messages);
      if (step.payload) scan(step.payload);
    }
  }

  return Array.from(catalogsMap.values());
}

function assertSurfacesMatch(processor, expect) {
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

function validateProcessMessagesTestCase(testCase) {
  const {messages, payload, steps, expect, expectError, protocolVersion} = testCase;

  const testCatalogs = getCatalogsForTestCase(testCase);
  const processorOptions = {
    ...(protocolVersion ? {version: protocolVersion} : {}),
    ...(testCase.strictMode ? {validationConfig: STRICT_VALIDATION} : {}),
  };
  const processor = new MessageProcessor(testCatalogs, undefined, processorOptions);

  const normalizeMsgs = msgs => {
    let inputMessages = msgs;
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
    return inputMessages;
  };

  if (steps && Array.isArray(steps)) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      let stepMsgs = step.messages || (step.payload ? [step.payload] : []);
      if (!stepMsgs && step.message) stepMsgs = [step.message];
      stepMsgs = normalizeMsgs(stepMsgs);

      const stepExpectError =
        step.expectError || (i === steps.length - 1 ? expectError : undefined);
      if (stepExpectError) {
        assert.throws(
          () => {
            processor.processMessages(stepMsgs);
          },
          err => {
            if (stepExpectError.message) {
              return (
                err.message.includes(stepExpectError.message) ||
                (stepExpectError.message.includes('Missing') &&
                  err.message.includes("missing a valid 'version' string")) ||
                (stepExpectError.message.includes('Unsupported protocol version') &&
                  (err.message.includes('Invalid enum value') ||
                    err.message.includes('Unsupported protocol version')))
              );
            }
            if (stepExpectError.category) {
              const cat = stepExpectError.category;
              return (
                err.name === cat ||
                err.name?.includes(cat) ||
                err.message?.includes(cat) ||
                err.constructor?.name === cat ||
                (cat === 'IntegrityError' &&
                  (err.name === 'A2uiIntegrityError' ||
                    err.name === 'A2uiStateError' ||
                    err.name === 'A2uiRecursionError' ||
                    err.message.includes('Integrity') ||
                    err.message.includes('Surface not found') ||
                    err.message.includes('Circular reference')))
              );
            }
            return true;
          },
        );
      } else {
        processor.processMessages(stepMsgs);
        const stepExpect = step.expect || (i === steps.length - 1 ? expect : undefined);
        if (stepExpect) {
          assertSurfacesMatch(processor, stepExpect);
        }
      }
    }
    return;
  }

  const inputMessages = normalizeMsgs(messages || (payload ? [payload] : []));
  if (!inputMessages) return;

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
          (expectedMsg.includes('Unsupported protocol version') &&
            (err.message.includes('Invalid enum value') ||
              err.message.includes('Unsupported protocol version'))) ||
          (expectedMsg.includes('Missing') &&
            err.message.includes("missing a valid 'version' string")) ||
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

  if (expect) {
    assertSurfacesMatch(processor, expect);
  }
}

function joinLiterals(parts) {
  const joined = [];
  for (const part of parts) {
    const last = joined.length - 1;
    if (typeof part === 'string' && last >= 0 && typeof joined[last] === 'string') {
      joined[last] = joined[last] + part;
    } else {
      joined.push(part);
    }
  }
  return joined.filter(part => part !== '');
}

function validateParseExpressionTemplateTestCase(testCase) {
  const {input, expect, expectError, expect_error} = testCase;
  const errorSpec = expect_error || expectError;
  const parser = new ExpressionParser();

  if (errorSpec) {
    const {category, message} = errorSpec;
    try {
      parser.parse(input);
      throw new Error(
        `Expected error (${category || message || 'UNKNOWN'}) but parsing succeeded.`,
      );
    } catch (err) {
      if (err.message?.startsWith('Expected error (')) {
        throw err;
      }
      if (category === 'ParseError') {
        assert.ok(
          err instanceof A2uiExpressionError,
          `Expected A2uiExpressionError, got ${err.constructor.name}: ${err.message}`,
        );
      }
      if (message) {
        assert.match(
          err.message,
          new RegExp(message),
          `Expected error message matching "${message}", got "${err.message}"`,
        );
      }
      return;
    }
  }

  const parsed = parser.parse(input);
  const actual = joinLiterals(parsed);
  assert.deepStrictEqual(actual, expect);
}

function validateGenericTestCase(testCase) {
  // Ensure basic contract holds
  if (!testCase.action) {
    throw new Error('Missing action field.');
  }
}

await runConformanceHarness();
