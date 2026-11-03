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

import {existsSync, readdirSync} from 'fs';
import {join, resolve} from 'path';

import {expect} from 'vitest';

import {
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  FileSystemCatalogProvider,
  formatInboundForModel,
  getInboundMessageKind,
  parseInboundMessage,
  Parser,
  type ProtocolVersion,
  RendererState,
  StreamPart,
} from '../../src/index.js';
import {CatalogApi} from '../../src/internal/web-core.js';
import {CONFORMANCE_ROOT, LoadedCase, loadCases} from './loader.js';
import {categoryOf, conformancePath, describeSuite} from './suite-helpers.js';

const KNOWN_FAILURES = new Map<string, string>();

const SCENARIO_KEYS = new Set([
  'name',
  'action',
  'description',
  'features',
  'protocolVersion',
  'catalogPaths',
  'formats',
  'source',
  'turns',
  'sourceFile',
]);

const SOURCE_KEYS = new Set(['kind', 'from', 'model', 'recordedAt']);

const TURN_KEYS = new Set([
  'userText',
  'modelChunks',
  'expectWire',
  'expectViewTree',
  'expectErrors',
  'uiOps',
  'expectDataModel',
  'expectOutbound',
]);

const UI_OP_KEYS = new Set(['op', 'surfaceId', 'targetNode', 'inputValue', 'userActivation']);

interface E2eTurn {
  userText?: string | null;
  modelChunks: Record<string, string[]>;
  expectWire: Array<Record<string, unknown>>;
  expectViewTree?: Record<string, Record<string, unknown> | null>;
  expectErrors?: Array<Record<string, unknown>>;
  uiOps?: Array<Record<string, unknown>>;
  expectDataModel?: Record<string, unknown>;
  expectOutbound?: Array<Record<string, unknown>>;
}

function findE2eYamlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findE2eYamlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function assertKnownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
): void {
  const unknown = Object.keys(obj)
    .filter(k => !allowed.has(k))
    .sort();
  if (unknown.length > 0) {
    throw new Error(`Unknown ${where} keys: ${unknown.join(', ')}`);
  }
}

function assertScenarioKeys(testCase: LoadedCase): void {
  expect(testCase.action).toBe('e2e_scenario');
  assertKnownKeys(testCase, SCENARIO_KEYS, `scenario(${testCase.name})`);
  if (testCase.source && typeof testCase.source === 'object') {
    assertKnownKeys(
      testCase.source as Record<string, unknown>,
      SOURCE_KEYS,
      `scenario(${testCase.name}).source`,
    );
  }
  const turns = testCase.turns as Array<Record<string, unknown>> | undefined;
  expect(Array.isArray(turns) && turns.length > 0, 'scenario must define turns').toBe(true);
  for (const [turnIdx, turn] of (turns ?? []).entries()) {
    assertKnownKeys(turn, TURN_KEYS, `scenario(${testCase.name}).turns[${turnIdx}]`);
    const uiOps = turn.uiOps as Array<Record<string, unknown>> | undefined;
    for (const [opIdx, uiOp] of (uiOps ?? []).entries()) {
      assertKnownKeys(
        uiOp,
        UI_OP_KEYS,
        `scenario(${testCase.name}).turns[${turnIdx}].uiOps[${opIdx}]`,
      );
    }
  }
}

function resolveCatalogPath(catPath: string): string {
  const inConformance = conformancePath(catPath);
  if (existsSync(inConformance)) {
    return inConformance;
  }
  return resolve(CONFORMANCE_ROOT, '..', catPath);
}

function loadScenarioCatalogs(testCase: LoadedCase): CatalogApi[] {
  const paths = testCase.catalogPaths as string[] | undefined;
  if (!paths || paths.length === 0) {
    throw new Error(`Scenario ${testCase.name} declares no catalogPaths`);
  }
  return paths.map(catPath => new FileSystemCatalogProvider(resolveCatalogPath(catPath)).load());
}

function makeParser(formatName: string, catalogs: CatalogApi[], protocolVersion: string): Parser {
  if (formatName === 'direct_json') {
    return new DirectJsonFormatFactory().createFormat(catalogs).createParser();
  }
  if (formatName === 'express') {
    return new ExpressFormatFactory({
      surfaceId: 'default_surface',
      version: protocolVersion,
    })
      .createFormat(catalogs)
      .createParser();
  }
  throw new Error(`Unsupported inference format '${formatName}'`);
}

function partToDict(part: StreamPart): Record<string, unknown> {
  if (part.type === 'text') return {text: part.text};
  if (part.type === 'error') return {error: {category: categoryOf(part.error)}};
  return {a2ui: part.a2ui};
}

function mergeAdjacentText(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    if (merged.length > 0 && 'text' in merged[merged.length - 1] && 'text' in part) {
      merged[merged.length - 1] = {
        text: `${merged[merged.length - 1].text}${part.text}`,
      };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function runFormat(
  testCase: LoadedCase,
  formatName: string,
  catalogs: CatalogApi[],
  protocolVersion: string,
): void {
  const parser = makeParser(formatName, catalogs, protocolVersion);
  const streamState = new RendererState(catalogs);
  const singleShotState = new RendererState(catalogs);
  const turns = testCase.turns as E2eTurn[];

  for (const [turnIdx, turn] of turns.entries()) {
    const chunks = turn.modelChunks[formatName];
    expect(
      chunks,
      `scenario ${testCase.name} turn ${turnIdx} missing chunks for ${formatName}`,
    ).toBeDefined();

    const expectedWire = (turn.expectWire ?? []) as Array<Record<string, unknown>>;
    for (const wirePart of expectedWire) {
      const a2uiList = wirePart.a2ui as Array<Record<string, unknown>> | undefined;
      for (const msg of a2uiList ?? []) {
        const updateComp = msg.updateComponents as Record<string, unknown> | undefined;
        if (updateComp && typeof updateComp.surfaceId === 'string') {
          const sid = updateComp.surfaceId;
          const createMsg = {
            version: protocolVersion === 'v0.9.1' ? 'v0.9' : protocolVersion,
            createSurface: {
              surfaceId: sid,
              catalogId: catalogs[0].id,
            },
          };
          if (!streamState.getSurface(sid)) {
            streamState.apply([createMsg]);
          }
          if (!singleShotState.getSurface(sid)) {
            singleShotState.apply([createMsg]);
          }
        }
      }
    }

    const stream = parser.openStream({state: streamState});
    const streamedParts: Array<Record<string, unknown>> = [];
    for (const chunk of chunks) {
      streamedParts.push(...stream.feed(chunk).map(partToDict));
    }
    streamedParts.push(...stream.close().map(partToDict));
    expect(
      mergeAdjacentText(streamedParts),
      `[${formatName}] turn ${turnIdx} streaming wire`,
    ).toEqual(turn.expectWire);

    const singleShotParts = parser
      .parseResponse(chunks.join(''), {state: singleShotState})
      .map(partToDict);
    expect(
      mergeAdjacentText(singleShotParts),
      `[${formatName}] turn ${turnIdx} single-shot wire`,
    ).toEqual(turn.expectWire);
  }
}

function materializeOutbound(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    return value.map(item => materializeOutbound(item, key));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === '$match') {
      const kind = record['$match'];
      if (kind === 'iso8601' || key === 'timestamp') {
        return '2026-01-01T00:00:00Z';
      }
      if (key === 'functionCallId') {
        return 'call-1';
      }
      return 'match-str';
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = materializeOutbound(v, k);
    }
    return out;
  }
  return value;
}

function verifyOutboundRoundtrip(testCase: LoadedCase, protocolVersion: string): void {
  const version = (protocolVersion === 'v0.9.1' ? 'v0.9' : protocolVersion) as ProtocolVersion;
  const turns = testCase.turns as E2eTurn[];
  for (const [turnIdx, turn] of turns.entries()) {
    for (const [outIdx, rawEnvelope] of (turn.expectOutbound ?? []).entries()) {
      const concrete = materializeOutbound(rawEnvelope) as Record<string, unknown>;
      const parsed = parseInboundMessage(concrete, version);
      const expectedKind = 'action' in concrete ? 'action' : 'error';
      expect(getInboundMessageKind(parsed), `turn ${turnIdx} expectOutbound[${outIdx}] kind`).toBe(
        expectedKind,
      );
      const formatted = formatInboundForModel(parsed);
      expect(
        formatted && formatted.trim().length > 0,
        `turn ${turnIdx} expectOutbound[${outIdx}] formatted output`,
      ).toBe(true);
      if (expectedKind === 'action') {
        const action = concrete['action'] as Record<string, unknown>;
        expect(formatted).toContain(String(action['name']));
        expect(formatted).toContain(String(action['surfaceId']));
        const context = (action['context'] ?? {}) as Record<string, unknown>;
        for (const [ctxKey, ctxVal] of Object.entries(context)) {
          expect(formatted).toContain(ctxKey);
          expect(formatted).toContain(String(ctxVal));
        }
      } else {
        const error = concrete['error'] as Record<string, unknown>;
        expect(formatted).toContain(String(error['code']));
      }
    }
  }
}

function runScenario(testCase: LoadedCase): void {
  assertScenarioKeys(testCase);
  const catalogs = loadScenarioCatalogs(testCase);
  const protocolVersion = String(testCase.protocolVersion ?? '1.0');
  verifyOutboundRoundtrip(testCase, protocolVersion);
  const formats = testCase.formats as string[];
  const failures: Error[] = [];

  for (const formatName of formats) {
    try {
      runFormat(testCase, formatName, catalogs, protocolVersion);
    } catch (error) {
      const msg = error instanceof Error ? (error.stack ?? error.message) : String(error);
      failures.push(new Error(`[${formatName}] ${msg}`));
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.map(f => f.message).join('\n\n'));
  }
}

const e2eFiles = findE2eYamlFiles(resolve(CONFORMANCE_ROOT, 'e2e'));
if (e2eFiles.length === 0) {
  throw new Error('No E2E scenario YAML files found under conformance/e2e');
}

describeSuite(
  'Conformance: e2e scenarios',
  loadCases(e2eFiles),
  testCase => runScenario(testCase),
  {
    knownFailures: KNOWN_FAILURES,
  },
);
