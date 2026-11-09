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

/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';

import {render} from '@testing-library/react';
import * as yaml from 'js-yaml';
import React from 'react';
import {afterEach, describe, expect, it} from 'vitest';

import {A2uiError, Catalog} from '@a2ui/web_core';
import {basicCatalog as v09BasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiClientMessageSchema} from '@a2ui/web_core/v0_9';
import {RendererToAgentMessageSchema} from '@a2ui/web_core/v1_0';

import {A2uiSurface, type ReactCatalogComponent} from '../src';
import {
  assertKnownKeys,
  assertViewTree,
  extractViewTree,
  findUnsupportedReason,
  KNOWN_KEYS,
  mountSurface,
  runStep,
  settleSurfaceDom,
  writeManifestRecord,
  type AdapterStep,
  type ExpectedErrorEntry,
  type ExpectedViewNode,
  type ExtraCatalogEntry,
  type HarnessState,
  type ManifestRecord,
} from './adapter_harness';

const CONFORMANCE_ROOT = path.resolve(import.meta.dirname, '../../../../conformance');
const REPO_ROOT = path.resolve(CONFORMANCE_ROOT, '..');

const E2E_SCENARIO_KNOWN_KEYS = new Set([
  'name',
  'description',
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
  expect(
    scenario.action,
    `Unsupported action in scenario(${scenario.name}): ${scenario.action}`,
  ).toBe('e2e_scenario');
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
    expect(actual !== undefined && actual !== null, `${where}: expected defined non-null`).toBe(
      true,
    );
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${where}: expected array`).toBe(true);
    expect((actual as unknown[]).length, `${where}: array length`).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      assertMatchesOutbound((actual as unknown[])[i], expected[i], `${where}[${i}]`);
    }
    return;
  }
  if (typeof expected === 'object' && expected !== null) {
    expect(
      typeof actual === 'object' && actual !== null && !Array.isArray(actual),
      `${where}: expected object`,
    ).toBe(true);
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord).sort();
    const expectedKeys = Object.keys(expectedRecord).sort();
    expect(actualKeys, `${where}: object keys`).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      assertMatchesOutbound(actualRecord[key], expectedRecord[key], `${where}.${key}`);
    }
    return;
  }
  expect(actual, `${where}: value`).toBe(expected);
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
    expect(
      parsed.success,
      `outbound[${i}] failed protocol schema validation: ${
        parsed.success ? '' : JSON.stringify(parsed.error.issues)
      }`,
    ).toBe(true);
  }
  expect(actual, 'expectOutbound length').toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    assertMatchesOutbound(actual[i], expected[i], `expectOutbound[${i}]`);
  }
}

function loadExtraCatalogs(catalogPaths: string[]): ExtraCatalogEntry[] {
  const specs: ExtraCatalogEntry[] = [];
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
          components: raw.components as ExtraCatalogEntry['components'],
        });
      }
    }
  }
  return specs;
}

function registerV09BasicCatalog(state: HarnessState): void {
  const v09Cat = new Catalog<ReactCatalogComponent>(
    v09BasicCatalog.id,
    v09BasicCatalog.protocolVersion ?? 'v0.9',
    Array.from(v09BasicCatalog.components.values()) as unknown as ReactCatalogComponent[],
    Array.from(v09BasicCatalog.functions.values()),
    v09BasicCatalog.themeSchema,
    v09BasicCatalog.instructions,
  );
  const internal = state.processor as unknown as {
    registeredCatalogs: Array<Catalog<ReactCatalogComponent>>;
  };
  internal.registeredCatalogs.unshift(v09Cat);
}

function attachGroupErrorForwarding(state: HarnessState): void {
  const isV09 = state.protocolVersion.startsWith('v0.9') || state.protocolVersion.startsWith('0.9');
  const version = isV09 ? 'v0.9' : state.protocolVersion;
  state.processor.model.onError.subscribe(err => {
    const errRecord = err as unknown as Record<string, unknown>;
    const surfaceId = typeof errRecord.surfaceId === 'string' ? errRecord.surfaceId : '';
    if (surfaceId && state.processor.model.getSurface(surfaceId)) {
      return;
    }
    state.errors.push({
      code: errRecord.code,
      message: errRecord.message,
      surfaceId,
    });
    state.outbound.push({
      version,
      error: {
        code: errRecord.code,
        surfaceId,
        message: errRecord.message,
      },
    });
  });
}

async function selectSurface(state: HarnessState, surfaceId: string): Promise<void> {
  const target = state.processor.model.getSurface(surfaceId);
  expect(target, `Expected surface "${surfaceId}" to exist`).toBeDefined();
  if (state.surface !== target || !state.rendered || state.unmounted) {
    state.surface = target;
    state.unmounted = false;
    if (!state.rendered) {
      state.rendered = render(<A2uiSurface surface={target!} />);
    } else {
      state.rendered.rerender(<A2uiSurface surface={target!} />);
    }
    await settleSurfaceDom(state.rendered.container);
  }
}

export async function runScenario(scenario: E2eScenario): Promise<void> {
  const protocolVersion = scenario.protocolVersion === 'v0.9.1' ? 'v0.9' : scenario.protocolVersion;
  const state = mountSurface({
    protocolVersion,
    catalogs: loadExtraCatalogs(scenario.catalogPaths ?? []),
  });
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
            expect(state.processor.model.getSurface(surfaceId)).toBeUndefined();
          } else {
            await selectSurface(state, surfaceId);
            const actualRoot = extractViewTree(state);
            assertViewTree(actualRoot, expectedTree, state.surface, state.rendered?.container);
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
          const surface = state.processor.model.getSurface(surfaceId);
          expect(surface, `Expected surface "${surfaceId}" for expectDataModel`).toBeDefined();
          expect(surface!.dataModel.get('/')).toEqual(expectedData);
        }
      }

      if (turn.expectErrors) {
        expect(turnErrors).toHaveLength(turn.expectErrors.length);
        turn.expectErrors.forEach((exp, idx) => {
          const act = turnErrors[idx];
          if (exp.code !== undefined) {
            expect(act?.code).toBe(exp.code);
          }
          if (exp.surfaceId !== undefined) {
            expect(act?.surfaceId).toBe(exp.surfaceId);
          }
          if (exp.message !== undefined) {
            expect(String(act?.message ?? '')).toContain(exp.message);
          }
        });
      }

      if (turn.expectOutbound !== undefined) {
        assertOutbound(turnOutbound, turn.expectOutbound, protocolVersion);
      }
    }
  } finally {
    state.rendered?.unmount();
  }
}

let pendingManifest: ManifestRecord | undefined;

afterEach(() => {
  if (pendingManifest) {
    writeManifestRecord(pendingManifest);
    pendingManifest = undefined;
  }
});

const suiteFiles = findE2eSuiteFiles();

describe('@a2ui/react E2E Scenario Conformance', () => {
  it('discovers E2E scenario YAML files under conformance/e2e', () => {
    expect(suiteFiles.length).toBeGreaterThan(0);
  });

  for (const {suiteRelPath, scenarios} of suiteFiles) {
    describe(`E2E Scenarios (${suiteRelPath})`, () => {
      for (const scenario of scenarios) {
        const testTitle = `${scenario.name}: ${scenario.description ?? ''}`;
        it(testTitle, async ctx => {
          const record: ManifestRecord = {
            harness: 'react',
            suite: suiteRelPath,
            case: scenario.name,
            status: 'failed',
          };
          pendingManifest = record;
          try {
            assertKnownE2eScenario(scenario);
            const skipReason = findUnsupportedReason(scenario.name);
            if (skipReason) {
              record.status = 'skipped';
              record.reason = skipReason;
              ctx.skip(skipReason);
              return;
            }
            await runScenario(scenario);
            record.status = 'passed';
          } catch (err) {
            record.status = 'failed';
            record.reason = err instanceof Error ? err.message : String(err);
            throw err;
          }
        });
      }
    });
  }
});
