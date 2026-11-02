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

import {act, render, type RenderResult} from '@testing-library/react';
import * as yaml from 'js-yaml';
import React from 'react';
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {MessageProcessor} from '@a2ui/web_core';
import {A2uiSurface, type ReactCatalogComponent} from '../src';
import {
  assertAllUnsupportedMatched,
  assertAxeRules,
  assertKnownAccessibilityCase,
  assertKnownAdapterCase,
  assertNodeAccessibility,
  createDefaultAdapterCatalog,
  findUnsupportedReason,
  mountSurface,
  runStep,
  settleSurfaceDom,
  writeManifestRecord,
  type AccessibilityStep,
  type AccessibilityTestCase,
  type AdapterTestCase,
  type ManifestRecord,
} from './adapter_harness';

const CONFORMANCE_DIR = path.resolve(import.meta.dirname, '../../../../conformance/core');

function loadYamlCases<T>(fileName: string): T[] {
  const fullPath = path.join(CONFORMANCE_DIR, fileName);
  return yaml.load(fs.readFileSync(fullPath, 'utf8')) as T[];
}

const pendingManifestByTestName = new Map<string, ManifestRecord>();

afterEach(() => {
  const currentTestName = expect.getState().currentTestName ?? '';
  for (const [key, rec] of pendingManifestByTestName) {
    if (currentTestName.endsWith(key)) {
      writeManifestRecord(rec);
      pendingManifestByTestName.delete(key);
    }
  }
});

afterAll(() => {
  assertAllUnsupportedMatched();
});

describe('@a2ui/react Accessibility Conformance (conformance/core/accessibility.yaml)', () => {
  const accessibilityCases = loadYamlCases<AccessibilityTestCase>('accessibility.yaml');

  for (const testCase of accessibilityCases) {
    const testTitle = `${testCase.name}: ${testCase.description ?? ''}`;
    it(testTitle, async ctx => {
      const record: ManifestRecord = {
        harness: 'react',
        suite: 'core/accessibility.yaml',
        case: testCase.name,
        status: 'failed',
      };
      pendingManifestByTestName.set(testTitle, record);
      let rendered: RenderResult | undefined;
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
          record.status = 'skipped';
          record.reason = skipReason;
          ctx.skip();
          return;
        }

        const processor = new MessageProcessor<ReactCatalogComponent>([
          createDefaultAdapterCatalog(),
        ]);

        for (const step of steps) {
          await act(async () => {
            processor.processMessages(step.messages);
          });
          if (!rendered) {
            const surface = processor.model.getSurface('a11y_surface');
            expect(surface).toBeDefined();
            rendered = render(<A2uiSurface surface={surface!} />);
          }
          await settleSurfaceDom(rendered.container);
          for (const [compId, expected] of Object.entries(
            step.assertions.accessibilityTree ?? {},
          )) {
            assertNodeAccessibility(rendered.container, compId, expected);
          }
          if (step.assertions.axeCore) {
            assertAxeRules(rendered.container, step.assertions.axeCore);
          }
        }
        record.status = 'passed';
      } catch (err) {
        record.status = 'failed';
        record.reason = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        rendered?.unmount();
      }
    });
  }
});

describe('@a2ui/react Adapter Conformance (conformance/core/adapter_conformance.yaml)', () => {
  const adapterCases = loadYamlCases<AdapterTestCase>('adapter_conformance.yaml');

  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const testCase of adapterCases) {
    const testTitle = `${testCase.name}: ${testCase.description ?? ''}`;
    it(testTitle, async ctx => {
      const record: ManifestRecord = {
        harness: 'react',
        suite: 'core/adapter_conformance.yaml',
        case: testCase.name,
        status: 'failed',
      };
      pendingManifestByTestName.set(testTitle, record);
      const state = mountSurface(testCase);
      try {
        assertKnownAdapterCase(testCase);
        const skipReason = findUnsupportedReason(
          testCase.name,
          testCase.steps as unknown as Array<Record<string, unknown>>,
        );
        if (skipReason) {
          record.status = 'skipped';
          record.reason = skipReason;
          ctx.skip();
          return;
        }

        for (const step of testCase.steps) {
          await runStep(state, step);
        }
        record.status = 'passed';
      } catch (err) {
        record.status = 'failed';
        record.reason = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        if (!state.unmounted) {
          state.rendered?.unmount();
        }
      }
    });
  }
});
