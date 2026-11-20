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

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {describe, expect, it} from 'vitest';

import {type AgentToRendererMessage, ExpressFormat} from '../../src/index.js';
import {loadBasicCatalog, REPO_ROOT} from '../helpers/basic-catalogs.js';

interface SpecificationExample {
  name?: string;
  description?: string;
  customComponents?: unknown[];
  messages?: AgentToRendererMessage[];
}

function findSpecificationExampleFiles(): string[] {
  const examplesDir = path.join(REPO_ROOT, 'catalogs/basic/v1/examples');
  return fs
    .readdirSync(examplesDir)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => path.join(examplesDir, file));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Coalesces split `createSurface` + initial `updateComponents` + initial root
 * `updateDataModel` messages in a specification example into the canonical
 * message sequence produced by Express compilation.
 */
function canonicalizeMessages(messages: AgentToRendererMessage[]): AgentToRendererMessage[] {
  const coalesced: Array<Record<string, unknown>> = [];
  const openBySurface = new Map<string, number>();

  for (const rawMsg of messages) {
    if (!isRecord(rawMsg)) {
      continue;
    }
    if (isRecord(rawMsg.createSurface)) {
      const cs = {...rawMsg.createSurface};
      const sid = typeof cs.surfaceId === 'string' ? cs.surfaceId : 'main';
      openBySurface.set(sid, coalesced.length);
      coalesced.push({...rawMsg, createSurface: cs});
      continue;
    }
    if (isRecord(rawMsg.updateComponents)) {
      const uc = rawMsg.updateComponents;
      const sid = typeof uc.surfaceId === 'string' ? uc.surfaceId : 'main';
      const openIdx = openBySurface.get(sid);
      if (openIdx !== undefined) {
        const openCs = coalesced[openIdx].createSurface as Record<string, unknown>;
        if (!openCs.components) {
          openCs.components = uc.components;
          continue;
        }
        openBySurface.delete(sid);
      }
      coalesced.push(rawMsg);
      continue;
    }
    if (isRecord(rawMsg.updateDataModel)) {
      const udm = rawMsg.updateDataModel;
      const sid = typeof udm.surfaceId === 'string' ? udm.surfaceId : 'main';
      const openIdx = openBySurface.get(sid);
      const isRootPath =
        udm.path === undefined || udm.path === null || udm.path === '' || udm.path === '/';
      if (openIdx !== undefined && isRootPath && isRecord(udm.value)) {
        const openCs = coalesced[openIdx].createSurface as Record<string, unknown>;
        openCs.dataModel = {...udm.value};
        continue;
      }
      openBySurface.delete(sid);
      coalesced.push({
        ...rawMsg,
        updateDataModel: {
          ...udm,
          path: typeof udm.path === 'string' ? udm.path : '/',
        },
      });
      continue;
    }
    coalesced.push(rawMsg);
  }

  return coalesced as unknown as AgentToRendererMessage[];
}

const EXAMPLE_FILES = findSpecificationExampleFiles();

describe('Specification v1.0 example corpus Express round-trip', () => {
  const catalog = loadBasicCatalog('1.0');
  const expressFormat = new ExpressFormat([catalog], {version: '1.0'});

  it('discovers all 43 specification v1.0 example files', () => {
    expect(EXAMPLE_FILES.length).toBe(43);
  });

  for (const jsonFile of EXAMPLE_FILES) {
    const fileName = path.basename(jsonFile);
    const raw = fs.readFileSync(jsonFile, 'utf-8');
    const data = JSON.parse(raw) as SpecificationExample;

    if (Array.isArray(data.customComponents) && data.customComponents.length > 0) {
      it.skip(`${fileName} uses customComponents outside the basic catalog`, () => {});
      continue;
    }

    it(`round-trips ${fileName} through Express decompile and compile`, () => {
      const messages = (data.messages ?? [data]) as AgentToRendererMessage[];
      const canonical = canonicalizeMessages(messages);
      const parser = expressFormat.createParser();
      const expressDsl = parser.decompile(messages);
      expect(expressDsl.trim().length).toBeGreaterThan(0);

      const recompiled = parser.compile(expressDsl);
      assert.deepStrictEqual(recompiled, canonical);

      // Verify exact idempotence on a second decompile and compile pass.
      const recompiledAgain = parser.compile(parser.decompile(recompiled));
      assert.deepStrictEqual(recompiledAgain, recompiled);
    });
  }
});
