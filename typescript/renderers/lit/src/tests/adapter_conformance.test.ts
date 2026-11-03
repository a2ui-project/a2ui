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

import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, afterEach, before, describe, it} from 'node:test';

import * as yaml from 'js-yaml';

import {setupTestDom, teardownTestDom} from './dom-setup.js';
import {
  assertAccessibilityNode,
  assertAllUnsupportedMatched,
  assertAxeRules,
  assertKnownAccessibilityCase,
  assertKnownAdapterCase,
  ensureSurfaceMounted,
  findUnsupportedReason,
  mountSurface,
  runStep,
  settleSurface,
  writeManifestRecord,
  type AccessibilityStep,
  type AccessibilityTestCase,
  type AdapterTestCase,
  type ManifestRecord,
} from './adapter_harness.js';

const CONFORMANCE_ROOT = path.resolve(import.meta.dirname, '../../../../../../conformance/core');

describe('@a2ui/lit Adapter & Accessibility Conformance', () => {
  const accessibilityCases = yaml.load(
    fs.readFileSync(path.join(CONFORMANCE_ROOT, 'accessibility.yaml'), 'utf8'),
  ) as AccessibilityTestCase[];
  const adapterCases = yaml.load(
    fs.readFileSync(path.join(CONFORMANCE_ROOT, 'adapter_conformance.yaml'), 'utf8'),
  ) as AdapterTestCase[];

  const mountedElements: HTMLElement[] = [];
  let pendingManifest: ManifestRecord | undefined;

  before(async () => {
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
    assertAllUnsupportedMatched();
    teardownTestDom();
  });

  describe('Accessibility Conformance (accessibility.yaml)', () => {
    for (const testCase of accessibilityCases) {
      it(`${testCase.name}: ${testCase.description ?? ''}`, async t => {
        pendingManifest = {
          harness: 'lit',
          suite: 'core/accessibility.yaml',
          case: testCase.name,
          status: 'failed',
        };
        try {
          assertKnownAccessibilityCase(testCase);
          const steps: AccessibilityStep[] = testCase.steps ?? [
            {
              messages: testCase.messages ?? [],
              assertions: testCase.assertions ?? {},
            },
          ];
          const skipReason = findUnsupportedReason(
            testCase.name,
            steps as unknown as Array<Record<string, unknown>>,
          );
          if (skipReason) {
            pendingManifest.status = 'skipped';
            pendingManifest.reason = skipReason;
            writeManifestRecord(pendingManifest);
            pendingManifest = undefined;
            t.skip(skipReason);
            return;
          }

          const session = mountSurface(undefined, mountedElements);
          for (const step of steps) {
            session.processor.processMessages(step.messages);
            await ensureSurfaceMounted(session, mountedElements);
            await settleSurface(session.surfaceEl!);
            const tree = step.assertions.accessibilityTree ?? {};
            for (const [compId, expected] of Object.entries(tree)) {
              assertAccessibilityNode(session.surfaceEl!, compId, expected);
            }
            if (step.assertions.axeCore) {
              assertAxeRules(session.surfaceEl!, step.assertions.axeCore);
            }
          }
          pendingManifest.status = 'passed';
        } catch (err) {
          if (pendingManifest) {
            pendingManifest.status = 'failed';
            pendingManifest.reason = err instanceof Error ? err.message : String(err);
          }
          throw err;
        }
      });
    }
  });

  describe('Framework Adapter Conformance (adapter_conformance.yaml)', () => {
    for (const testCase of adapterCases) {
      it(`${testCase.name}: ${testCase.description ?? ''}`, async t => {
        pendingManifest = {
          harness: 'lit',
          suite: 'core/adapter_conformance.yaml',
          case: testCase.name,
          status: 'failed',
        };
        try {
          assertKnownAdapterCase(testCase);
          const skipReason = findUnsupportedReason(
            testCase.name,
            testCase.steps as unknown as Array<Record<string, unknown>>,
          );
          if (skipReason) {
            pendingManifest.status = 'skipped';
            pendingManifest.reason = skipReason;
            writeManifestRecord(pendingManifest);
            pendingManifest = undefined;
            t.skip(skipReason);
            return;
          }

          const session = mountSurface(testCase, mountedElements);
          for (const step of testCase.steps) {
            await runStep(session, step);
          }
          pendingManifest.status = 'passed';
        } catch (err) {
          if (pendingManifest) {
            pendingManifest.status = 'failed';
            pendingManifest.reason = err instanceof Error ? err.message : String(err);
          }
          throw err;
        }
      });
    }
  });
});
