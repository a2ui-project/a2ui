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

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, afterEach, before, describe, it} from 'node:test';

import {setupTestDom, teardownTestDom} from './dom-setup.js';

import * as yaml from 'js-yaml';

import {A2uiError, Catalog, getValue, ResolvedBinding, type ComponentNode} from '@a2ui/web_core';
import {basicCatalog as v09BasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiClientMessageSchema} from '@a2ui/web_core/v0_9';
import {RendererToAgentMessageSchema} from '@a2ui/web_core/v1_0';

import type {A2uiSurface} from '../surface/a2ui-surface.js';
import type {LitComponentApi} from '../types.js';
import {
  assertKnownKeys,
  assertViewTree,
  extractViewTree,
  findUnsupportedReason,
  KNOWN_KEYS,
  mountSurface,
  runStep,
  settleSurface,
  writeManifestRecord,
  type AdapterSession,
  type AdapterStep,
  type ExpectedError,
  type ExpectedViewNode,
  type ManifestRecord,
  type SecondaryCatalogSpec,
} from './adapter_harness.js';

const CONFORMANCE_ROOT = path.resolve(import.meta.dirname, '../../../../../../conformance');
const REPO_ROOT = path.resolve(CONFORMANCE_ROOT, '..');

const E2E_SCENARIO_KNOWN_KEYS = new Set([
  'name',
  'description',
  'features',
  'action',
  'protocolVersion',
  'catalogPaths',
  'formats',
  'source',
  'turns',
]);

const E2E_SOURCE_KNOWN_KEYS = new Set(['kind', 'from', 'model', 'recordedAt']);

const E2E_TURN_KNOWN_KEYS = new Set([
  'userText',
  'modelChunks',
  'expectWire',
  'expectViewTree',
  'expectErrors',
  'uiOps',
  'expectDataModel',
  'expectOutbound',
]);

const E2E_UI_OP_KNOWN_KEYS = new Set([
  'op',
  'surfaceId',
  'targetNode',
  'inputValue',
  'userActivation',
]);

const E2E_VIEW_NODE_KNOWN_KEYS = new Set([...KNOWN_KEYS.viewNode, 'label', 'disabled']);

export interface E2eUiOp {
  op: AdapterStep['op'];
  surfaceId: string;
  targetNode?: string;
  inputValue?: unknown;
  userActivation?: boolean;
}

export interface E2eWirePart {
  text?: string;
  a2ui?: Array<Record<string, unknown>>;
}

export interface E2eTurn {
  userText: string;
  modelChunks?: Record<string, string[]>;
  expectWire: E2eWirePart[];
  expectViewTree?: Record<string, ExpectedViewNode | null>;
  expectErrors?: ExpectedError[];
  uiOps?: E2eUiOp[];
  expectDataModel?: Record<string, Record<string, unknown>>;
  expectOutbound?: Array<Record<string, unknown>>;
}

export interface E2eScenario {
  name: string;
  description?: string;
  features?: string[];
  action: string;
  protocolVersion: string;
  catalogPaths: string[];
  formats?: string[];
  source?: Record<string, unknown>;
  turns: E2eTurn[];
}

interface E2eSuiteFile {
  suiteRelPath: string;
  filePath: string;
  scenarios: E2eScenario[];
}

function findE2eSuiteFiles(): E2eSuiteFile[] {
  const e2eRoot = path.join(CONFORMANCE_ROOT, 'e2e');
  if (!fs.existsSync(e2eRoot)) {
    return [];
  }
  const files: Array<{suiteRelPath: string; filePath: string}> = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        const rel = path.relative(CONFORMANCE_ROOT, fullPath).split(path.sep).join('/');
        files.push({suiteRelPath: rel, filePath: fullPath});
      }
    }
  };
  walk(e2eRoot);
  files.sort((a, b) => a.suiteRelPath.localeCompare(b.suiteRelPath));
  return files.map(({suiteRelPath, filePath}) => {
    const raw = yaml.load(fs.readFileSync(filePath, 'utf8'));
    const scenarios = (Array.isArray(raw) ? raw : [raw]) as E2eScenario[];
    return {suiteRelPath, filePath, scenarios};
  });
}

function assertKnownE2eViewNode(node: Record<string, unknown>, where: string): void {
  assertKnownKeys(node, E2E_VIEW_NODE_KNOWN_KEYS, where);
  if (Array.isArray(node.validationResults)) {
    node.validationResults.forEach((entry, idx) => {
      assertKnownKeys(
        entry as Record<string, unknown>,
        KNOWN_KEYS.validationResult,
        `${where}.validationResults[${idx}]`,
      );
    });
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child, idx) => {
      assertKnownE2eViewNode(child as Record<string, unknown>, `${where}.children[${idx}]`);
    });
  }
}

function assertKnownE2eScenario(scenario: E2eScenario): void {
  const rec = scenario as unknown as Record<string, unknown>;
  assertKnownKeys(rec, E2E_SCENARIO_KNOWN_KEYS, `scenario(${scenario.name})`);
  assert.equal(
    scenario.action,
    'e2e_scenario',
    `Unsupported action in scenario(${scenario.name}): ${scenario.action}`,
  );
  if (scenario.source) {
    assertKnownKeys(scenario.source, E2E_SOURCE_KNOWN_KEYS, `scenario(${scenario.name}).source`);
  }
  assert.ok(Array.isArray(scenario.turns) && scenario.turns.length > 0, 'Expected non-empty turns');
  scenario.turns.forEach((turn, i) => {
    assertKnownKeys(
      turn as unknown as Record<string, unknown>,
      E2E_TURN_KNOWN_KEYS,
      `scenario(${scenario.name}).turns[${i}]`,
    );
    if (turn.expectViewTree) {
      for (const [surfaceId, tree] of Object.entries(turn.expectViewTree)) {
        if (tree !== null) {
          assertKnownE2eViewNode(
            tree as unknown as Record<string, unknown>,
            `scenario(${scenario.name}).turns[${i}].expectViewTree.${surfaceId}`,
          );
        }
      }
    }
    if (turn.uiOps) {
      turn.uiOps.forEach((uiOp, j) => {
        assertKnownKeys(
          uiOp as unknown as Record<string, unknown>,
          E2E_UI_OP_KNOWN_KEYS,
          `scenario(${scenario.name}).turns[${i}].uiOps[${j}]`,
        );
      });
    }
  });
}

function unwrapProp(val: unknown): unknown {
  return val instanceof ResolvedBinding ? val.value : val;
}

function getDirectChildren(
  node: ComponentNode<LitComponentApi>,
): Array<ComponentNode<LitComponentApi>> {
  const props = getValue(node.props);
  const children: Array<ComponentNode<LitComponentApi>> = [];
  if (props.child && typeof props.child === 'object' && 'componentId' in props.child) {
    children.push(props.child as ComponentNode<LitComponentApi>);
  }
  if (Array.isArray(props.children)) {
    for (const item of props.children) {
      if (item && typeof item === 'object' && 'componentId' in item) {
        children.push(item as ComponentNode<LitComponentApi>);
      }
    }
  }
  return children;
}

function assertExtendedViewNodeProps(
  actual: ComponentNode<LitComponentApi>,
  expected: ExpectedViewNode,
): void {
  const expRec = expected as unknown as Record<string, unknown>;
  const props = getValue(actual.props);
  for (const key of ['label', 'disabled'] as const) {
    if (expRec[key] !== undefined) {
      assert.deepEqual(unwrapProp(props[key]), expRec[key]);
    }
  }
  if (expected.children !== undefined) {
    const actualChildren = getDirectChildren(actual);
    for (let i = 0; i < expected.children.length; i++) {
      assertExtendedViewNodeProps(actualChildren[i], expected.children[i]);
    }
  }
}

export function captureOutbound(session: AdapterSession): Array<Record<string, unknown>> {
  return session.recordedOutbound.map(item => structuredClone(item));
}

function isMatchAny(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length === 1 && (value as Record<string, unknown>)['$match'] === 'any';
}

function assertMatchesOutbound(actual: unknown, expected: unknown, where: string): void {
  if (isMatchAny(expected)) {
    assert.ok(actual !== undefined && actual !== null, `${where}: expected defined non-null`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected array`);
    assert.equal(actual.length, expected.length, `${where}: array length`);
    for (let i = 0; i < expected.length; i++) {
      assertMatchesOutbound(actual[i], expected[i], `${where}[${i}]`);
    }
    return;
  }
  if (typeof expected === 'object' && expected !== null) {
    assert.ok(
      typeof actual === 'object' && actual !== null && !Array.isArray(actual),
      `${where}: expected object`,
    );
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord).sort();
    const expectedKeys = Object.keys(expectedRecord).sort();
    assert.deepEqual(actualKeys, expectedKeys, `${where}: object keys`);
    for (const key of expectedKeys) {
      assertMatchesOutbound(actualRecord[key], expectedRecord[key], `${where}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, `${where}: value`);
}

export function assertOutbound(
  actual: Array<Record<string, unknown>>,
  expected: Array<Record<string, unknown>>,
  protocolVersion: string,
): void {
  const isV09 = protocolVersion.startsWith('v0.9') || protocolVersion.startsWith('0.9');
  for (let i = 0; i < actual.length; i++) {
    const parsed = isV09
      ? A2uiClientMessageSchema.safeParse(actual[i])
      : RendererToAgentMessageSchema.safeParse(actual[i]);
    assert.ok(
      parsed.success,
      `outbound[${i}] failed protocol schema validation: ${
        parsed.success ? '' : JSON.stringify(parsed.error.issues)
      }`,
    );
  }
  assert.equal(actual.length, expected.length, 'expectOutbound length');
  for (let i = 0; i < expected.length; i++) {
    assertMatchesOutbound(actual[i], expected[i], `expectOutbound[${i}]`);
  }
}

function loadExtraCatalogs(catalogPaths: string[]): SecondaryCatalogSpec[] {
  const specs: SecondaryCatalogSpec[] = [];
  for (const relPath of catalogPaths) {
    if (
      relPath === 'catalogs/basic/v1/catalog.json' ||
      relPath === 'specification/v0_9_1/catalogs/basic/catalog.json' ||
      relPath === 'specification/v0_9/json/standard_catalog_definition.json'
    ) {
      continue;
    }
    const fullPath = path.join(REPO_ROOT, relPath);
    if (fs.existsSync(fullPath)) {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
      const catalogId = (raw.catalogId ?? raw.$id) as string | undefined;
      if (catalogId && typeof raw.components === 'object' && raw.components !== null) {
        specs.push({
          catalogId,
          protocolVersion: raw.protocolVersion as string | undefined,
          components: raw.components as SecondaryCatalogSpec['components'],
        });
      }
    }
  }
  return specs;
}

function registerV09BasicCatalog(session: AdapterSession): void {
  const base = v09BasicCatalog as unknown as Catalog<LitComponentApi>;
  const v09Cat = new Catalog<LitComponentApi>(
    base.id,
    base.protocolVersion ?? 'v0.9',
    Array.from(base.components.values()),
    Array.from(base.functions?.values() ?? []),
    base.themeSchema,
    base.instructions,
  );
  const internal = session.processor as unknown as {
    registeredCatalogs: Array<Catalog<LitComponentApi>>;
  };
  internal.registeredCatalogs.unshift(v09Cat);
}

function attachGroupErrorForwarding(session: AdapterSession): void {
  const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
  session.mountedElements.push(el);
  document.body.appendChild(el);
  session.surfaceEl = el;

  session.processor.model.onSurfaceCreated.subscribe(surface => {
    session.surface = surface;
  });
  session.processor.model.onAction.subscribe(action => {
    session.recordedActions.push({
      name: action.name,
      surfaceId: action.surfaceId,
      sourceComponentId: action.sourceComponentId,
      context: action.context,
    });
    const isV09 =
      session.protocolVersion.startsWith('v0.9') || session.protocolVersion.startsWith('0.9');
    session.recordedOutbound.push({
      version: isV09 ? 'v0.9' : session.protocolVersion,
      action: {
        name: action.name,
        surfaceId: action.surfaceId,
        sourceComponentId: action.sourceComponentId,
        timestamp: action.timestamp,
        context: action.context,
      },
    });
  });
  session.processor.model.onError.subscribe(err => {
    const errRecord = err as unknown as Record<string, unknown>;
    const surfaceId =
      typeof errRecord.surfaceId === 'string' ? errRecord.surfaceId : (session.surface?.id ?? '');
    session.recordedErrors.push({
      code: String(errRecord.code ?? ''),
      message: String(errRecord.message ?? ''),
      surfaceId,
    });
    if (session.currentOp !== 'programmatic_invoke') {
      const isV09 =
        session.protocolVersion.startsWith('v0.9') || session.protocolVersion.startsWith('0.9');
      session.recordedOutbound.push({
        version: isV09 ? 'v0.9' : session.protocolVersion,
        error: {
          code: errRecord.code,
          surfaceId,
          message: errRecord.message,
        },
      });
    }
  });
}

async function selectSurface(session: AdapterSession, surfaceId: string): Promise<void> {
  const target = session.processor.model.getSurface(surfaceId);
  assert.ok(target, `Expected surface "${surfaceId}" to exist`);
  if (session.surface !== target || session.surfaceEl?.surface !== target) {
    session.surface = target;
    if (!session.surfaceEl) {
      const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
      session.mountedElements.push(el);
      document.body.appendChild(el);
      session.surfaceEl = el;
    }
    session.surfaceEl.surface = target;
    await settleSurface(session.surfaceEl);
  }
}

export async function runScenario(
  scenario: E2eScenario,
  mountedElements: HTMLElement[],
): Promise<void> {
  const protocolVersion = scenario.protocolVersion === 'v0.9.1' ? 'v0.9' : scenario.protocolVersion;
  const session = mountSurface(
    {
      protocolVersion,
      catalogs: loadExtraCatalogs(scenario.catalogPaths ?? []),
    },
    mountedElements,
  );
  if (protocolVersion.startsWith('v0.9') || protocolVersion.startsWith('0.9')) {
    registerV09BasicCatalog(session);
  }
  attachGroupErrorForwarding(session);

  for (const turn of scenario.turns) {
    const turnOutbound: Array<Record<string, unknown>> = [];
    const turnErrors: ExpectedError[] = [];

    for (const part of turn.expectWire) {
      if (part.a2ui) {
        try {
          await runStep(session, {
            op: 'process_messages',
            messages: part.a2ui as unknown as AdapterStep['messages'],
          });
        } catch (err) {
          if (!(err instanceof A2uiError)) {
            throw err;
          }
        }
        turnOutbound.push(...captureOutbound(session));
        turnErrors.push(...session.recordedErrors);
      }
    }

    if (turn.expectViewTree) {
      for (const [surfaceId, expectedTree] of Object.entries(turn.expectViewTree)) {
        if (expectedTree === null) {
          assert.equal(session.processor.model.getSurface(surfaceId), undefined);
        } else {
          await selectSurface(session, surfaceId);
          const actualRoot = extractViewTree(session);
          assertViewTree(actualRoot, expectedTree, session.surfaceEl);
          assertExtendedViewNodeProps(actualRoot!, expectedTree);
        }
      }
    }

    if (turn.uiOps) {
      for (const uiOp of turn.uiOps) {
        await selectSurface(session, uiOp.surfaceId);
        const step: AdapterStep = {
          op: uiOp.op,
          targetNode: uiOp.targetNode,
          inputValue: uiOp.inputValue,
          userActivation: uiOp.userActivation,
        };
        await runStep(session, step);
        turnOutbound.push(...captureOutbound(session));
        turnErrors.push(...session.recordedErrors);
      }
    }

    if (turn.expectDataModel) {
      for (const [surfaceId, expectedData] of Object.entries(turn.expectDataModel)) {
        const surface = session.processor.model.getSurface(surfaceId);
        assert.ok(surface, `Expected surface "${surfaceId}" for expectDataModel`);
        assert.deepEqual(surface.dataModel.get('/'), expectedData);
      }
    }

    if (turn.expectErrors) {
      assert.equal(turnErrors.length, turn.expectErrors.length);
      turn.expectErrors.forEach((exp, idx) => {
        const act = turnErrors[idx];
        if (exp.code !== undefined) {
          assert.equal(act.code, exp.code);
        }
        if (exp.surfaceId !== undefined) {
          assert.equal(act.surfaceId, exp.surfaceId);
        }
        if (exp.message !== undefined) {
          assert.ok(String(act.message ?? '').includes(exp.message));
        }
      });
    }

    if (turn.expectOutbound !== undefined) {
      assertOutbound(turnOutbound, turn.expectOutbound, protocolVersion);
    }
  }
}

describe('@a2ui/lit E2E Scenario Conformance', () => {
  const suiteFiles = findE2eSuiteFiles();
  const mountedElements: HTMLElement[] = [];
  let pendingManifest: ManifestRecord | undefined;

  before(async () => {
    assert.ok(suiteFiles.length > 0, 'Expected E2E scenario YAML files under conformance/e2e');
    setupTestDom();
    await import('../surface/a2ui-surface.js');
  });

  afterEach(() => {
    while (mountedElements.length > 0) {
      mountedElements.pop()?.remove();
    }
    if (pendingManifest) {
      writeManifestRecord(pendingManifest);
      pendingManifest = undefined;
    }
  });

  after(() => {
    teardownTestDom();
  });

  for (const {suiteRelPath, scenarios} of suiteFiles) {
    describe(`E2E Scenarios (${suiteRelPath})`, () => {
      for (const scenario of scenarios) {
        it(`${scenario.name}: ${scenario.description ?? ''}`, async t => {
          pendingManifest = {
            harness: 'lit',
            suite: suiteRelPath,
            case: scenario.name,
            status: 'failed',
          };
          try {
            assertKnownE2eScenario(scenario);
            const skipReason = findUnsupportedReason(scenario.name);
            if (skipReason) {
              pendingManifest.status = 'skipped';
              pendingManifest.reason = skipReason;
              t.skip(skipReason);
              return;
            }
            await runScenario(scenario, mountedElements);
            pendingManifest.status = 'passed';
          } catch (err) {
            pendingManifest.status = 'failed';
            pendingManifest.reason = err instanceof Error ? err.message : String(err);
            throw err;
          }
        });
      }
    });
  }
});
