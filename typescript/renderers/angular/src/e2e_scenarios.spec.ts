/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {TestBed} from '@angular/core/testing';
import {A2uiClientMessageSchema, A2uiError} from '@a2ui/web_core/v0_9';
import {RendererToAgentMessageSchema} from '@a2ui/web_core/v1_0';

import {
  assertKnownKeys,
  assertViewTree,
  extractViewTree,
  findUnsupportedReason,
  getConformanceSuites,
  KNOWN_KEYS,
  mountSurface,
  runStep,
  settleSurfaceDom,
  writeManifestRecord,
  type AdapterStep,
  type ExpectedErrorEntry,
  type ExpectedViewNode,
  type HarnessState,
  type ManifestRecord,
} from './adapter_harness';
import {type AngularCatalog, SurfaceComponent} from './public-api';
import {BasicCatalogBase as V09BasicCatalogBase} from './v0_9';

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
  expectErrors?: ExpectedErrorEntry[];
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

interface E2eSuiteItem {
  suite: string;
  scenario: E2eScenario;
}

function getE2eScenarios(): E2eSuiteItem[] {
  const suites = getConformanceSuites() as unknown as {e2eScenarios?: E2eSuiteItem[]};
  return suites.e2eScenarios ?? [];
}

function assertKnownE2eViewNode(node: Record<string, unknown>, where: string): void {
  assertKnownKeys(node, E2E_VIEW_NODE_KNOWN_KEYS, where);
  if (Array.isArray(node['validationResults'])) {
    node['validationResults'].forEach((entry, idx) => {
      assertKnownKeys(
        entry as Record<string, unknown>,
        KNOWN_KEYS.validationResult,
        `${where}.validationResults[${idx}]`,
      );
    });
  }
  if (Array.isArray(node['children'])) {
    node['children'].forEach((child, idx) => {
      assertKnownE2eViewNode(child as Record<string, unknown>, `${where}.children[${idx}]`);
    });
  }
}

function assertKnownE2eScenario(scenario: E2eScenario): void {
  const rec = scenario as unknown as Record<string, unknown>;
  assertKnownKeys(rec, E2E_SCENARIO_KNOWN_KEYS, `scenario(${scenario.name})`);
  expect(scenario.action)
    .withContext(`Unsupported action in scenario(${scenario.name}): ${scenario.action}`)
    .toBe('e2e_scenario');
  if (scenario.source) {
    assertKnownKeys(scenario.source, E2E_SOURCE_KNOWN_KEYS, `scenario(${scenario.name}).source`);
  }
  expect(Array.isArray(scenario.turns) && scenario.turns.length > 0).toBe(true);
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

export function captureOutbound(state: HarnessState): Array<Record<string, unknown>> {
  return state.outbound.map(item => structuredClone(item));
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
    expect(actual !== undefined && actual !== null)
      .withContext(`${where}: expected defined non-null`)
      .toBe(true);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).withContext(`${where}: expected array`).toBe(true);
    expect((actual as unknown[]).length)
      .withContext(`${where}: array length`)
      .toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      assertMatchesOutbound((actual as unknown[])[i], expected[i], `${where}[${i}]`);
    }
    return;
  }
  if (typeof expected === 'object' && expected !== null) {
    expect(typeof actual === 'object' && actual !== null && !Array.isArray(actual))
      .withContext(`${where}: expected object`)
      .toBe(true);
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord).sort();
    const expectedKeys = Object.keys(expectedRecord).sort();
    expect(actualKeys).withContext(`${where}: object keys`).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      assertMatchesOutbound(actualRecord[key], expectedRecord[key], `${where}.${key}`);
    }
    return;
  }
  expect(actual).withContext(`${where}: value`).toBe(expected);
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
    expect(parsed.success)
      .withContext(
        `outbound[${i}] failed protocol schema validation: ${
          parsed.success ? '' : JSON.stringify(parsed.error.issues)
        }`,
      )
      .toBe(true);
  }
  expect(actual.length).withContext('expectOutbound length').toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    assertMatchesOutbound(actual[i], expected[i], `expectOutbound[${i}]`);
  }
}

function registerV09BasicCatalog(state: HarnessState): void {
  const v09Cat = new V09BasicCatalogBase();
  const internal = state.rendererService as unknown as {
    _catalogs: AngularCatalog[];
  };
  internal._catalogs.unshift(v09Cat);
}

function attachGroupErrorForwarding(state: HarnessState): void {
  state.rendererService.surfaceGroup.onError.subscribe(err => {
    const errRecord = err as unknown as Record<string, unknown>;
    const surfaceId = typeof errRecord['surfaceId'] === 'string' ? errRecord['surfaceId'] : '';
    state.errors.push({
      code: errRecord['code'],
      message: errRecord['message'],
      surfaceId,
    });
    if (state.currentOp !== 'programmatic_invoke') {
      state.outbound.push({
        version: state.protocolVersion,
        error: {
          code: errRecord['code'],
          surfaceId,
          message: errRecord['message'],
        },
      });
    }
  });
}

async function selectSurface(state: HarnessState, surfaceId: string): Promise<void> {
  const target = state.rendererService.surfaceGroup.getSurface(surfaceId);
  expect(target).withContext(`Expected surface "${surfaceId}" to exist`).toBeDefined();
  if (state.surface !== target || !state.fixture || state.unmounted) {
    state.surface = target;
    state.unmounted = false;
    if (!state.fixture) {
      state.fixture = TestBed.createComponent(SurfaceComponent);
    }
    state.fixture.componentRef.setInput('surfaceId', target!.id);
    await settleSurfaceDom(state.fixture);
  }
}

export async function runScenario(scenario: E2eScenario): Promise<void> {
  const protocolVersion = scenario.protocolVersion === 'v0.9.1' ? 'v0.9' : scenario.protocolVersion;
  const state = mountSurface({protocolVersion});
  if (protocolVersion.startsWith('v0.9') || protocolVersion.startsWith('0.9')) {
    registerV09BasicCatalog(state);
  }
  attachGroupErrorForwarding(state);

  try {
    for (const turn of scenario.turns) {
      const turnOutbound: Array<Record<string, unknown>> = [];
      const turnErrors: Array<Record<string, unknown>> = [];

      for (const part of turn.expectWire) {
        if (part.a2ui) {
          try {
            await runStep(state, {
              op: 'process_messages',
              messages: part.a2ui as unknown as AdapterStep['messages'],
            });
          } catch (err) {
            if (!(err instanceof A2uiError)) {
              throw err;
            }
          }
          turnOutbound.push(...captureOutbound(state));
          turnErrors.push(...state.errors);
        }
      }

      if (turn.expectViewTree) {
        for (const [surfaceId, expectedTree] of Object.entries(turn.expectViewTree)) {
          if (expectedTree === null) {
            expect(state.rendererService.surfaceGroup.getSurface(surfaceId)).toBeUndefined();
          } else {
            await selectSurface(state, surfaceId);
            const actualRoot = extractViewTree(state);
            const container = state.fixture?.nativeElement as HTMLElement | undefined;
            assertViewTree(actualRoot, expectedTree, state.surface, container);
          }
        }
      }

      if (turn.uiOps) {
        for (const uiOp of turn.uiOps) {
          await selectSurface(state, uiOp.surfaceId);
          const step: AdapterStep = {
            op: uiOp.op,
            targetNode: uiOp.targetNode,
            inputValue: uiOp.inputValue,
            userActivation: uiOp.userActivation,
          };
          await runStep(state, step);
          turnOutbound.push(...captureOutbound(state));
          turnErrors.push(...state.errors);
        }
      }

      if (turn.expectDataModel) {
        for (const [surfaceId, expectedData] of Object.entries(turn.expectDataModel)) {
          const surface = state.rendererService.surfaceGroup.getSurface(surfaceId);
          expect(surface)
            .withContext(`Expected surface "${surfaceId}" for expectDataModel`)
            .toBeDefined();
          expect(surface!.dataModel.get('/')).toEqual(expectedData);
        }
      }

      if (turn.expectErrors) {
        expect(turnErrors.length).toBe(turn.expectErrors.length);
        turn.expectErrors.forEach((exp, idx) => {
          const act = turnErrors[idx];
          if (exp.code !== undefined) {
            expect(act?.['code']).toBe(exp.code);
          }
          if (exp.surfaceId !== undefined) {
            expect(act?.['surfaceId']).toBe(exp.surfaceId);
          }
          if (exp.message !== undefined) {
            expect(String(act?.['message'] ?? '')).toContain(exp.message);
          }
        });
      }

      if (turn.expectOutbound !== undefined) {
        assertOutbound(turnOutbound, turn.expectOutbound, protocolVersion);
      }
    }
  } finally {
    state.fixture?.destroy();
  }
}

const e2eSpecMetadataByFullName = new Map<string, {suite: string; caseName: string}>();
let e2eReporterInstalled = false;

function ensureE2eJasmineManifestReporter(): void {
  if (e2eReporterInstalled) {
    return;
  }
  e2eReporterInstalled = true;
  jasmine.getEnv().addReporter({
    specDone(result) {
      const meta = e2eSpecMetadataByFullName.get(result.fullName);
      if (!meta) {
        return;
      }
      const status: ManifestRecord['status'] =
        result.status === 'pending' || result.status === 'excluded'
          ? 'skipped'
          : result.status === 'passed'
            ? 'passed'
            : 'failed';
      const reason =
        status === 'skipped'
          ? result.pendingReason || 'skipped'
          : status === 'failed'
            ? result.failedExpectations[0]?.message || 'failed'
            : undefined;
      writeManifestRecord({
        harness: 'angular',
        suite: meta.suite,
        case: meta.caseName,
        status,
        reason,
      });
    },
  });
}

describe('@a2ui/angular E2E Scenario Conformance (conformance/e2e)', () => {
  ensureE2eJasmineManifestReporter();
  const outerTitle = '@a2ui/angular E2E Scenario Conformance (conformance/e2e)';
  const e2eItems = getE2eScenarios();

  beforeEach(() => {
    spyOn(window, 'open').and.returnValue(null);
  });

  it('discovers E2E scenario YAML files under conformance/e2e', () => {
    expect(e2eItems.length).toBeGreaterThan(0);
  });

  const bySuite = new Map<string, E2eScenario[]>();
  for (const item of e2eItems) {
    const list = bySuite.get(item.suite) ?? [];
    list.push(item.scenario);
    bySuite.set(item.suite, list);
  }

  for (const [suiteRelPath, scenarios] of bySuite) {
    const suiteTitle = `E2E Scenarios (${suiteRelPath})`;
    describe(suiteTitle, () => {
      for (const scenario of scenarios) {
        const specTitle = `${scenario.name}: ${scenario.description ?? ''}`;
        e2eSpecMetadataByFullName.set(`${outerTitle} ${suiteTitle} ${specTitle}`, {
          suite: suiteRelPath,
          caseName: scenario.name,
        });

        it(specTitle, async () => {
          assertKnownE2eScenario(scenario);
          const skipReason = findUnsupportedReason(scenario.name);
          if (skipReason) {
            pending(skipReason);
            return;
          }
          await runScenario(scenario);
        });
      }
    });
  }
});
