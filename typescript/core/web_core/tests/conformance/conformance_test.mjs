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

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import yaml from 'js-yaml';
import {z} from 'zod';

import {Catalog, createFunctionImplementation} from '../../dist/src/catalog/types.js';
import {basicCatalog as V1_0_SDK_BASIC_CATALOG} from '../../dist/src/catalogs/basic/v1/catalog.js';
import {
  BASIC_COMPONENTS as V1_0_BASIC_COMPONENTS,
  BASIC_FUNCTIONS as V1_0_BASIC_FUNCTIONS,
} from '../../dist/src/catalogs/basic/v1/index.js';
import {toCanonicalVersion} from '../../dist/src/common/semver.js';
import {
  A2uiCatalogError,
  A2uiDataError,
  A2uiError,
  A2uiExpressionError,
  A2uiIntegrityError,
  A2uiRecursionError,
  A2uiStateError,
  A2uiValidationError,
} from '../../dist/src/errors.js';
import {ExpressionParser} from '../../dist/src/expressions/expression_parser.js';
import {SUPPORTED_PROTOCOL_VERSIONS} from '../../dist/src/processing/adapters/base.js';
import {MessageProcessor, STRICT_VALIDATION} from '../../dist/src/processing/message-processor.js';
import {
  effect,
  getValue,
  isSignal,
  peekValue,
  setValue,
  signal,
} from '../../dist/src/reactivity/signals.js';
import {DataContext} from '../../dist/src/resolution/data-context.js';
import {NodeResolver} from '../../dist/src/resolution/node-resolver.js';
import {ResolvedBinding} from '../../dist/src/resolution/resolved-binding.js';
import {DataModel} from '../../dist/src/state/data-model.js';
import {SurfaceModel} from '../../dist/src/state/surface-model.js';
import {basicCatalog as V0_8_SDK_BASIC_CATALOG} from '../../dist/src/v0_8/basic_catalog/catalog.js';
import {
  BASIC_COMPONENTS as V0_8_BASIC_COMPONENTS,
  ThemeSchema as V0_8_ThemeSchema,
} from '../../dist/src/v0_8/basic_catalog/index.js';
import {basicCatalog as V0_9_SDK_BASIC_CATALOG} from '../../dist/src/v0_9/basic_catalog/catalog.js';
import {
  BASIC_COMPONENTS as V0_9_BASIC_COMPONENTS,
  BASIC_FUNCTIONS as V0_9_BASIC_FUNCTIONS,
  ThemeSchema as V0_9_ThemeSchema,
} from '../../dist/src/v0_9/basic_catalog/index.js';
import {PayloadValidator} from '../../dist/src/validation/index.js';
import {runNodeResolutionCase} from '../../dist/tests/conformance/node-resolution.js';

// Dedicated basic catalog component definitions per specification version
const v0_8Components = V0_8_BASIC_COMPONENTS;
const v0_9Components = V0_9_BASIC_COMPONENTS;
const v1_0Components = V1_0_BASIC_COMPONENTS;

const v0_8Catalog = new Catalog(
  'v0.8:basic',
  'v0.8',
  v0_8Components,
  [],
  V0_8_ThemeSchema,
  undefined,
);
const v0_9Catalog = new Catalog(
  'v0.9:basic',
  'v0.9',
  v0_9Components,
  V0_9_BASIC_FUNCTIONS,
  V0_9_ThemeSchema,
  undefined,
);
const v1_0Catalog = new Catalog(
  'v1.0:basic',
  '1.0',
  v1_0Components,
  V1_0_BASIC_FUNCTIONS,
  undefined,
  undefined,
);
const v0_8BasicCatalog = new Catalog(
  'basic',
  'v0.8',
  v0_8Components,
  [],
  V0_8_ThemeSchema,
  undefined,
);
const v0_9BasicCatalog = new Catalog(
  'basic',
  'v0.9',
  v0_9Components,
  V0_9_BASIC_FUNCTIONS,
  V0_9_ThemeSchema,
  undefined,
);
const v1_0BasicCatalog = new Catalog(
  'basic',
  '1.0',
  v1_0Components,
  V1_0_BASIC_FUNCTIONS,
  undefined,
  undefined,
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root conformance folder: <repo_root>/conformance
const CONFORMANCE_ROOT =
  process.env.CONFORMANCE_ROOT || path.resolve(__dirname, '../../../../../conformance');
const CORE_DIR = path.join(CONFORMANCE_ROOT, 'core');
const AGENT_DIR = path.join(CONFORMANCE_ROOT, 'agent');

/**
 * Transition skip list containing specific test case names to skip.
 */
const SKIP_TEST_NAMES = new Set();

/**
 * Cases that web_core's behaviour does not satisfy, keyed by suite path and
 * then case name, with the behaviour that differs. They are reported as
 * skipped with that reason. An entry that matches no case fails the run.
 */
const KNOWN_DIVERGENCES = new Map();

/**
 * The `expect` keys a `from_json` case may use (`FromJsonExpect` in
 * conformance_schema.json). An unknown key fails the case rather than being
 * silently ignored.
 */
const FROM_JSON_EXPECT_KEYS = new Set([
  'catalogId',
  'componentMetadata',
  'components',
  'functions',
  'invalidComponents',
  'matchesBuiltinCatalog',
  'protocolVersion',
  'selfContained',
  'theme',
  'validComponents',
]);

/**
 * Catalogs web_core implements itself, keyed by catalog ID, for
 * `matchesBuiltinCatalog` cases.
 */
const SDK_CATALOGS = new Map(
  [V1_0_SDK_BASIC_CATALOG, V0_9_SDK_BASIC_CATALOG, V0_8_SDK_BASIC_CATALOG].map(catalog => [
    catalog.id,
    catalog,
  ]),
);

/**
 * web_core's own basic catalog for a protocol version, for a `to_json` case
 * that names `builtinCatalog: basic`.
 */
function sdkBasicCatalog(protocolVersion) {
  const version = toCanonicalVersion(protocolVersion);
  if (version === '0.8') return V0_8_SDK_BASIC_CATALOG;
  if (version === '0.9' || version === '0.9.1') return V0_9_SDK_BASIC_CATALOG;
  if (version === '1.0') return V1_0_SDK_BASIC_CATALOG;
  throw new Error(`web_core has no basic catalog for protocol version '${protocolVersion}'.`);
}

/**
 * Thrown by a case handler when the case does not apply to web_core, for
 * example a `matchesBuiltinCatalog` case for a catalog web_core does not
 * implement itself. The case is reported as skipped with the given reason.
 */
class CaseSkipped extends Error {}

/** Suites that must be discovered and contain at least one case. */
const REQUIRED_SUITES = new Set(['core/node_resolution.yaml']);

/**
 * Test suite files to skip during headless web_core conformance runs, mapped to
 * the reason every case in that suite is recorded as skipped.
 */
const SKIP_TEST_SUITES = new Map([
  [
    'accessibility.yaml',
    'accessibility tree rendering is handled by UI framework renderers rather than headless web_core',
  ],
  [
    'adapter_conformance.yaml',
    'UI framework renderer adapter conformance is tested in the renderer packages rather than headless web_core',
  ],
  ['builder.yaml', 'typesafe builder API is agent-side only'],
  ['macros.yaml', 'composite macros are agent-side only'],
]);

/**
 * Action types or `<action>.<key path>` entries the web_core runner
 * deliberately does not implement, and why.
 *
 * `web_core` is the renderer-side library. It has no inference-format parser,
 * payload fixer or prompt generator, so the agent-side suites cannot be
 * executed here. Naming them keeps the gap countable and keeps the default
 * `throw` for genuinely unrecognised actions intact. Every entry must match at
 * least one case during a run.
 */
const UNIMPLEMENTED_ACTIONS = new Map([
  ['from_format', 'the Express inference format is implemented in the agent SDK'],
  ['core_syntax', 'the Express inference format is implemented in the agent SDK'],
  ['from_catalog', 'the Express inference format is implemented in the agent SDK'],
  ['skill_set', 'skill generation is implemented in the agent SDK'],
  ['export_to_directory', 'skill generation is implemented in the agent SDK'],
  ['process_chunk', 'web_core has no streaming inference parser'],
  ['parse_full', 'web_core has no inference-format parser'],
  ['fix_payload', 'web_core has no payload fixer'],
  ['has_parts', 'web_core has no inference-format parser'],
  ['has_format_content', 'web_core has no inference-format parser'],
  ['generate_prompt', 'web_core has no prompt generator'],
  ['load_catalog', 'these cases exercise A2uiSchemaManager, which is agent-side only'],
  ['compile', 'web_core has no inference-format compiler'],
  ['decompile', 'web_core has no inference-format decompiler'],
  ['generate_prompt_snippet', 'web_core has no prompt generator'],
  ['unwrap', 'web_core has no inference-format parser'],
  ['wrap', 'web_core has no inference-format wrapper'],
  ['parse_response', 'web_core has no inference-format parser'],
  ['parse_chunk', 'web_core has no streaming inference parser'],
  ['stream_answer', 'streamed answers are agent-side only'],
  ['create_format', 'inference format factories are agent-side only'],
  ['create_processor', 'request processors are agent-side only'],
  ['transform_catalog', 'catalog transformers are agent-side only'],
  ['provide_catalog', 'catalog providers are agent-side only'],
  ['resolve_catalogs', 'catalog resolution is agent-side only'],
  ['common_types_schema', 'web_core does not generate the common types schema from its own models'],
  [
    'agent_to_renderer_schema',
    'web_core does not generate the agent_to_renderer schema from its own models',
  ],
  ['validate_common_type', 'web_core has no per-definition validators for the common types'],
  [
    'measure_growth',
    'the timing cases depend on the machine, so `yarn test:timing` runs them apart from the other tests (tests/timing/)',
  ],
  ['measure_overhead', 'web_core has no streaming inference parser'],
]);

const UNSUPPORTED = UNIMPLEMENTED_ACTIONS;

const MANIFEST_DIR = process.env.A2UI_CONFORMANCE_MANIFEST_DIR;
const MANIFEST_FILE = MANIFEST_DIR
  ? path.join(MANIFEST_DIR, `web_core-${process.pid}.jsonl`)
  : null;
if (MANIFEST_DIR) {
  fs.mkdirSync(MANIFEST_DIR, {recursive: true});
}

function recordCase(suite, name, status, reason) {
  if (!MANIFEST_FILE) return;
  const entry = {
    harness: 'web_core',
    suite: suite.replaceAll('\\', '/'),
    case: name,
    status,
    ...(reason ? {reason} : {}),
  };
  fs.appendFileSync(MANIFEST_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

function assertKnownKeys(obj, allowed, where) {
  if (obj === undefined || obj === null) return;
  assert.ok(typeof obj === 'object' && !Array.isArray(obj), `${where}: expected object`);
  const unknown = Object.keys(obj).filter(key => !allowed.has(key));
  assert.deepStrictEqual(
    unknown,
    [],
    `${where}: unknown keys: ${unknown.map(k => `${where}.${k}`).join(', ')}`,
  );
}

function assertKnownKeysList(items, allowed, where) {
  if (!Array.isArray(items)) return;
  for (let i = 0; i < items.length; i++) {
    assertKnownKeys(items[i], allowed, `${where}[${i}]`);
  }
}

function assertKnownKeysRecord(record, allowed, where) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  for (const [key, value] of Object.entries(record)) {
    assertKnownKeys(value, allowed, `${where}.${key}`);
  }
}

function hasNestedKeyPath(obj, dottedPath) {
  let cur = obj;
  for (const segment of dottedPath.split('.')) {
    if (!cur || typeof cur !== 'object' || !(segment in cur)) return false;
    cur = cur[segment];
  }
  return cur !== undefined;
}

function findUnsupportedEntry(testCase, matchedUnsupported) {
  const {action} = testCase;
  if (UNSUPPORTED.has(action)) {
    matchedUnsupported.add(action);
    return {key: action, reason: UNSUPPORTED.get(action)};
  }
  const prefix = `${action}.`;
  for (const [key, reason] of UNSUPPORTED) {
    if (key.startsWith(prefix) && hasNestedKeyPath(testCase, key.slice(prefix.length))) {
      matchedUnsupported.add(key);
      return {key, reason};
    }
  }
  return null;
}

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
  return yaml.load(content, {maxDepth: 1000});
}

function recordSkippedSuite(filePath, relativePath, suiteSkipReason) {
  const loaded = loadYamlFile(filePath);
  const cases = Array.isArray(loaded) ? loaded : (loaded?.tests ?? []);
  let count = 0;
  for (const tc of cases) {
    const caseName = tc?.name || tc?.id;
    if (caseName) {
      count++;
      recordCase(relativePath, caseName, 'skipped', suiteSkipReason);
    }
  }
  return count;
}

function checkCaseSkip(relativePath, testCase, state) {
  const {name, catalog, args} = testCase;
  // The top-level `protocolVersion` is the case's own declaration and wins
  // over anything inferred from the catalog or the first message.
  const rawVersion = testCase.protocolVersion || catalog?.protocolVersion || args?.version || '0.8';
  const version = toCanonicalVersion(rawVersion) || rawVersion;

  if (!SUPPORTED_PROTOCOL_VERSIONS.has(version)) {
    const reason = `version ${rawVersion} not in SUPPORTED_PROTOCOL_VERSIONS`;
    console.log(`  ⁃ [SKIPPED] ${name} (${reason})`);
    return reason;
  }

  if (SKIP_TEST_NAMES.has(name)) {
    state.matchedSkippedNames.add(name);
    const reason =
      SKIP_TEST_NAMES instanceof Map ? SKIP_TEST_NAMES.get(name) : 'skipped via SKIP_TEST_NAMES';
    console.log(`  ⁃ [SKIPPED] ${name}`);
    return reason;
  }

  const divergence = KNOWN_DIVERGENCES.get(relativePath)?.get(name);
  if (divergence !== undefined) {
    state.matchedDivergences.add(`${relativePath}#${name}`);
    const reason = `known divergence: ${divergence}`;
    console.log(`  ⁃ [SKIPPED] ${name} (${reason})`);
    return reason;
  }

  const unsupported = findUnsupportedEntry(testCase, state.matchedUnsupported);
  if (unsupported !== null) {
    state.unrunByAction.set(unsupported.key, (state.unrunByAction.get(unsupported.key) ?? 0) + 1);
    const reason = `action '${unsupported.key}': ${unsupported.reason}`;
    console.log(`  ⁃ [SKIPPED] ${name} (${reason})`);
    return reason;
  }

  return null;
}

async function dispatchTestCase(testCase) {
  const {name, action} = testCase;
  if (!name || !action) {
    throw new Error('Test case missing required "name" or "action" property.');
  }
  switch (action) {
    case 'handle_rpc':
      await validateRpcTestCase(testCase);
      break;
    case 'validate':
      validateValidateTestCase(testCase);
      break;
    case 'process_messages':
      validateProcessMessagesTestCase(testCase);
      break;
    case 'get_renderer_capabilities':
      validateGetRendererCapabilitiesTestCase(testCase);
      break;
    case 'validation_schema':
      validateValidationSchemaTestCase(testCase);
      break;
    case 'round_trip':
      validateRoundTripTestCase(testCase);
      break;
    case 'to_json':
      validateToJsonTestCase(testCase);
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
    case 'derive':
      validateDeriveTestCase(testCase);
      break;
    case 'select_catalog':
      validateSelectCatalogTestCase(testCase);
      break;
    case 'parse_expression_template':
      validateParseExpressionTemplateTestCase(testCase);
      break;
    case 'get_renderer_data_model':
      validateGetRendererDataModelTestCase(testCase);
      break;
    case 'resolve_nodes':
      await runNodeResolutionCase(testCase, CONFORMANCE_ROOT);
      break;
    case 'evaluate_function':
      validateEvaluateFunctionTestCase(testCase);
      break;
    case 'dispatch_action':
      await validateDispatchActionTestCase(testCase);
      break;
    default:
      throw new Error(`Unhandled action type in conformance harness: '${action}'`);
  }
}

async function runSuiteCases(relativePath, testCases, state) {
  console.log(`\n📄 Suite: ${relativePath} (${testCases.length} test cases)`);

  for (const testCase of testCases) {
    const {name} = testCase;
    const skipReason = checkCaseSkip(relativePath, testCase, state);
    if (skipReason !== null) {
      state.totalSkipped++;
      recordCase(relativePath, name, 'skipped', skipReason);
      continue;
    }

    state.totalTests++;

    try {
      await dispatchTestCase(testCase);
      state.totalPassed++;
      recordCase(relativePath, name, 'passed');
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      if (err instanceof CaseSkipped) {
        state.totalTests--;
        state.totalSkipped++;
        recordCase(relativePath, name, 'skipped', err.message);
        console.log(`  ⁃ [SKIPPED] ${name} (${err.message})`);
        continue;
      }
      state.totalFailed++;
      recordCase(relativePath, name, 'failed', err.message);
      const failMessage = `  ✗ FAILED: ${name} - ${err.message}`;
      console.error(failMessage);
      state.failures.push({file: relativePath, name, error: err.message});
    }
  }
}

function recordInvariantFailure(state, file, name, error) {
  state.totalTests++;
  state.totalFailed++;
  console.error(`  ✗ FAILED: ${name}: ${error}`);
  state.failures.push({file, name, error});
}

function verifyHarnessInvariants(discoveredSuites, state) {
  for (const suite of REQUIRED_SUITES) {
    if (!discoveredSuites.has(suite)) {
      recordInvariantFailure(state, suite, 'Required Suite', 'Required suite was not discovered.');
    }
  }
  for (const [suite, cases] of KNOWN_DIVERGENCES) {
    for (const name of cases.keys()) {
      if (!state.matchedDivergences.has(`${suite}#${name}`)) {
        recordInvariantFailure(state, suite, name, 'Known divergence matches no test case.');
      }
    }
  }
  for (const key of UNSUPPORTED.keys()) {
    if (!state.matchedUnsupported.has(key)) {
      recordInvariantFailure(state, 'UNSUPPORTED', key, 'Unsupported entry matches no test case.');
    }
  }
  for (const suite of SKIP_TEST_SUITES.keys()) {
    if (!state.matchedSkippedSuites.has(suite)) {
      recordInvariantFailure(
        state,
        suite,
        'SKIP_TEST_SUITES',
        'Skipped suite entry matches no suite file.',
      );
    }
  }
}

function loadSuiteTestCases(filePath, relativePath, state) {
  const baseName = path.basename(filePath);
  const suiteSkipReason = SKIP_TEST_SUITES.get(relativePath) ?? SKIP_TEST_SUITES.get(baseName);
  if (suiteSkipReason !== undefined) {
    state.matchedSkippedSuites.add(SKIP_TEST_SUITES.has(relativePath) ? relativePath : baseName);
    state.totalSkipped += recordSkippedSuite(filePath, relativePath, suiteSkipReason);
    return null;
  }
  let testCases;
  try {
    testCases = loadYamlFile(filePath);
  } catch (err) {
    recordInvariantFailure(state, relativePath, 'YAML Parsing', err.message);
    return null;
  }
  if (!Array.isArray(testCases)) {
    recordInvariantFailure(
      state,
      relativePath,
      'Suite Structure',
      `Content is not an array of test cases (got ${typeof testCases}).`,
    );
    return null;
  }
  if (REQUIRED_SUITES.has(relativePath) && testCases.length === 0) {
    recordInvariantFailure(
      state,
      relativePath,
      'Required Suite',
      'Required suite has no test cases.',
    );
    return null;
  }
  return testCases;
}

function finishHarnessRun(state) {
  console.log('\n=====================================================');
  console.log(
    `Conformance Summary: ${state.totalPassed}/${state.totalTests} Passed (${state.totalFailed} Failed, ${state.totalSkipped} Skipped)`,
  );
  if (state.unrunByAction.size > 0) {
    const unrunTotal = [...state.unrunByAction.values()].reduce((a, b) => a + b, 0);
    console.log(`Not run by design: ${unrunTotal} cases`);
    for (const [action, count] of [...state.unrunByAction].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${action}: ${count} (${UNSUPPORTED.get(action)})`);
    }
  }
  console.log('=====================================================');

  if (state.totalFailed > 0) {
    console.error('\nFailures Summary:');
    for (const failure of state.failures) {
      console.error(`- [${failure.file}] ${failure.name}: ${failure.error}`);
    }
    process.exit(1);
  }
  console.log('🎉 All Web Core conformance test vectors validated successfully!');
  process.exit(0);
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

  const state = {
    totalTests: 0,
    totalPassed: 0,
    totalFailed: 0,
    totalSkipped: 0,
    failures: [],
    unrunByAction: new Map(),
    matchedDivergences: new Set(),
    matchedUnsupported: new Set(),
    matchedSkippedSuites: new Set(),
    matchedSkippedNames: new Set(),
  };
  const discoveredSuites = new Set(files.map(file => path.relative(CONFORMANCE_ROOT, file)));

  for (const filePath of files) {
    const relativePath = path.relative(CONFORMANCE_ROOT, filePath);
    const testCases = loadSuiteTestCases(filePath, relativePath, state);
    if (testCases !== null) {
      await runSuiteCases(relativePath, testCases, state);
    }
  }

  verifyHarnessInvariants(discoveredSuites, state);
  finishHarnessRun(state);
}

const EXPECT_ERROR_KNOWN_KEYS = {
  error: new Set([
    'category',
    'code',
    'details',
    'functionCallId',
    'message',
    'path',
    'rendererError',
    'surfaceId',
  ]),
  detail: new Set(['code', 'message', 'path', 'surfaceId']),
  rendererError: new Set(['error', 'version']),
  rendererErrorPayload: new Set(['code', 'functionCallId', 'message', 'path', 'surfaceId']),
};

const RPC_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'description',
    'expect',
    'expectError',
    'features',
    'name',
    'protocolVersion',
  ]),
  args: new Set([
    'catalogId',
    'catalogVersion',
    'dataModel',
    'functionMetadata',
    'inboundResponse',
    'message',
    'outboundCall',
    'secondOutboundCall',
    'surfaceId',
    'uiActionFallbackScenario',
    'uiBindingScenario',
    'userActivationPresent',
  ]),
  uiBindingScenario: new Set(['catalogId', 'component', 'inboundResponseValue', 'surfaceId']),
  uiActionFallbackScenario: new Set([
    'actionPayload',
    'catalogId',
    'inboundResponseValue',
    'surfaceId',
  ]),
  expect: new Set([
    'correlatedCallId',
    'error',
    'initialValue',
    'outboundCall',
    'resolvedValue',
    'response',
    'result',
  ]),
};

async function validateRpcTestCase(testCase) {
  assertKnownKeys(testCase, RPC_KNOWN_KEYS.case, 'handle_rpc');
  const {args, expect, expectError} = testCase;
  if (!args) throw new Error('handle_rpc test requires "args" object.');
  if (!expect && !expectError)
    throw new Error('handle_rpc test requires "expect" or "expectError" object.');
  assertKnownKeys(args, RPC_KNOWN_KEYS.args, 'handle_rpc.args');
  assertKnownKeys(
    args.uiBindingScenario,
    RPC_KNOWN_KEYS.uiBindingScenario,
    'handle_rpc.args.uiBindingScenario',
  );
  assertKnownKeys(
    args.uiActionFallbackScenario,
    RPC_KNOWN_KEYS.uiActionFallbackScenario,
    'handle_rpc.args.uiActionFallbackScenario',
  );
  assertKnownKeys(expect, RPC_KNOWN_KEYS.expect, 'handle_rpc.expect');
  assertKnownKeys(expect?.error, EXPECT_ERROR_KNOWN_KEYS.error, 'handle_rpc.expect.error');
  assertKnownKeys(expectError, EXPECT_ERROR_KNOWN_KEYS.error, 'handle_rpc.expectError');

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
      } else if (fnName === 'echoArgs') {
        return Object.fromEntries(
          Object.entries(fnArgs ?? {}).map(([k, v]) => [k, v === undefined ? null : v]),
        );
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
    args.catalogVersion || testCase.catalog?.protocolVersion || testCase.protocolVersion || '1.0';

  const cat = new Catalog(catId, catVersion, [], funcs, undefined, undefined);
  let sentOutboundMsg;
  let lastErrorMsg;
  const rpcCatalogs = cat.id === 'basic' ? [cat] : [cat, v1_0BasicCatalog];
  const processor = new MessageProcessor(rpcCatalogs, undefined, {
    version: '1.0',
    outboundListener: msg => {
      sentOutboundMsg = msg;
    },
    errorHandler: msg => {
      lastErrorMsg = msg;
    },
  });

  if (args.surfaceId) {
    const avail = new Map([[cat.id, cat]]);
    if (cat.id !== 'basic') {
      avail.set('basic', v1_0BasicCatalog);
    }
    const surface = new SurfaceModel(
      args.surfaceId,
      cat,
      avail,
      undefined,
      false,
      new DataModel(args.dataModel || {}),
      catVersion,
    );
    processor.model.addSurface(surface);
  }

  if (args.uiBindingScenario) {
    const scenario = args.uiBindingScenario;
    const callName =
      scenario.component?.text?.['@call'] ||
      scenario.component?.text?.call ||
      'fetchRemoteGreeting';
    const procRef = {current: null};
    const agentBindingFn = createFunctionImplementation(
      {
        name: callName,
        returnType: 'string',
        schema: z.record(z.string(), z.any()).optional().default({}),
      },
      fnArgs => {
        const sig = signal(null);
        void procRef.current
          .callAgentFunction(scenario.surfaceId, {
            '@call': callName,
            catalogId: scenario.catalogId,
            args: fnArgs,
          })
          .then(val => setValue(sig, val));
        return sig;
      },
    );
    const storeCat = new Catalog(
      scenario.catalogId,
      '1.0',
      v1_0Components,
      [agentBindingFn],
      undefined,
      undefined,
    );
    procRef.current = new MessageProcessor([storeCat, v1_0BasicCatalog], undefined, {
      version: '1.0',
      outboundListener: msg => {
        sentOutboundMsg = msg;
      },
    });
    procRef.current.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: scenario.surfaceId,
          catalogId: scenario.catalogId,
          components: [scenario.component],
        },
      },
    ]);
    const surface = procRef.current.getSurface(scenario.surfaceId);
    const resolved = collectResolvedNodes(surface);
    try {
      const rootNode = resolved.nodes.get(scenario.component.id);
      const initialText = normalizeComponentRefs(peekValue(rootNode.props).text);
      assert.strictEqual(initialText ?? null, expect.initialValue);
      assert.ok(sentOutboundMsg?.callAgentFunction, 'Expected outbound callAgentFunction');
      assert.strictEqual(sentOutboundMsg.version, expect.outboundCall.version);
      assert.strictEqual(
        sentOutboundMsg.callAgentFunction.surfaceId,
        expect.outboundCall.callAgentFunction.surfaceId,
      );
      procRef.current.processMessages({
        version: '1.0',
        agentFunctionResponse: {
          functionCallId: sentOutboundMsg.callAgentFunction.functionCallId,
          value: scenario.inboundResponseValue,
        },
      });
      await new Promise(resolve => setTimeout(resolve, 0));
      const updatedText = normalizeComponentRefs(peekValue(rootNode.props).text);
      assert.strictEqual(updatedText, expect.resolvedValue);
    } finally {
      resolved.dispose();
    }
    return;
  }

  if (args.uiActionFallbackScenario) {
    const scenario = args.uiActionFallbackScenario;
    const fc = scenario.actionPayload.functionCall;
    const callName = fc['@call'] || fc.call;
    const procRef = {current: null};
    const agentActionFn = createFunctionImplementation(
      {
        name: callName,
        returnType: 'any',
        schema: z.record(z.string(), z.any()).optional().default({}),
      },
      fnArgs =>
        procRef.current.callAgentFunction(scenario.surfaceId, {
          '@call': callName,
          catalogId: scenario.catalogId,
          args: fnArgs,
        }),
    );
    const storeCat = new Catalog(
      scenario.catalogId,
      '1.0',
      v1_0Components,
      [agentActionFn],
      undefined,
      undefined,
    );
    procRef.current = new MessageProcessor([storeCat], undefined, {
      version: '1.0',
      outboundListener: msg => {
        sentOutboundMsg = msg;
      },
    });
    procRef.current.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: scenario.surfaceId,
          catalogId: scenario.catalogId,
        },
      },
    ]);
    const surface = procRef.current.getSurface(scenario.surfaceId);
    const ctx = new DataContext(surface, '/');
    const actionPromise = ctx.resolveAction(scenario.actionPayload);
    assert.ok(sentOutboundMsg?.callAgentFunction, 'Expected outbound callAgentFunction');
    assert.strictEqual(sentOutboundMsg.version, expect.outboundCall.version);
    assert.strictEqual(
      sentOutboundMsg.callAgentFunction.surfaceId,
      expect.outboundCall.callAgentFunction.surfaceId,
    );
    procRef.current.processMessages({
      version: '1.0',
      agentFunctionResponse: {
        functionCallId: sentOutboundMsg.callAgentFunction.functionCallId,
        value: scenario.inboundResponseValue,
      },
    });
    const result = await actionPromise;
    assert.deepStrictEqual(result, expect.result);
    return;
  }

  if (message) {
    if (expect?.error || expectError) {
      let thrown;
      try {
        processor.processMessages(message);
      } catch (err) {
        thrown = err;
      }
      assert.ok(thrown, 'Expected processMessages to throw on invalid RPC message');
      if (expect?.error?.message) {
        assert.ok(thrown.message.includes(expect.error.message));
      }
      if (expectError) {
        assertExpectedConformanceError(thrown, lastErrorMsg, expectError);
      }
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

    const callName = outboundCall.callFunction['@call'] ?? outboundCall.callFunction.call;
    const outboundPromise = processor.callAgentFunction(
      outboundCall.surfaceId,
      {
        call: callName,
        catalogId: outboundCall.callFunction.catalogId,
        args: outboundCall.callFunction.args,
      },
      {
        functionCallId: outboundCall.functionCallId,
      },
    );

    assert.ok(sentOutboundMsg, 'Expected outbound message to be dispatched to outbound listener');
    assert.strictEqual(sentOutboundMsg.callAgentFunction.functionCallId, correlatedId);
    const sentCallName =
      sentOutboundMsg.callAgentFunction.callFunction['@call'] ??
      sentOutboundMsg.callAgentFunction.callFunction.call;
    assert.strictEqual(sentCallName, callName);

    processor.processMessages(inboundResponse);
    const result = await outboundPromise;
    assert.deepStrictEqual(result, expect.result);
  } else if (outboundCall && (expect?.error || expectError)) {
    const expectedErr = expect?.error || expectError;
    const callName = outboundCall.callFunction['@call'] ?? outboundCall.callFunction.call;
    if (args.secondOutboundCall) {
      processor.callAgentFunction(
        outboundCall.surfaceId,
        {
          call: callName,
          catalogId: outboundCall.callFunction.catalogId,
          args: outboundCall.callFunction.args,
        },
        {
          functionCallId: outboundCall.functionCallId,
        },
      );
      await assert.rejects(
        async () => {
          const secondCallName =
            args.secondOutboundCall.callFunction['@call'] ??
            args.secondOutboundCall.callFunction.call;
          await processor.callAgentFunction(
            args.secondOutboundCall.surfaceId,
            {
              call: secondCallName,
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
              call: callName,
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

const SELECT_CATALOG_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'description',
    'expect',
    'expectError',
    'expectSelected',
    'features',
    'name',
    'protocolVersion',
  ]),
  args: new Set([
    'acceptsInlineCatalogs',
    'catalogs',
    'clientCapabilities',
    'components',
    'functionCall',
    'supportedCatalogs',
    'surface',
  ]),
  surface: new Set(['defaultCatalogId', 'id', 'supportedCatalogIds']),
  expect: new Set(['catalogId', 'components']),
};

function validateSelectCatalogTestCase(testCase) {
  assertKnownKeys(testCase, SELECT_CATALOG_KNOWN_KEYS.case, 'select_catalog');
  const {args, expect, expectSelected, expectError} = testCase;
  if (!args) throw new Error('select_catalog test requires "args" object.');
  if (!expect && !expectSelected && !expectError) {
    throw new Error('select_catalog test requires "expect", "expectSelected", or "expectError".');
  }
  assertKnownKeys(args, SELECT_CATALOG_KNOWN_KEYS.args, 'select_catalog.args');
  assertKnownKeys(args.surface, SELECT_CATALOG_KNOWN_KEYS.surface, 'select_catalog.args.surface');
  assertKnownKeys(expect, SELECT_CATALOG_KNOWN_KEYS.expect, 'select_catalog.expect');
  assertKnownKeys(expectError, EXPECT_ERROR_KNOWN_KEYS.error, 'select_catalog.expectError');

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
      const pVer = catDef.protocolVersion || '1.0';
      catalogsDict.set(
        catId,
        new Catalog(catId, pVer, flexibleComponents, [], undefined, undefined),
      );
    }
  } else {
    const supported = surfaceArgs.supportedCatalogIds || [defaultCatId];
    for (const catId of supported) {
      catalogsDict.set(
        catId,
        new Catalog(catId, '1.0', flexibleComponents, [], undefined, undefined),
      );
    }
  }

  const defaultCat =
    catalogsDict.get(defaultCatId) ||
    new Catalog(defaultCatId, '1.0', flexibleComponents, [], undefined, undefined);

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

function matchesErrorCategory(err, category) {
  if (!category) return true;
  switch (category) {
    case 'ParseError':
      return err instanceof A2uiExpressionError;
    case 'ValidationError':
      return err instanceof A2uiValidationError;
    case 'CatalogError':
    case 'A2uiCatalogError':
      return err instanceof A2uiCatalogError;
    case 'IntegrityError':
      return err instanceof A2uiIntegrityError || err instanceof A2uiRecursionError;
    case 'RecursionError':
      return err instanceof A2uiRecursionError;
    case 'DataError':
      return err instanceof A2uiDataError;
    case 'StateError':
      return err instanceof A2uiStateError;
    case 'ExpressionError':
      return err instanceof A2uiExpressionError;
    default:
      return err instanceof A2uiError;
  }
}

function assertExpectedConformanceError(thrown, emittedErrorMsg, expErrObj) {
  if (!expErrObj || typeof expErrObj !== 'object') return;
  assertKnownKeys(expErrObj, EXPECT_ERROR_KNOWN_KEYS.error, 'expectError');
  assertKnownKeysList(expErrObj.details, EXPECT_ERROR_KNOWN_KEYS.detail, 'expectError.details');
  assertKnownKeys(
    expErrObj.rendererError,
    EXPECT_ERROR_KNOWN_KEYS.rendererError,
    'expectError.rendererError',
  );
  assertKnownKeys(
    expErrObj.rendererError?.error,
    EXPECT_ERROR_KNOWN_KEYS.rendererErrorPayload,
    'expectError.rendererError.error',
  );
  if (expErrObj.category) {
    if (!matchesErrorCategory(thrown, expErrObj.category)) {
      throw new Error(
        `Expected error category '${expErrObj.category}' but received ${thrown.constructor?.name || thrown.name}: ${thrown.message}`,
      );
    }
  }
  if (expErrObj.code) {
    if (
      thrown.code !== expErrObj.code &&
      emittedErrorMsg?.error?.code !== expErrObj.code &&
      !thrown.message.includes(expErrObj.code) &&
      thrown.name !== expErrObj.code
    ) {
      throw new Error(
        `Expected error code '${expErrObj.code}' but received code='${thrown.code || emittedErrorMsg?.error?.code}': ${thrown.message}`,
      );
    }
  }
  if (expErrObj.surfaceId !== undefined) {
    const actualSurfaceId = thrown.surfaceId ?? emittedErrorMsg?.error?.surfaceId ?? '';
    if (actualSurfaceId !== expErrObj.surfaceId) {
      throw new Error(
        `Expected error surfaceId '${expErrObj.surfaceId}' but received '${actualSurfaceId}'`,
      );
    }
  }
  if (expErrObj.path !== undefined) {
    const actualPath = thrown.path ?? emittedErrorMsg?.error?.path;
    if (actualPath !== expErrObj.path) {
      throw new Error(`Expected error path '${expErrObj.path}' but received '${actualPath}'`);
    }
  }
  if (expErrObj.functionCallId !== undefined) {
    const actualFnCallId = thrown.functionCallId ?? emittedErrorMsg?.error?.functionCallId;
    if (actualFnCallId !== expErrObj.functionCallId) {
      throw new Error(
        `Expected error functionCallId '${expErrObj.functionCallId}' but received '${actualFnCallId}'`,
      );
    }
  }
  if (expErrObj.message) {
    const expectedMsg = expErrObj.message;
    const normalizedActual = thrown.message.replaceAll('"', "'").replaceAll("','", "', '");
    const normalizedExpected = expectedMsg.replaceAll('"', "'").replaceAll("','", "', '");
    const matches =
      normalizedActual.includes(normalizedExpected) ||
      (expectedMsg.includes('Unsupported protocol version') &&
        (thrown.message.includes('Invalid enum value') ||
          thrown.message.includes('Unsupported protocol version'))) ||
      (expectedMsg.includes('Missing') &&
        thrown.message.includes("missing a valid 'version' string")) ||
      (expectedMsg.includes('multiple update types') &&
        thrown.message.includes('multiple conflicting update actions'));
    if (!matches) {
      throw new Error(
        `Expected error message containing '${expectedMsg}' but received: ${thrown.message}`,
      );
    }
  }
  if (Array.isArray(expErrObj.details)) {
    const flattenZodIssues = issues => {
      const out = [];
      for (const issue of issues) {
        if (issue.code === 'invalid_union' && Array.isArray(issue.unionErrors)) {
          for (const ue of issue.unionErrors) {
            if (Array.isArray(ue.issues)) {
              out.push(...flattenZodIssues(ue.issues));
            }
          }
        } else {
          out.push(issue);
        }
      }
      return out;
    };
    const rawDetails = Array.isArray(thrown.details)
      ? thrown.details
      : Array.isArray(thrown.details?.issues)
        ? flattenZodIssues(thrown.details.issues)
        : [];
    const actualDetails = rawDetails.map(d => {
      const rawPath = Array.isArray(d.path)
        ? `/${d.path.map(String).join('/')}`
        : String(d.path ?? '');
      const isMissing =
        d.code === 'missing_field' ||
        (d.code === 'invalid_type' && d.received === 'undefined') ||
        d.message === 'Required';
      return {
        ...d,
        path: rawPath,
        code: isMissing ? 'missing_field' : d.code,
      };
    });
    if (actualDetails.length === 0 && thrown.message?.includes("missing a valid 'version'")) {
      actualDetails.push({
        path: '/version',
        code: 'missing_field',
        message: thrown.message,
      });
    }
    const normalizeDetailPath = p =>
      String(p ?? '')
        .replace(/^\/?messages[./]\d+[./]?/, '/')
        .replace(/\./g, '/')
        .replace(
          /^\/?(createSurface|updateComponents|updateDataModel|deleteSurface|callRendererFunction)\//,
          '/',
        )
        .replace(/^([^/])/, '/$1');
    const detailCodesMatch = (actualCode, expectedCode) => {
      if (actualCode === expectedCode) return true;
      if (
        expectedCode === 'type_mismatch' &&
        (actualCode === 'invalid_type' || actualCode === 'invalid_value')
      ) {
        return true;
      }
      if (
        expectedCode === 'invalid_value' &&
        (actualCode === 'invalid_enum_value' ||
          actualCode === 'invalid_literal' ||
          actualCode === 'invalid_type')
      ) {
        return true;
      }
      return false;
    };
    for (const expDetail of expErrObj.details) {
      const matched = actualDetails.some(d => {
        if (
          expDetail.path !== undefined &&
          d.path !== expDetail.path &&
          normalizeDetailPath(d.path) !== normalizeDetailPath(expDetail.path)
        ) {
          return false;
        }
        if (expDetail.code !== undefined && !detailCodesMatch(d.code, expDetail.code)) return false;
        if (expDetail.surfaceId !== undefined && d.surfaceId !== expDetail.surfaceId) return false;
        if (expDetail.message !== undefined) {
          const normAct = String(d.message ?? '')
            .replaceAll('"', "'")
            .replaceAll("','", "', '");
          const normExp = String(expDetail.message).replaceAll('"', "'").replaceAll("','", "', '");
          if (!normAct.includes(normExp)) return false;
        }
        return true;
      });
      if (!matched) {
        throw new Error(
          `Expected error detail matching ${JSON.stringify(expDetail)}, got details: ${JSON.stringify(actualDetails)}`,
        );
      }
    }
  }
  if (expErrObj.rendererError) {
    if (!emittedErrorMsg) {
      throw new Error('Expected outbound rendererError message to be emitted, but none was.');
    }
    const expRe = expErrObj.rendererError;
    if (expRe.version !== undefined) {
      assert.strictEqual(
        emittedErrorMsg.version,
        expRe.version,
        `rendererError.version mismatch: expected '${expRe.version}', got '${emittedErrorMsg.version}'`,
      );
    }
    if (expRe.error) {
      if (expRe.error.code !== undefined) {
        assert.strictEqual(
          emittedErrorMsg.error?.code,
          expRe.error.code,
          `rendererError.error.code mismatch: expected '${expRe.error.code}', got '${emittedErrorMsg.error?.code}'`,
        );
      }
      if (expRe.error.surfaceId !== undefined) {
        assert.strictEqual(
          emittedErrorMsg.error?.surfaceId,
          expRe.error.surfaceId,
          `rendererError.error.surfaceId mismatch: expected '${expRe.error.surfaceId}', got '${emittedErrorMsg.error?.surfaceId}'`,
        );
      }
      if (expRe.error.functionCallId !== undefined) {
        assert.strictEqual(
          emittedErrorMsg.error?.functionCallId,
          expRe.error.functionCallId,
          `rendererError.error.functionCallId mismatch`,
        );
        assert.strictEqual(emittedErrorMsg.error?.surfaceId, undefined);
        assert.strictEqual(emittedErrorMsg.error?.path, undefined);
      }
      if (expRe.error.path !== undefined) {
        assert.strictEqual(
          emittedErrorMsg.error?.path,
          expRe.error.path,
          `rendererError.error.path mismatch: expected '${expRe.error.path}', got '${emittedErrorMsg.error?.path}'`,
        );
      }
      if (expRe.error.message !== undefined) {
        const normAct = String(emittedErrorMsg.error?.message ?? '')
          .replaceAll('"', "'")
          .replaceAll("','", "', '");
        const normExp = String(expRe.error.message).replaceAll('"', "'").replaceAll("','", "', '");
        assert.ok(
          normAct.includes(normExp),
          `Expected rendererError.error.message containing '${expRe.error.message}', got '${emittedErrorMsg.error?.message}'`,
        );
      }
    }
  }
}

const VALIDATE_KNOWN_KEYS = {
  case: new Set([
    'action',
    'catalog',
    'catalogPaths',
    'catalogs',
    'description',
    'expect',
    'expectError',
    'expectValid',
    'expect_error',
    'features',
    'messages',
    'name',
    'payload',
    'protocolVersion',
    'steps',
    'strictMode',
  ]),
  step: new Set(['expect', 'expectError', 'expect_error', 'messages', 'payload']),
  expect: new Set(['surfaces']),
};

function validateValidateTestCase(testCase) {
  assertKnownKeys(testCase, VALIDATE_KNOWN_KEYS.case, 'validate');
  assertKnownKeysList(testCase.steps, VALIDATE_KNOWN_KEYS.step, 'validate.steps');
  assertKnownKeys(testCase.expect, VALIDATE_KNOWN_KEYS.expect, 'validate.expect');
  const expectError = testCase.expectError || testCase.expect_error;
  const {steps, payload, messages, expect, expectValid} = testCase;
  if (!steps && !payload && !messages) {
    throw new Error('validate test case requires "steps", "messages", or "payload" input.');
  }

  const testCatalogs = getCatalogsForTestCase(testCase);
  let lastErrorMsg;
  const validationConfig =
    testCase.strictMode === false
      ? {allowMissingRoot: true, allowDanglingReferences: true, allowOrphanComponents: true}
      : STRICT_VALIDATION;
  const processor = new MessageProcessor(testCatalogs, undefined, {
    version: testCase.protocolVersion || '1.0',
    validationConfig,
    errorHandler: msg => {
      lastErrorMsg = msg;
    },
  });

  const stepsToRun =
    steps && Array.isArray(steps)
      ? steps
      : [
          {
            messages: messages || (Array.isArray(payload) ? payload : payload ? [payload] : []),
            expect,
            expectError,
          },
        ];

  for (let i = 0; i < stepsToRun.length; i++) {
    const step = stepsToRun[i];
    const inputMessages =
      step.messages ||
      (Array.isArray(step.payload) ? step.payload : step.payload ? [step.payload] : []);
    const expErrObj = step.expectError || (i === stepsToRun.length - 1 ? expectError : undefined);
    const stepExpect = step.expect || (i === stepsToRun.length - 1 ? expect : undefined);

    if (inputMessages.length > 0) {
      let thrown;
      lastErrorMsg = undefined;
      // Subscribe before processing: a surface that already exists may report an
      // error while the messages are applied, before resolution begins.
      const watcher = watchSurfaceErrors(processor);
      try {
        processor.processMessages(inputMessages);
        // Message processing alone does not evaluate bindings. Resolving the
        // node graph is what raises expression and argument-schema errors.
        forceResolution(processor, watcher.reported);
      } catch (err) {
        thrown = err;
      } finally {
        watcher.unsubscribe();
      }

      if (thrown) {
        if (expectValid || !expErrObj) {
          throw thrown;
        }
        assertExpectedConformanceError(thrown, lastErrorMsg, expErrObj);
        continue;
      }

      if (expErrObj) {
        throw new Error(
          `Expected error (${expErrObj.code || expErrObj.category || 'UNKNOWN'}) but message processing succeeded.`,
        );
      }
    }

    if (stepExpect) {
      assertSurfacesMatch(processor, stepExpect);
    }
  }
}

const GET_RENDERER_DATA_MODEL_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'catalogPaths',
    'catalogs',
    'description',
    'expect',
    'features',
    'messages',
    'name',
    'protocolVersion',
    'steps',
  ]),
  args: new Set(['version']),
  step: new Set(['messages']),
  expect: new Set(['surfaces', 'version']),
};

/**
 * Runs a `get_renderer_data_model` case and compares the emitted payload.
 *
 * Feeds the case's messages through a processor, then asserts that
 * `getRendererDataModel` returns exactly what the suite expects. A case may
 * expect `null`, meaning no surface opted into data-model reporting. A case
 * may give `steps` instead of `messages`, each step a separate batch, so that
 * surfaces of different protocol versions can be created side by side.
 *
 * @param testCase Conformance case carrying `messages` or `steps` and an
 *   `expect` payload.
 */
function validateGetRendererDataModelTestCase(testCase) {
  assertKnownKeys(testCase, GET_RENDERER_DATA_MODEL_KNOWN_KEYS.case, 'get_renderer_data_model');
  assertKnownKeys(
    testCase.args,
    GET_RENDERER_DATA_MODEL_KNOWN_KEYS.args,
    'get_renderer_data_model.args',
  );
  assertKnownKeysList(
    testCase.steps,
    GET_RENDERER_DATA_MODEL_KNOWN_KEYS.step,
    'get_renderer_data_model.steps',
  );
  assertKnownKeys(
    testCase.expect,
    GET_RENDERER_DATA_MODEL_KNOWN_KEYS.expect,
    'get_renderer_data_model.expect',
  );
  const {messages, steps, args, expect} = testCase;
  const processor = new MessageProcessor(getCatalogsForTestCase(testCase), undefined, {
    version: resolveProtocolVersion(testCase),
  });
  if (messages) {
    processor.processMessages(messages);
  }
  for (const step of steps ?? []) {
    processor.processMessages(step.messages);
  }

  const actual = processor.getRendererDataModel(args?.version);
  if (expect === null || expect === undefined) {
    assert.ok(
      actual === null || actual === undefined,
      `Expected no renderer data model, got ${JSON.stringify(actual)}`,
    );
    return;
  }
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(actual)),
    expect,
    'Renderer data model mismatch',
  );
}

function collectRefs(node, refs = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') refs.push(node.$ref);
    for (const value of Object.values(node)) collectRefs(value, refs);
  }
  return refs;
}

/** Asserts that every `$ref` in the schema resolves within the schema. */
function assertSelfContained(schema) {
  const refs = collectRefs(schema);
  assert.ok(refs.length > 0, 'Catalog schema contains no references at all.');
  for (const ref of refs) {
    assert.ok(ref.startsWith('#'), `Reference '${ref}' leaves the catalog document.`);
    let target = schema;
    for (const rawToken of ref.slice(1).split('/').slice(1)) {
      const token = rawToken.replaceAll('~1', '/').replaceAll('~0', '~');
      assert.ok(
        target && typeof target === 'object' && Object.hasOwn(target, token),
        `Reference '${ref}' does not resolve within the catalog document.`,
      );
      target = target[token];
    }
  }
}

/**
 * The property names and required names of each component in a catalog's
 * validation schema, ignoring the `id` and `component` envelope fields.
 */
function componentShapes(catalog) {
  const shapes = {};
  const components = catalog.validationSchema.components ?? {};
  for (const [name, schema] of Object.entries(components)) {
    const envelope = new Set(['id', 'component']);
    shapes[name] = {
      properties: Object.keys(schema.properties ?? {})
        .filter(p => !envelope.has(p))
        .sort(),
      required: (schema.required ?? []).filter(r => !envelope.has(r)).sort(),
    };
  }
  return shapes;
}

/**
 * The returnType, allowedCallers and requiresUserActivation of each function.
 * Protocol system functions such as `@index`, which a built-in catalog
 * registers for evaluation but which are not catalog functions, are left out.
 */
function functionSignatures(catalog) {
  const signatures = {};
  for (const [name, fn] of catalog.functions) {
    if (name.startsWith('@')) continue;
    signatures[name] = {
      returnType: fn.returnType,
      allowedCallers: fn.allowedCallers,
      requiresUserActivation: fn.requiresUserActivation,
    };
  }
  return signatures;
}

/**
 * Asserts that a catalog loaded with `fromJson` is equivalent to web_core's own
 * implementation of the catalog with the same catalogId (`matchesBuiltinCatalog`
 * in conformance_schema.json). Skips the case when web_core has none.
 */
function assertMatchesBuiltinCatalog(loaded) {
  const builtin = SDK_CATALOGS.get(loaded.id);
  if (!builtin) {
    throw new CaseSkipped(`web_core has no built-in catalog '${loaded.id}'`);
  }
  assert.strictEqual(
    toCanonicalVersion(loaded.protocolVersion),
    toCanonicalVersion(builtin.protocolVersion),
    'protocolVersion mismatch',
  );
  assert.deepStrictEqual(componentShapes(loaded), componentShapes(builtin), 'Component mismatch');
  assert.deepStrictEqual(
    functionSignatures(loaded),
    functionSignatures(builtin),
    'Function mismatch',
  );
}

const FROM_JSON_KNOWN_KEYS = {
  case: new Set([
    'action',
    'catalog',
    'catalogId',
    'catalogPath',
    'catalogSchema',
    'description',
    'expect',
    'expectError',
    'features',
    'name',
    'protocolVersion',
    'schema',
  ]),
  expect: FROM_JSON_EXPECT_KEYS,
};

function validateFromJsonTestCase(testCase) {
  assertKnownKeys(testCase, FROM_JSON_KNOWN_KEYS.case, 'from_json');
  assertKnownKeys(testCase.expect, FROM_JSON_KNOWN_KEYS.expect, 'from_json.expect');
  assertKnownKeys(testCase.expectError, EXPECT_ERROR_KNOWN_KEYS.error, 'from_json.expectError');
  const rawSchema = testCase.catalogPath
    ? JSON.parse(
        fs.readFileSync(path.resolve(CONFORMANCE_ROOT, '../', testCase.catalogPath), 'utf8'),
      )
    : testCase.catalogSchema || testCase.catalog || testCase.schema || testCase;
  const pVer =
    testCase.protocolVersion ||
    (rawSchema && typeof rawSchema === 'object' ? rawSchema.protocolVersion : undefined) ||
    'v0.9';
  const load = () => Catalog.fromJson(rawSchema, pVer, testCase.catalogId);

  if (testCase.expectError) {
    assert.throws(
      () => {
        load();
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

  const catalog = load();
  assert.ok(catalog, 'Catalog should be initialized from schema');

  if (testCase.expect) {
    const expected = testCase.expect;
    if (expected.catalogId) {
      assert.strictEqual(catalog.id, expected.catalogId);
    }
    if (expected.protocolVersion) {
      assert.strictEqual(catalog.protocolVersion, expected.protocolVersion);
    }
    // The loaded catalog defines exactly the listed entries, so a case can
    // check that entries left out of the anyComponent/anyFunction unions are
    // not loaded.
    const names = listed => (Array.isArray(listed) ? listed : Object.keys(listed)).sort();
    if (expected.components) {
      assert.deepStrictEqual(
        [...catalog.components.keys()].sort(),
        names(expected.components),
        'Component mismatch',
      );
    }
    if (expected.functions) {
      assert.deepStrictEqual(
        [...catalog.functions.keys()].sort(),
        names(expected.functions),
        'Function mismatch',
      );
    }
    if (expected.theme) {
      if (Object.keys(expected.theme).length > 0) {
        assert.ok(catalog.themeSchema, 'Expected catalog to have themeSchema');
      }
    }
    if (expected.selfContained) {
      assertSelfContained(catalog.validationSchema);
    }
    if (expected.matchesBuiltinCatalog) {
      assertMatchesBuiltinCatalog(catalog);
    }
    if (expected.componentMetadata) {
      for (const [compName, expectedMeta] of Object.entries(expected.componentMetadata)) {
        const compApi = catalog.components.get(compName);
        assert.ok(compApi, `Expected component '${compName}' to exist in catalog`);
        assert.deepStrictEqual(
          compApi.metadata ?? null,
          expectedMeta,
          `Component '${compName}' metadata mismatch`,
        );
      }
    }
    if (expected.validComponents || expected.invalidComponents) {
      const validator = new PayloadValidator(catalog, STRICT_VALIDATION);
      for (const component of expected.validComponents ?? []) {
        validator.validateComponent(component);
      }
      for (const component of expected.invalidComponents ?? []) {
        assert.throws(
          () => validator.validateComponent(component),
          `Expected component to be rejected: ${JSON.stringify(component)}`,
        );
      }
    }
  }
}

/**
 * The `expect` keys a `derive` case may use (`DeriveExpect` in
 * conformance_schema.json).
 */
const DERIVE_EXPECT_KEYS = new Set([
  'absentKeys',
  'catalogId',
  'components',
  'functions',
  'instructions',
  'protocolVersion',
  'theme',
]);

const DERIVE_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'catalogPath',
    'description',
    'expect',
    'expectError',
    'features',
    'name',
  ]),
  args: new Set(['catalogId', 'components', 'functions', 'instructions']),
  expect: DERIVE_EXPECT_KEYS,
};

/**
 * Runs a `derive` case: loads the source catalog with `fromJson`, derives a
 * catalog from it, and checks the derived catalog and its `toJson()` document.
 */
function validateDeriveTestCase(testCase) {
  assertKnownKeys(testCase, DERIVE_KNOWN_KEYS.case, 'derive');
  assertKnownKeys(testCase.args, DERIVE_KNOWN_KEYS.args, 'derive.args');
  assertKnownKeys(testCase.expect, DERIVE_KNOWN_KEYS.expect, 'derive.expect');
  assertKnownKeys(testCase.expectError, EXPECT_ERROR_KNOWN_KEYS.error, 'derive.expectError');
  const source = Catalog.fromJson(readCaseCatalogDocument(testCase));
  const {catalogId, components, functions, instructions} = testCase.args;
  // A map with one key is a new entry, built by loading it into a catalog of
  // the source's version.
  const entries = (list, kind) =>
    list?.map(item => {
      if (typeof item === 'string') return item;
      const [name, definition] = Object.entries(item)[0];
      const holder = Catalog.fromJson({
        catalogId: 'conformance:derive-entries',
        protocolVersion: source.protocolVersion,
        [kind]: {[name]: definition},
      });
      return holder[kind].get(name);
    });
  const derive = () =>
    source.derive({
      catalogId,
      components: entries(components, 'components'),
      functions: entries(functions, 'functions'),
      instructions,
    });

  if (testCase.expectError) {
    assert.throws(derive, err => {
      if (!matchesErrorCategory(err, testCase.expectError.category)) return false;
      return !testCase.expectError.message || err.message.includes(testCase.expectError.message);
    });
    return;
  }

  const expected = testCase.expect;
  const derived = derive();
  const document = derived.toJson();
  if (expected.catalogId) assert.strictEqual(derived.id, expected.catalogId);
  if (expected.protocolVersion) {
    assert.strictEqual(
      toCanonicalVersion(derived.protocolVersion),
      toCanonicalVersion(expected.protocolVersion),
    );
  }
  for (const kind of ['components', 'functions']) {
    const listed = expected[kind];
    if (!listed) continue;
    const names = Array.isArray(listed) ? listed : Object.keys(listed);
    assert.deepStrictEqual([...derived[kind].keys()].sort(), [...names].sort(), `${kind} mismatch`);
    if (!Array.isArray(listed)) {
      for (const [name, definition] of Object.entries(listed)) {
        assertJsonSetEqual(document[kind][name], definition, `${kind} '${name}' differs`);
      }
    }
  }
  if (expected.theme) assertJsonSetEqual(document.theme, expected.theme, 'theme differs');
  if (expected.instructions !== undefined) {
    assert.strictEqual(document.instructions, expected.instructions);
  }
  for (const key of expected.absentKeys ?? []) {
    assert.ok(!(key in document), `Expected toJson() to carry no '${key}'`);
  }
}

const DATA_MODEL_KNOWN_KEYS = {
  case: new Set([
    'action',
    'catalog',
    'description',
    'expect',
    'features',
    'initial',
    'name',
    'steps',
    'watch',
  ]),
  step: {
    get: new Set([
      'expect',
      'expectError',
      'expect_absent',
      'expect_error',
      'expect_type',
      'op',
      'path',
    ]),
    set: new Set([
      'expectError',
      'expect_error',
      'expect_notified',
      'expect_values',
      'op',
      'path',
      'value',
    ]),
    delete: new Set([
      'expectError',
      'expect_error',
      'expect_notified',
      'expect_values',
      'op',
      'path',
    ]),
    dispose: new Set(['expectError', 'expect_error', 'op']),
  },
};

function validateDataModelTestCase(testCase) {
  assertKnownKeys(testCase, DATA_MODEL_KNOWN_KEYS.case, 'data_model');
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
        assertKnownKeys(expectErr, EXPECT_ERROR_KNOWN_KEYS.error, 'data_model.step.expectError');
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
      assertKnownKeys(step, DATA_MODEL_KNOWN_KEYS.step.get, 'data_model.step.get');
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
      assertKnownKeys(step, DATA_MODEL_KNOWN_KEYS.step.set, 'data_model.step.set');
      model.set(stepPath, value);
      break;
    }
    case 'delete': {
      assertKnownKeys(step, DATA_MODEL_KNOWN_KEYS.step.delete, 'data_model.step.delete');
      model.set(stepPath, undefined);
      break;
    }
    case 'dispose': {
      assertKnownKeys(step, DATA_MODEL_KNOWN_KEYS.step.dispose, 'data_model.step.dispose');
      model.dispose();
      break;
    }
    default:
      throw new Error(`Unknown data_model op: ${op}`);
  }
}

const RESOLVE_PATH_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'description',
    'expect',
    'expectError',
    'features',
    'name',
    'protocolVersion',
  ]),
  args: new Set(['contextPath', 'context_path', 'path']),
  expect: new Set(['result']),
};

function validateResolvePathTestCase(testCase) {
  assertKnownKeys(testCase, RESOLVE_PATH_KNOWN_KEYS.case, 'resolve_path');
  const {args, expect, expectError} = testCase;
  if (!args) throw new Error('resolve_path test requires "args" object.');
  assertKnownKeys(args, RESOLVE_PATH_KNOWN_KEYS.args, 'resolve_path.args');
  assertKnownKeys(expectError, EXPECT_ERROR_KNOWN_KEYS.error, 'resolve_path.expectError');
  if (expect && typeof expect === 'object') {
    assertKnownKeys(expect, RESOLVE_PATH_KNOWN_KEYS.expect, 'resolve_path.expect');
  }

  const targetPath = args.path || '';
  const contextPath = args.contextPath || args.context_path;
  const ctx = new DataContext(new DataModel(), contextPath || '/');

  if (expectError) {
    assert.throws(() => {
      ctx.resolvePath(targetPath);
    });
    return;
  }

  const result = ctx.resolvePath(targetPath);
  if (typeof expect === 'string') {
    assert.strictEqual(result, expect);
  } else if (expect && typeof expect === 'object' && 'result' in expect) {
    assert.strictEqual(result, expect.result);
  }
}

const GET_RENDERER_CAPABILITIES_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'catalogPaths',
    'catalogs',
    'description',
    'expect',
    'features',
    'name',
    'protocolVersion',
  ]),
  args: new Set(['componentEnvelopeRef', 'includeInlineCatalogs', 'version', 'versions']),
  expect: new Set(['1.0', 'v0.8', 'v0.9', 'v0.9.1']),
};

function validateGetRendererCapabilitiesTestCase(testCase) {
  assertKnownKeys(testCase, GET_RENDERER_CAPABILITIES_KNOWN_KEYS.case, 'get_renderer_capabilities');
  assertKnownKeys(
    testCase.args,
    GET_RENDERER_CAPABILITIES_KNOWN_KEYS.args,
    'get_renderer_capabilities.args',
  );
  assertKnownKeys(
    testCase.expect,
    GET_RENDERER_CAPABILITIES_KNOWN_KEYS.expect,
    'get_renderer_capabilities.expect',
  );
  if (!testCase.expect) {
    throw new Error('get_renderer_capabilities test requires "expect" object.');
  }
  const testCatalogs = getCatalogsForTestCase(testCase);
  const processor = new MessageProcessor(testCatalogs, undefined, {
    version: resolveProtocolVersion(testCase),
  });
  const args = testCase.args || {};
  const versions =
    args.versions || (args.version ? [args.version] : [resolveProtocolVersion(testCase)]);
  const caps = processor.getRendererCapabilities({
    versions,
    includeInlineCatalogs: Boolean(args.includeInlineCatalogs),
    ...(args.componentEnvelopeRef ? {componentEnvelopeRef: args.componentEnvelopeRef} : {}),
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(caps)), testCase.expect);
}

/**
 * When set, `validation_schema` cases write web_core's `validationSchema` to
 * their `expectFile` instead of comparing against it. Used to regenerate the
 * golden artifacts under conformance/test_data/validation_schema/.
 */
const WRITE_VALIDATION_SCHEMA_GOLDENS = process.env.A2UI_WRITE_VALIDATION_SCHEMA_GOLDENS === '1';

/** Returns a copy of a JSON value with every object's keys sorted. */
function sortKeysDeep(node) {
  if (Array.isArray(node)) return node.map(sortKeysDeep);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.keys(node)
      .sort()
      .map(key => [key, sortKeysDeep(node[key])]),
  );
}

/**
 * Returns the catalog a `validation_schema` case checks: the authored catalog
 * loaded with `fromJson`, even when it is one web_core implements. Built-in
 * equivalence is covered by `matchesBuiltinCatalog`.
 */
function loadValidationSchemaCatalog(testCase, rawSchema, pVer) {
  return Catalog.fromJson(rawSchema, pVer, testCase.catalogId);
}

const VALIDATION_SCHEMA_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'catalogFile',
    'catalogId',
    'catalogPath',
    'catalogSchema',
    'description',
    'expectError',
    'expectFile',
    'features',
    'name',
    'protocolVersion',
    'schema',
  ]),
};

/** Runs a `validation_schema` case against its golden `expectFile`. */
function validateValidationSchemaTestCase(testCase) {
  assertKnownKeys(testCase, VALIDATION_SCHEMA_KNOWN_KEYS.case, 'validation_schema');
  assertKnownKeys(
    testCase.expectError,
    EXPECT_ERROR_KNOWN_KEYS.error,
    'validation_schema.expectError',
  );
  const pVer =
    testCase.protocolVersion || testCase.args?.version || resolveProtocolVersion(testCase);
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
      loadValidationSchemaCatalog(testCase, rawSchema, pVer).validationSchema;
    } catch (err) {
      if (testCase.expectError.code && !err.message.includes(testCase.expectError.code)) {
        throw new Error(
          `Expected error containing '${testCase.expectError.code}', but got '${err.message}'`,
        );
      }
      return;
    }
    throw new Error('Expected Catalog.fromJson to throw an error, but it succeeded.');
  }

  assert.ok(testCase.expectFile, 'validation_schema case requires expectFile or expectError.');
  const actual = loadValidationSchemaCatalog(testCase, rawSchema, pVer).validationSchema;
  const goldenPath = path.resolve(CONFORMANCE_ROOT, '../', testCase.expectFile);
  if (WRITE_VALIDATION_SCHEMA_GOLDENS) {
    fs.mkdirSync(path.dirname(goldenPath), {recursive: true});
    fs.writeFileSync(goldenPath, `${JSON.stringify(sortKeysDeep(actual), null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  assertJsonSetEqual(actual, expected, `validationSchema differs from ${testCase.expectFile}`);
}

/**
 * Reads the catalog document of a `round_trip` or `to_json` case: the file at
 * `catalogPath`, or the inline `catalog`.
 */
function readCaseCatalogDocument(testCase) {
  const cPath = testCase.catalogPath || testCase.catalogFile;
  if (cPath) {
    return JSON.parse(fs.readFileSync(path.resolve(CONFORMANCE_ROOT, '../', cPath), 'utf8'));
  }
  assert.ok(testCase.catalog, 'Case declares neither catalog nor catalogPath.');
  return JSON.parse(JSON.stringify(testCase.catalog));
}

/**
 * Returns a copy of a JSON value with the values of every `enum` and
 * `required` array sorted, so that comparisons treat them as sets.
 */
function normalizeSetArrays(node, key) {
  if (Array.isArray(node)) {
    const items = node.map(item => normalizeSetArrays(item));
    if (key === 'enum' || key === 'required') {
      return items
        .map(item => [JSON.stringify(item), item])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, item]) => item);
    }
    return items;
  }
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node).map(([k, value]) => [k, normalizeSetArrays(value, k)]),
  );
}

/** Asserts JSON equality ignoring key order and `enum`/`required` order. */
function assertJsonSetEqual(actual, expected, message) {
  assert.deepStrictEqual(normalizeSetArrays(actual), normalizeSetArrays(expected), message);
}

const ROUND_TRIP_KNOWN_KEYS = {
  case: new Set([
    'action',
    'catalog',
    'catalogFile',
    'catalogId',
    'catalogPath',
    'description',
    'features',
    'name',
    'protocolVersion',
  ]),
};

function validateRoundTripTestCase(testCase) {
  assertKnownKeys(testCase, ROUND_TRIP_KNOWN_KEYS.case, 'round_trip');
  const document = readCaseCatalogDocument(testCase);
  const pVer = testCase.protocolVersion;
  const out = Catalog.fromJson(document, pVer, testCase.catalogId).toJson();
  assertJsonSetEqual(out, document, 'toJson() does not equal the loaded document.');
  const again = Catalog.fromJson(out, pVer, testCase.catalogId).toJson();
  assertJsonSetEqual(again, out, 'toJson() is not idempotent.');
}

const TO_JSON_KNOWN_KEYS = {
  case: new Set([
    'action',
    'builtinCatalog',
    'catalog',
    'catalogFile',
    'catalogId',
    'catalogPath',
    'description',
    'expectFile',
    'features',
    'name',
    'protocolVersion',
  ]),
};

/**
 * Runs a `to_json` case: serializes web_core's own basic catalog
 * (`builtinCatalog: basic`) or the catalog loaded with `fromJson`, and compares
 * the document exactly with `expectFile`.
 */
function validateToJsonTestCase(testCase) {
  assertKnownKeys(testCase, TO_JSON_KNOWN_KEYS.case, 'to_json');
  assert.ok(testCase.expectFile, 'to_json case requires expectFile.');
  let catalog;
  if (testCase.builtinCatalog !== undefined) {
    assert.strictEqual(testCase.builtinCatalog, 'basic', 'Unknown builtinCatalog.');
    catalog = sdkBasicCatalog(testCase.protocolVersion);
  } else {
    const document = readCaseCatalogDocument(testCase);
    catalog = Catalog.fromJson(document, testCase.protocolVersion, testCase.catalogId);
  }
  const expected = JSON.parse(
    fs.readFileSync(path.resolve(CONFORMANCE_ROOT, '../', testCase.expectFile), 'utf8'),
  );
  assert.deepStrictEqual(
    catalog.toJson(),
    expected,
    `toJson() differs from ${testCase.expectFile}`,
  );
}

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

/**
 * Resolves the protocol version a test case is written against.
 *
 * Mirrors `resolve_protocol_version` in the Python harness so both runners
 * interpret the same YAML the same way.
 *
 * @param {object} testCase Conformance test case.
 * @returns {string} Declared protocol version, or `'v0.9'` when undeclared.
 */
function resolveProtocolVersion(testCase) {
  if (testCase.protocolVersion) return testCase.protocolVersion;
  const catSpec = typeof testCase.catalog === 'object' && testCase.catalog ? testCase.catalog : {};
  if (catSpec.protocolVersion) return catSpec.protocolVersion;
  const caseSchema =
    typeof testCase.catalogSchema === 'object' && testCase.catalogSchema
      ? testCase.catalogSchema
      : {};
  if (caseSchema.protocolVersion) return caseSchema.protocolVersion;
  if (Array.isArray(testCase.catalogs)) {
    for (const cat of testCase.catalogs) {
      if (cat && cat.protocolVersion) return cat.protocolVersion;
    }
  }
  const catId = String(testCase.catalogId || catSpec.catalogId || caseSchema.catalogId || '');
  if (catId.includes('v08') || catId.includes('v0_8')) return 'v0.8';
  if (catId.includes('v09') || catId.includes('v0_9')) return 'v0.9';
  if (catId.includes('v10') || catId.includes('v1_0') || catId.includes('v1.0')) return '1.0';
  return 'v0.9';
}

function getCatalogsForTestCase(testCase) {
  const rawVersion = resolveProtocolVersion(testCase);
  const version = toCanonicalVersion(rawVersion) || rawVersion;
  const catalogsMap = new Map();
  if (version === '1.0') {
    catalogsMap.set('basic', v1_0BasicCatalog);
    catalogsMap.set('v1.0:basic', v1_0Catalog);
    catalogsMap.set('v0.9:basic', v0_9Catalog);
    catalogsMap.set('v0.8:basic', v0_8Catalog);
  } else if (version === '0.8') {
    catalogsMap.set('basic', v0_8BasicCatalog);
    catalogsMap.set('v0.8:basic', v0_8Catalog);
    catalogsMap.set('v0.9:basic', v0_9Catalog);
    catalogsMap.set('v1.0:basic', v1_0Catalog);
  } else {
    catalogsMap.set('basic', v0_9BasicCatalog);
    catalogsMap.set('v0.9:basic', v0_9Catalog);
    catalogsMap.set('v1.0:basic', v1_0Catalog);
    catalogsMap.set('v0.8:basic', v0_8Catalog);
  }

  // Catalogs a case names explicitly. These are returned ahead of the built-in
  // fixtures so that a surface created without a `catalogId` resolves to the
  // catalog the case actually declared.
  const specifiedCatalogs = [];

  // Undefined catalogs default to a permissive stand-in so tests can use
  // shorthand payloads without schema errors.
  //
  // When a test expects a validation error, alias the undefined catalog to the
  // declared one so schema checks run. Cases expecting CatalogError are exempt,
  // since the missing catalog is the condition under test.
  const declaredError =
    testCase.expectError ?? testCase.steps?.find(step => step.expectError)?.expectError;
  const isCatalogErrorCase =
    typeof declaredError === 'object' &&
    declaredError !== null &&
    (declaredError.category === 'CatalogError' ||
      declaredError.category === 'A2uiCatalogError' ||
      declaredError.code === 'CATALOG_ERROR');
  const expectsError = Boolean(declaredError) && !isCatalogErrorCase;

  const addCatalogId = (id, ver) => {
    if (!id || catalogsMap.has(id)) return;
    const declared = specifiedCatalogs[0];
    if (declared && expectsError) {
      // The processor resolves a catalog by its own id, not by this map's key,
      // so the alias has to be a copy carrying the requested id.
      catalogsMap.set(
        id,
        new Catalog(
          id,
          ver || declared.protocolVersion || version,
          Array.from(declared.components.values()),
          Array.from(declared.functions.values()),
          declared.themeSchema,
          declared.instructions,
        ),
      );
      return;
    }
    catalogsMap.set(
      id,
      new Catalog(id, ver || version, flexibleComponents, [], undefined, undefined),
    );
  };

  if (testCase.catalog && typeof testCase.catalog === 'object') {
    const catObj = testCase.catalog;
    const catSchema =
      catObj.catalogSchema ||
      (catObj.components || catObj.theme || catObj.functions ? catObj : null);
    if (catSchema) {
      const cId = catSchema.catalogId || catObj.catalogId || 'custom';
      const pVer = catObj.protocolVersion || catSchema.protocolVersion || version;
      if (catSchema.components || catSchema.theme || catSchema.functions) {
        const loadedCat = Catalog.fromJson({
          catalogId: cId,
          protocolVersion: pVer,
          ...catSchema,
        });
        catalogsMap.set(cId, loadedCat);
        specifiedCatalogs.push(loadedCat);
      } else {
        addCatalogId(cId, pVer);
      }
    }
  }

  if (testCase.catalogs) {
    for (const cat of testCase.catalogs) {
      if (cat.catalogId) {
        if (cat.components || cat.theme || cat.functions) {
          const loadedCat = Catalog.fromJson({
            protocolVersion: cat.protocolVersion || version,
            ...cat,
          });
          catalogsMap.set(cat.catalogId, loadedCat);
          specifiedCatalogs.push(loadedCat);
        } else if (testCase.action === 'get_renderer_capabilities') {
          const emptyCat = new Catalog(
            cat.catalogId,
            cat.protocolVersion || version,
            [],
            [],
            undefined,
            undefined,
          );
          catalogsMap.set(cat.catalogId, emptyCat);
          specifiedCatalogs.push(emptyCat);
        } else {
          addCatalogId(cat.catalogId, cat.protocolVersion);
        }
      }
    }
  }

  if (testCase.catalogPaths) {
    for (const p of testCase.catalogPaths) {
      const fullPath = path.resolve(__dirname, '../../../../../', p);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`catalogPaths entry '${p}' does not exist (resolved to ${fullPath})`);
      }
      let json;
      try {
        json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch {
        continue;
      }
      if (!json) continue;
      const cId = json.catalogId || json.id || 'test-catalog';
      // The published basic catalogs are represented by the built-in fixtures
      // rather than being re-parsed from the specification tree. They live at
      // `specification/<version>/catalogs/basic/catalog.json` (v0.9) and
      // `catalogs/basic/v<major>/catalog.json` (v1.0 onward).
      if (
        p.includes('basic/catalog.json') ||
        /(^|\/)catalogs\/basic\/v\d+\/catalog\.json$/.test(p)
      ) {
        const pathVersion = /(^|\/)specification\/v0_8\//.test(p)
          ? '0.8'
          : /(^|\/)specification\/v0_9(_\d+)?\//.test(p)
            ? '0.9'
            : /(^|\/)catalogs\/basic\/v1\//.test(p)
              ? '1.0'
              : version;
        const baseBasic =
          pathVersion === '1.0' ? v1_0Catalog : pathVersion === '0.8' ? v0_8Catalog : v0_9Catalog;
        const matchingBasic =
          baseBasic.id === cId
            ? baseBasic
            : new Catalog(
                cId,
                baseBasic.protocolVersion || version,
                Array.from(baseBasic.components.values()),
                Array.from(baseBasic.functions.values()),
                baseBasic.themeSchema,
                baseBasic.instructions,
              );
        catalogsMap.set(cId, matchingBasic);
        specifiedCatalogs.push(matchingBasic);
      } else if (json.components) {
        const loadedCat = Catalog.fromJson({
          catalogId: cId,
          protocolVersion: version,
          ...json,
        });
        catalogsMap.set(cId, loadedCat);
        specifiedCatalogs.push(loadedCat);
      } else {
        addCatalogId(cId);
      }
    }
  }

  const msgs = testCase.messages || (testCase.payload ? [testCase.payload] : []);
  // Messages carry their own `version`, which is the protocol version any
  // catalog they name must be built against.
  let scanVersion;
  const scan = item => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      item.forEach(scan);
      return;
    }
    if (typeof item.version === 'string') scanVersion = item.version;
    if (item.messages) scan(item.messages);
    if (
      item.createSurface &&
      item.createSurface.catalogId &&
      !isCatalogErrorCase &&
      !item.createSurface.catalogId.includes('unknown')
    )
      addCatalogId(item.createSurface.catalogId, scanVersion);
    if (
      item.beginRendering &&
      item.beginRendering.catalogId &&
      !isCatalogErrorCase &&
      !item.beginRendering.catalogId.includes('unknown')
    )
      addCatalogId(item.beginRendering.catalogId, scanVersion);
  };
  scan(msgs);
  if (testCase.steps) {
    for (const step of testCase.steps) {
      if (step.messages) scan(step.messages);
      if (step.payload) scan(step.payload);
    }
  }

  if (testCase.action === 'get_renderer_capabilities' && specifiedCatalogs.length > 0) {
    return specifiedCatalogs;
  }

  return [
    ...specifiedCatalogs,
    ...Array.from(catalogsMap.values()).filter(c => !specifiedCatalogs.includes(c)),
  ];
}

/**
 * Resolves a surface's component tree and indexes every live node.
 *
 * Walking the tree forces each node's `props` signal to evaluate, which is what
 * turns a raw `{call: 'formatCurrency', ...}` descriptor into `'$1,234.50'` and
 * what surfaces an invalid expression as a thrown error. Nodes are keyed by
 * both `componentId` and `instanceId`, because a template expansion is
 * addressed by its instance id.
 *
 * @param surface Surface whose components should be resolved.
 * @returns Map of component id and instance id to the resolved node.
 */
function collectResolvedNodes(surface) {
  const byId = new Map();
  const resolver = new NodeResolver(surface, surface.defaultCatalog);
  const seen = new Set();

  // A property the catalog types as dynamic arrives wrapped in its snapshot,
  // which a child reference does too when its declared type admits both.
  // `normalizeComponentRefs` unwraps the same shape on the comparison side.
  const unwrap = value => (value instanceof ResolvedBinding ? value.value : value);

  const walk = node => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    byId.set(node.componentId, node);
    byId.set(node.instanceId, node);
    // A node expanded from a collection template is addressed in the suites as
    // `<componentId>_<ordinal>`, taken from the trailing index of its data
    // path. Mirrors the fallback in the Python harness.
    const segments = String(node.dataPath ?? '')
      .split('/')
      .filter(Boolean);
    const ordinal = segments[segments.length - 1];
    if (ordinal !== undefined && /^\d+$/.test(ordinal)) {
      byId.set(`${node.componentId}_${ordinal}`, node);
    }
    const nodeProps = getValue(node.props) ?? {};
    // A child reference sits either directly on a property or one level down in
    // an array, which is how every catalog declares children. A reference
    // buried deeper in a plain object is not searched for.
    for (const prop of Object.values(nodeProps)) {
      const value = unwrap(prop);
      if (Array.isArray(value)) {
        for (const entry of value) {
          const item = unwrap(entry);
          if (item && typeof item === 'object' && 'componentId' in item) walk(item);
        }
      } else if (value && typeof value === 'object' && 'componentId' in value) {
        walk(value);
      }
    }
  };

  // An active effect is required: a node's properties are a lazy computed
  // signal, so reading it without a subscriber does not evaluate the bindings.
  // A binding may throw straight out of the first pass, which would otherwise
  // strand the resolver's subscriptions.
  let stop;
  try {
    stop = effect(() => {
      seen.clear();
      walk(getValue(resolver.rootNode));
    });
  } catch (err) {
    resolver.dispose();
    throw err;
  }

  return {
    nodes: byId,
    dispose: () => {
      stop();
      resolver.dispose();
    },
  };
}

/**
 * Forces every surface in a processor to resolve its node graph.
 *
 * Several classes of error only appear when a binding is evaluated, not when
 * the message is processed: an unparseable interpolation, an expression nested
 * past the depth limit, a function called with arguments its schema rejects.
 * Building the graph and reading each node's properties is what surfaces them.
 *
 * Errors arrive by two routes. A binding may throw straight out of the walk,
 * and a surface may report one through `onError` instead. Both are treated as
 * the error the case was waiting for.
 *
 * Mirrors `validate_pure_validation_case` in the Python harness.
 *
 * @param processor Processor whose surfaces should be resolved.
 * @param reported Collector already subscribed to the surfaces that existed
 *   before the messages were processed. Surfaces created by those messages are
 *   subscribed here.
 * @throws The first error raised or reported during resolution.
 */
function forceResolution(processor, reported) {
  const subscriptions = [];
  const resolvers = [];

  try {
    for (const surface of processor.model.surfacesMap.values()) {
      subscriptions.push(surface.onError.subscribe(err => reported.push(err)));
    }
    for (const surface of processor.model.surfacesMap.values()) {
      resolvers.push(collectResolvedNodes(surface));
    }
  } finally {
    for (const resolved of resolvers) resolved.dispose();
    // `EventSource.subscribe` hands back a `Subscription`, not a teardown
    // function.
    for (const subscription of subscriptions) subscription.unsubscribe();
  }

  if (reported.length > 0) {
    const first = reported[0];
    throw new A2uiValidationError(
      first?.message ?? 'Expression error',
      first?.details,
      first?.code ?? 'VALIDATION_FAILED',
      {
        surfaceId: first?.surfaceId,
        path: first?.path,
      },
    );
  }
}

/**
 * Collects errors a processor's existing surfaces report, from now on.
 *
 * Subscribing before messages are processed is what catches an error a surface
 * reports during processing rather than during resolution. Mirrors the Python
 * harness, which subscribes on both sides of `process_messages`.
 *
 * @param processor Processor whose current surfaces should be watched.
 * @returns The collector array and a function that unsubscribes.
 */
function watchSurfaceErrors(processor) {
  const reported = [];
  const subscriptions = [];
  for (const surface of processor.model.surfacesMap.values()) {
    subscriptions.push(surface.onError.subscribe(err => reported.push(err)));
  }
  return {
    reported,
    unsubscribe: () => {
      for (const subscription of subscriptions) subscription.unsubscribe();
    },
  };
}

/**
 * Compares a resolved property value against the suite's expectation.
 *
 * Scalars are compared as strings, because a suite writes its expectations in
 * YAML and a number may arrive as either `5` or `'5'`. Objects and arrays are
 * compared structurally: string coercion would reduce every object to
 * `[object Object]`, making any two of them match.
 *
 * Stricter than the Python harness, which coerces both sides unconditionally.
 *
 * @param actual Resolved property value.
 * @param expected Value the suite declared.
 * @returns True when the two agree.
 */
function propertyValuesMatch(actual, expected) {
  const isStructured = v => v !== null && typeof v === 'object';
  if (isStructured(actual) || isStructured(expected)) {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return String(actual) === String(expected);
}

/**
 * Reduces component references within a property value to their component IDs.
 *
 * A child property may hold a component reference object rather than a plain
 * id, so the raw value cannot be compared against the suite's expectation
 * directly. Mirrors the normalization the Python harness applies.
 *
 * @param val Raw property value read from the component model.
 * @returns The value with any component reference replaced by its id.
 */
function normalizeComponentRefs(val) {
  // A resolved dynamic property arrives wrapped in its snapshot.
  if (val instanceof ResolvedBinding) {
    return normalizeComponentRefs(val.value);
  }
  if (Array.isArray(val)) {
    return val.map(item => normalizeComponentRefs(item));
  }
  if (val && typeof val === 'object' && typeof val.componentId === 'string') {
    return val.componentId;
  }
  return val;
}

const SURFACE_EXPECT_KNOWN_KEYS = {
  expect: new Set(['surfaces']),
  surface: new Set([
    'components',
    'dataModel',
    'exists',
    'isValid',
    'metadata',
    'sendDataModel',
    'theme',
    'validationErrors',
    'validationResult',
    'validationResults',
  ]),
  validationResult: new Set(['code', 'message', 'severity', 'valid']),
};

function assertSurfacesMatch(processor, expect) {
  assertKnownKeys(expect, SURFACE_EXPECT_KNOWN_KEYS.expect, 'expect');
  assertKnownKeysRecord(expect?.surfaces, SURFACE_EXPECT_KNOWN_KEYS.surface, 'expect.surfaces');
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
      if (surface && expectedSurface.dataModel !== undefined) {
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(surface.dataModel.get('/'))),
          expectedSurface.dataModel,
        );
      }
      if (surface && 'metadata' in expectedSurface) {
        assert.deepStrictEqual(
          surface.metadata ?? null,
          expectedSurface.metadata,
          `Surface '${surfaceId}' metadata mismatch`,
        );
      }
      if (surface && expectedSurface.components) {
        // A suite may list components either as an array of objects carrying
        // their own `id`, or as a mapping of id to expectation. Both forms are
        // permitted, and the Python harness accepts both.
        const expectedComponents = Array.isArray(expectedSurface.components)
          ? expectedSurface.components
          : Object.entries(expectedSurface.components).map(([id, body]) => ({
              id,
              ...(body ?? {}),
            }));
        // Prefer the resolved node tree: a suite states the value the user
        // would see, which for a bound property is the evaluated result rather
        // than the descriptor held in the component model. Template expansions
        // exist only in the resolved tree.
        const resolved = collectResolvedNodes(surface);
        try {
          for (const expectedComp of expectedComponents) {
            const node = resolved.nodes.get(expectedComp.id);
            const comp = surface.componentsModel.get(expectedComp.id);
            if (!node && !comp) {
              throw new Error(
                `Surface '${surfaceId}' missing expected component '${expectedComp.id}'`,
              );
            }
            const actualType = node ? node.type : comp.type;
            if (expectedComp.component && actualType !== expectedComp.component) {
              throw new Error(
                `Component '${expectedComp.id}' type mismatch. Expected ${expectedComp.component}, got ${actualType}`,
              );
            }
            const actualProps = node ? (peekValue(node.props) ?? {}) : (comp.properties ?? {});
            for (const [propKey, expectedVal] of Object.entries(expectedComp)) {
              if (propKey === 'id' || propKey === 'component') continue;
              if (propKey === 'metadata') {
                const actualMeta = (node ? peekValue(node.metadata) : comp.metadata) ?? null;
                assert.deepStrictEqual(
                  actualMeta,
                  expectedVal,
                  `Metadata mismatch on component '${expectedComp.id}'`,
                );
                continue;
              }
              const actualVal = normalizeComponentRefs(actualProps[propKey]);
              if (!propertyValuesMatch(actualVal, expectedVal)) {
                throw new Error(
                  `Property '${propKey}' mismatch on component '${expectedComp.id}': got ` +
                    `${JSON.stringify(actualVal)}, expected ${JSON.stringify(expectedVal)}`,
                );
              }
            }
          }
          if (
            Array.isArray(expectedSurface.components) &&
            expectedComponents.every(c => surface.componentsModel.get(c.id) !== undefined)
          ) {
            const actualCount = Array.from(surface.componentsModel.entries).length;
            if (actualCount !== expectedComponents.length) {
              throw new Error(
                `Surface '${surfaceId}' component count mismatch: expected ${expectedComponents.length}, got ${actualCount}`,
              );
            }
          }
        } finally {
          resolved.dispose();
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
      if (
        surface &&
        (expectedSurface.isValid !== undefined ||
          expectedSurface.validationErrors !== undefined ||
          expectedSurface.validationResults !== undefined ||
          expectedSurface.validationResult !== undefined)
      ) {
        const resolved = collectResolvedNodes(surface);
        try {
          let fallbackNode = resolved.nodes.get('root');
          if (!fallbackNode && resolved.nodes.size > 0) {
            fallbackNode = resolved.nodes.values().next().value;
          }
          const getPropsForId = id => {
            const n = resolved.nodes.get(id) ?? (id === 'root' ? fallbackNode : undefined);
            return n ? (peekValue(n.props) ?? {}) : {};
          };
          if (expectedSurface.isValid !== undefined) {
            if (typeof expectedSurface.isValid === 'boolean') {
              assert.strictEqual(getPropsForId('root').isValid, expectedSurface.isValid);
            } else {
              for (const [compId, expVal] of Object.entries(expectedSurface.isValid)) {
                assert.strictEqual(getPropsForId(compId).isValid, expVal);
              }
            }
          }
          if (expectedSurface.validationErrors !== undefined) {
            if (Array.isArray(expectedSurface.validationErrors)) {
              assert.deepStrictEqual(
                getPropsForId('root').validationErrors,
                expectedSurface.validationErrors,
              );
            } else {
              for (const [compId, expVal] of Object.entries(expectedSurface.validationErrors)) {
                assert.deepStrictEqual(getPropsForId(compId).validationErrors, expVal);
              }
            }
          }
          if (expectedSurface.validationResults !== undefined) {
            if (Array.isArray(expectedSurface.validationResults)) {
              assert.deepStrictEqual(
                getPropsForId('root').validationResults,
                expectedSurface.validationResults,
              );
            } else {
              for (const [compId, expVal] of Object.entries(expectedSurface.validationResults)) {
                assert.deepStrictEqual(getPropsForId(compId).validationResults, expVal);
              }
            }
          }
          if (expectedSurface.validationResult !== undefined) {
            const checkSingleResult = (compId, expRes) => {
              assertKnownKeys(
                expRes,
                SURFACE_EXPECT_KNOWN_KEYS.validationResult,
                `expect.surfaces.${surfaceId}.validationResult.${compId}`,
              );
              const firstResult = Array.isArray(getPropsForId(compId).validationResults)
                ? getPropsForId(compId).validationResults[0]
                : undefined;
              if (expRes.valid !== undefined) assert.strictEqual(firstResult?.valid, expRes.valid);
              if (expRes.message !== undefined) {
                assert.strictEqual(firstResult?.message, expRes.message);
              }
              if (expRes.code !== undefined) assert.strictEqual(firstResult?.code, expRes.code);
              if (expRes.severity !== undefined) {
                assert.strictEqual(firstResult?.severity, expRes.severity);
              }
            };
            if (
              'valid' in expectedSurface.validationResult ||
              'message' in expectedSurface.validationResult ||
              'code' in expectedSurface.validationResult
            ) {
              checkSingleResult('root', expectedSurface.validationResult);
            } else {
              for (const [compId, expRes] of Object.entries(expectedSurface.validationResult)) {
                checkSingleResult(compId, expRes);
              }
            }
          }
        } finally {
          resolved.dispose();
        }
      }
    }
  }
}

/**
 * The flags a case's `validationConfig` may set (`validationConfig` in
 * conformance_schema.json). An unknown flag fails the case rather than being
 * silently ignored.
 */
const CASE_VALIDATION_FLAGS = new Set([
  'allowOrphanComponents',
  'allowDanglingReferences',
  'allowMissingRoot',
  'allowUnknownElements',
]);

/**
 * The processor's validation config for a process_messages case. A case's
 * `validationConfig` sets its checks, so they don't depend on this harness: a
 * flag it leaves out is false. Without one, `strictMode` selects strict
 * validation and anything else none.
 */
function caseValidationConfig(testCase) {
  const flags = testCase.validationConfig;
  if (flags === undefined) {
    return testCase.strictMode ? {validationConfig: STRICT_VALIDATION} : {};
  }
  assertKnownKeys(flags, CASE_VALIDATION_FLAGS, 'process_messages.validationConfig');
  return {validationConfig: {...STRICT_VALIDATION, ...flags}};
}

const PROCESS_MESSAGES_KNOWN_KEYS = {
  case: new Set([
    'action',
    'catalog',
    'catalogPaths',
    'catalogs',
    'description',
    'expect',
    'expectError',
    'expect_error',
    'features',
    'messages',
    'name',
    'payload',
    'protocolVersion',
    'steps',
    'strictMode',
    'validationConfig',
  ]),
  step: new Set([
    'expect',
    'expectError',
    'expect_error',
    'message',
    'messages',
    'payload',
    'validationConfig',
  ]),
  expect: new Set(['surfaces']),
  validationConfig: CASE_VALIDATION_FLAGS,
};

function validateProcessMessagesTestCase(testCase) {
  assertKnownKeys(testCase, PROCESS_MESSAGES_KNOWN_KEYS.case, 'process_messages');
  assertKnownKeysList(testCase.steps, PROCESS_MESSAGES_KNOWN_KEYS.step, 'process_messages.steps');
  assertKnownKeys(testCase.expect, PROCESS_MESSAGES_KNOWN_KEYS.expect, 'process_messages.expect');
  const {messages, payload, steps, expect, expectError, protocolVersion} = testCase;

  const testCatalogs = getCatalogsForTestCase(testCase);
  let lastErrorMsg;
  const processorOptions = {
    ...(protocolVersion ? {version: protocolVersion} : {}),
    ...caseValidationConfig(testCase),
    errorHandler: msg => {
      lastErrorMsg = msg;
    },
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
      let stepMsgs =
        step.messages ||
        (Array.isArray(step.payload) ? step.payload : step.payload ? [step.payload] : []);
      if (!stepMsgs && step.message) stepMsgs = [step.message];
      stepMsgs = normalizeMsgs(stepMsgs);

      // A step's validationConfig applies to that call only.
      assertKnownKeys(
        step.validationConfig,
        PROCESS_MESSAGES_KNOWN_KEYS.validationConfig,
        `process_messages.steps[${i}].validationConfig`,
      );
      const context = step.validationConfig ? {validationConfig: step.validationConfig} : undefined;
      const stepExpectError =
        step.expectError || (i === steps.length - 1 ? expectError : undefined);
      if (stepExpectError) {
        lastErrorMsg = undefined;
        let thrown;
        try {
          processor.processMessages(stepMsgs, context);
        } catch (err) {
          thrown = err;
        }
        if (!thrown) {
          throw new Error(
            `Expected error (${stepExpectError.category || stepExpectError.code || stepExpectError.message || 'UNKNOWN'}) but message processing succeeded.`,
          );
        }
        assertExpectedConformanceError(thrown, lastErrorMsg, stepExpectError);
      } else {
        processor.processMessages(stepMsgs, context);
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
    lastErrorMsg = undefined;
    let thrown;
    try {
      processor.processMessages(inputMessages);
    } catch (err) {
      thrown = err;
    }
    if (!thrown) {
      throw new Error(
        `Expected error (${expectError.category || expectError.code || expectError.message || 'UNKNOWN'}) but message processing succeeded.`,
      );
    }
    assertExpectedConformanceError(thrown, lastErrorMsg, expectError);
    return;
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

const PARSE_EXPRESSION_TEMPLATE_KNOWN_KEYS = {
  case: new Set([
    'action',
    'description',
    'expect',
    'expectError',
    'expect_error',
    'features',
    'input',
    'name',
    'protocolVersion',
  ]),
};

function validateParseExpressionTemplateTestCase(testCase) {
  assertKnownKeys(testCase, PARSE_EXPRESSION_TEMPLATE_KNOWN_KEYS.case, 'parse_expression_template');
  const {input, expect, expectError, expect_error} = testCase;
  const errorSpec = expect_error || expectError;
  assertKnownKeys(
    errorSpec,
    EXPECT_ERROR_KNOWN_KEYS.error,
    'parse_expression_template.expectError',
  );
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

function getBasicCatalog(version) {
  const v = toCanonicalVersion(version) || version;
  if (v === '1.0') return v1_0BasicCatalog;
  if (v === '0.8') return v0_8BasicCatalog;
  return v0_9BasicCatalog;
}

const DISPATCH_ACTION_KNOWN_KEYS = {
  case: new Set([
    'action',
    'actionPayload',
    'catalog',
    'catalogPaths',
    'catalogs',
    'dataModel',
    'description',
    'expectDataModel',
    'expectDispatched',
    'expectError',
    'expect_error',
    'features',
    'metadata',
    'name',
    'protocolVersion',
    'scope',
    'sourceComponentId',
    'surfaceId',
    'useBasicCatalog',
    'userActivation',
  ]),
  actionPayload: new Set(['context', 'event', 'functionCall', 'name']),
  expectDispatched: new Set([
    'context',
    'metadata',
    'name',
    'sourceComponentId',
    'surfaceId',
    'timestampIso8601',
    'userMessage',
  ]),
};

async function validateDispatchActionTestCase(testCase) {
  assertKnownKeys(testCase, DISPATCH_ACTION_KNOWN_KEYS.case, 'dispatch_action');
  assertKnownKeys(
    testCase.actionPayload,
    DISPATCH_ACTION_KNOWN_KEYS.actionPayload,
    'dispatch_action.actionPayload',
  );
  assertKnownKeys(
    testCase.expectDispatched,
    DISPATCH_ACTION_KNOWN_KEYS.expectDispatched,
    'dispatch_action.expectDispatched',
  );
  const {
    actionPayload,
    metadata,
    dataModel = {},
    surfaceId = 'main',
    sourceComponentId = 'root',
    scope,
    userActivation,
    expectDispatched,
    expectDataModel,
    expectError,
    expect_error,
  } = testCase;
  const errorSpec = expect_error || expectError;
  assertKnownKeys(errorSpec, EXPECT_ERROR_KNOWN_KEYS.error, 'dispatch_action.expectError');

  const testCatalogs = getCatalogsForTestCase(testCase);
  const baseCat = testCatalogs[0] || getBasicCatalog(resolveProtocolVersion(testCase) || 'v0.9');
  const actionFunctions = [
    ...Array.from(baseCat.functions.values()),
    createFunctionImplementation(
      {
        name: 'incrementCounter',
        returnType: 'void',
        schema: z.object({
          path: z.string().optional(),
          step: z.number().optional(),
        }),
      },
      (args, context) => {
        const targetPath = args.path || '/counter';
        const step = args.step ?? 1;
        const cur = Number(context.dataModel.get(targetPath) ?? 0);
        context.dataModel.set(targetPath, cur + step);
      },
    ),
    createFunctionImplementation(
      {
        name: 'failingAction',
        returnType: 'void',
        schema: z.object({}),
      },
      () => {
        throw new Error('Action function failed');
      },
    ),
  ];
  const defaultCat = new Catalog(
    baseCat.id,
    baseCat.protocolVersion || '0.9',
    Array.from(baseCat.components.values()),
    actionFunctions,
    baseCat.themeSchema,
    baseCat.instructions,
  );
  const model = new DataModel(dataModel);
  const surface = new SurfaceModel(surfaceId, defaultCat, undefined, undefined, false, model);

  const dispatched = [];
  surface.onAction.subscribe(evt => dispatched.push(evt));
  const surfaceErrors = [];
  surface.onError.subscribe(err => surfaceErrors.push(err));

  const ctx = new DataContext(surface, scope || '/');
  const prevWindow = globalThis.window;
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {open: () => null};
  }

  try {
    if (errorSpec) {
      let thrown;
      try {
        const resolved = ctx.resolveAction(actionPayload, {userActivation});
        if (
          resolved &&
          typeof resolved === 'object' &&
          ('event' in resolved || 'name' in resolved)
        ) {
          await surface.dispatchAction(resolved, sourceComponentId, metadata);
        }
      } catch (err) {
        thrown = err;
      }
      if (!thrown && surfaceErrors.length > 0) {
        const first = surfaceErrors[0];
        thrown = new A2uiValidationError(first.message, first.details, first.code);
      }
      if (!thrown) {
        throw new Error('Expected action dispatch error, but none was thrown or reported');
      }
      if (errorSpec.code && surfaceErrors.length > 0) {
        assert.strictEqual(surfaceErrors[0].code, errorSpec.code);
      } else if (errorSpec.code && thrown.code) {
        assert.strictEqual(thrown.code, errorSpec.code);
      }
      if (errorSpec.message) {
        const actualMsg = surfaceErrors[0]?.message || thrown.message || '';
        assert.ok(
          actualMsg.toLowerCase().includes(errorSpec.message.toLowerCase()),
          `Expected error message containing '${errorSpec.message}', got '${actualMsg}'`,
        );
      }
      return;
    }

    const resolved = ctx.resolveAction(actionPayload, {userActivation});
    if (resolved && typeof resolved === 'object' && ('event' in resolved || 'name' in resolved)) {
      await surface.dispatchAction(resolved, sourceComponentId, metadata);
    }

    if (expectDispatched === null) {
      assert.strictEqual(dispatched.length, 0, 'Expected no action to be dispatched');
    } else if (expectDispatched !== undefined) {
      assert.ok(dispatched.length >= 1, 'Expected action to be dispatched, but none was');
      const actual = dispatched[0];
      if ('name' in expectDispatched) {
        assert.strictEqual(actual.name, expectDispatched.name);
      }
      if ('context' in expectDispatched) {
        assert.deepStrictEqual(actual.context, expectDispatched.context);
      }
      if ('userMessage' in expectDispatched) {
        assert.strictEqual(actual.userMessage, expectDispatched.userMessage);
      }
      if ('metadata' in expectDispatched) {
        assert.deepStrictEqual(actual.metadata ?? null, expectDispatched.metadata);
      }
      if ('surfaceId' in expectDispatched) {
        assert.strictEqual(actual.surfaceId, expectDispatched.surfaceId);
      }
      if ('sourceComponentId' in expectDispatched) {
        assert.strictEqual(actual.sourceComponentId, expectDispatched.sourceComponentId);
      }
      if ('timestampIso8601' in expectDispatched) {
        assert.strictEqual(typeof actual.timestamp, 'string');
        assert.ok(!Number.isNaN(Date.parse(actual.timestamp)));
      }
    }

    if (expectDataModel !== undefined) {
      assert.deepStrictEqual(model.get('/'), expectDataModel);
    }
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
}

/**
 * Evaluates an `evaluate_function` case that carries a `surface` block.
 *
 * The surface is created by a `createSurface` message, so the processor
 * decides which catalogs it makes available, and the function is evaluated as
 * a call on it. The call therefore goes through catalog resolution: from v1.0
 * it runs in the catalog its own `catalogId` names, else in the surface
 * default, else it fails.
 *
 * The data context reports a failing call on the surface instead of throwing,
 * so the first reported error is rethrown, as an `A2uiCatalogError` for a
 * `CATALOG_ERROR` and an `A2uiExpressionError` otherwise.
 *
 * @param testCase Conformance case with `surface`, `protocolVersion` and
 *   `catalogPaths`, and optionally a call-level `catalogId`.
 * @returns The resolved value.
 * @throws The first error the surface reported while evaluating the call.
 */
function evaluateFunctionOnSurface(testCase) {
  const {surface: surfaceSpec, catalogId, function: funcName, args = {}, dataModel} = testCase;
  const version = resolveProtocolVersion(testCase);
  const processor = new MessageProcessor(getCatalogsForTestCase(testCase), undefined, {version});
  const createSurface = {surfaceId: 'main'};
  if (surfaceSpec.catalogId !== undefined) createSurface.catalogId = surfaceSpec.catalogId;
  processor.processMessages([{version, createSurface}]);
  const surface = processor.getSurface('main');
  if (dataModel !== undefined) surface.dataModel.set('/', dataModel);

  const callKey = toCanonicalVersion(version) === '1.0' ? '@call' : 'call';
  const call = {[callKey]: funcName, args};
  if (catalogId !== undefined) call.catalogId = catalogId;

  const reported = [];
  const subscription = surface.onError.subscribe(err => reported.push(err));
  let result;
  try {
    result = new DataContext(surface, '/').resolveDynamicValue(call);
    result = isSignal(result) ? getValue(result) : result;
  } finally {
    subscription.unsubscribe();
  }
  if (reported.length > 0) {
    const {code, message} = reported[0];
    throw code === 'CATALOG_ERROR'
      ? new A2uiCatalogError(message)
      : new A2uiExpressionError(message, funcName);
  }
  return result;
}

/**
 * Asserts that an error matches an `evaluate_function` case's `expectError`.
 *
 * @param err Thrown error.
 * @param errorSpec Expected `category` and `message`, both optional.
 * @returns `true` when the error matches, for use with `assert.throws`.
 */
function matchesEvaluateFunctionError(err, errorSpec) {
  if (!matchesErrorCategory(err, errorSpec.category)) {
    throw new Error(
      `Expected error category '${errorSpec.category}', got '${err.constructor?.name || err.name}': ${err.message}`,
    );
  }
  if (errorSpec.message && !err.message.includes(errorSpec.message)) {
    throw new Error(
      `Expected error message containing '${errorSpec.message}', got '${err.message}'`,
    );
  }
  return true;
}

const EVALUATE_FUNCTION_KNOWN_KEYS = {
  case: new Set([
    'action',
    'args',
    'catalog',
    'catalogId',
    'catalogPaths',
    'catalogs',
    'dataModel',
    'description',
    'expect',
    'expectError',
    'expect_error',
    'features',
    'function',
    'name',
    'protocolVersion',
    'surface',
    'useBasicCatalog',
  ]),
  surface: new Set(['catalogId']),
};

function validateEvaluateFunctionTestCase(testCase) {
  assertKnownKeys(testCase, EVALUATE_FUNCTION_KNOWN_KEYS.case, 'evaluate_function');
  assertKnownKeys(
    testCase.surface,
    EVALUATE_FUNCTION_KNOWN_KEYS.surface,
    'evaluate_function.surface',
  );
  const {
    function: funcName,
    args = {},
    dataModel = {},
    expect,
    expectError,
    expect_error,
  } = testCase;
  const errorSpec = expect_error || expectError;
  assertKnownKeys(errorSpec, EXPECT_ERROR_KNOWN_KEYS.error, 'evaluate_function.expectError');

  if (testCase.surface) {
    const evaluate = () => evaluateFunctionOnSurface(testCase);
    if (errorSpec) {
      assert.throws(evaluate, err => matchesEvaluateFunctionError(err, errorSpec));
      return;
    }
    const result = evaluate();
    const actualJson = result === undefined ? null : JSON.parse(JSON.stringify(result));
    assert.deepStrictEqual(actualJson, expect);
    return;
  }

  const hasExplicitCatalogs = Boolean(
    testCase.catalog || testCase.catalogs || testCase.catalogPaths,
  );
  const ver = resolveProtocolVersion(testCase) || 'v0.9';
  const defaultCat = hasExplicitCatalogs
    ? getCatalogsForTestCase(testCase)[0]
    : getBasicCatalog(ver);
  const model = new DataModel(dataModel);
  const surface = new SurfaceModel('main', defaultCat, undefined, undefined, false, model);
  const ctx = new DataContext(surface, '/');

  const originalWindow = globalThis.window;
  if (funcName === 'openUrl' && typeof globalThis.window === 'undefined') {
    globalThis.window = {
      location: {href: 'https://example.com/'},
      open: () => {},
    };
  }

  try {
    const fn = defaultCat?.functions?.get(funcName);
    if (errorSpec) {
      assert.throws(() => {
        let r;
        if (fn && typeof fn.execute === 'function') {
          r = fn.execute(args, ctx);
        } else if (defaultCat && defaultCat.invoker) {
          r = defaultCat.invoker(funcName, args, ctx);
        } else {
          r = ctx.resolveDynamicValue({call: funcName, args});
        }
        if (isSignal(r)) {
          getValue(r);
        }
      });
      return;
    }

    let result;
    if (fn && typeof fn.execute === 'function') {
      result = fn.execute(args, ctx);
    } else if (defaultCat && defaultCat.invoker) {
      result = defaultCat.invoker(funcName, args, ctx);
    } else {
      result = ctx.resolveDynamicValue({call: funcName, args});
    }
    result = isSignal(result) ? getValue(result) : result;

    const actualJson = result === undefined ? null : JSON.parse(JSON.stringify(result));
    if (expect !== undefined) {
      assert.deepStrictEqual(actualJson, expect);
    }
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
}

await runConformanceHarness();
