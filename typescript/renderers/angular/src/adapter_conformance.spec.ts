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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {
  assertAllUnsupportedMatched,
  assertAxeRules,
  assertKnownAccessibilityCase,
  assertKnownAdapterCase,
  assertNodeAccessibility,
  createDefaultAdapterCatalog,
  findUnsupportedReason,
  getConformanceSuites,
  mountSurface,
  runStep,
  settleSurfaceDom,
  writeManifestRecord,
  type AccessibilityStep,
  type ManifestRecord,
} from './adapter_harness';
import {A2uiRendererService, SurfaceComponent, provideA2UI} from './public-api';

const specMetadataByFullName = new Map<string, {suite: string; caseName: string}>();
let reporterInstalled = false;

function ensureJasmineManifestReporter(): void {
  if (reporterInstalled) {
    return;
  }
  reporterInstalled = true;
  jasmine.getEnv().addReporter({
    specDone(result) {
      const meta = specMetadataByFullName.get(result.fullName);
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

describe('@a2ui/angular Accessibility Conformance (conformance/core/accessibility.yaml)', () => {
  ensureJasmineManifestReporter();
  const suiteTitle =
    '@a2ui/angular Accessibility Conformance (conformance/core/accessibility.yaml)';
  const {accessibility} = getConformanceSuites();

  for (const testCase of accessibility) {
    const specTitle = `${testCase.name}: ${testCase.description ?? ''}`;
    specMetadataByFullName.set(`${suiteTitle} ${specTitle}`, {
      suite: 'core/accessibility.yaml',
      caseName: testCase.name,
    });

    it(specTitle, async () => {
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
        pending(skipReason);
        return;
      }

      TestBed.configureTestingModule({
        imports: [SurfaceComponent],
        providers: [provideA2UI({catalogs: [createDefaultAdapterCatalog()]})],
      });
      const rendererService = TestBed.inject(A2uiRendererService);
      let fixture: ComponentFixture<SurfaceComponent> | undefined;

      try {
        for (const step of steps) {
          rendererService.processMessages(step.messages);
          if (!fixture) {
            const surface = rendererService.surfaceGroup.getSurface('a11y_surface');
            expect(surface).toBeDefined();
            fixture = TestBed.createComponent(SurfaceComponent);
            fixture.componentRef.setInput('surfaceId', surface!.id);
          }
          await settleSurfaceDom(fixture);
          const container = fixture.nativeElement as HTMLElement;
          for (const [compId, expected] of Object.entries(
            step.assertions.accessibilityTree ?? {},
          )) {
            assertNodeAccessibility(container, compId, expected);
          }
          if (step.assertions.axeCore) {
            assertAxeRules(container, step.assertions.axeCore);
          }
        }
      } finally {
        fixture?.destroy();
      }
    });
  }
});

describe('@a2ui/angular Adapter Conformance (conformance/core/adapter_conformance.yaml)', () => {
  ensureJasmineManifestReporter();
  const suiteTitle =
    '@a2ui/angular Adapter Conformance (conformance/core/adapter_conformance.yaml)';
  const {adapterConformance} = getConformanceSuites();

  beforeEach(() => {
    spyOn(window, 'open').and.returnValue(null);
  });

  afterAll(() => {
    assertAllUnsupportedMatched();
  });

  for (const testCase of adapterConformance) {
    const specTitle = `${testCase.name}: ${testCase.description ?? ''}`;
    specMetadataByFullName.set(`${suiteTitle} ${specTitle}`, {
      suite: 'core/adapter_conformance.yaml',
      caseName: testCase.name,
    });

    it(specTitle, async () => {
      assertKnownAdapterCase(testCase);
      const skipReason = findUnsupportedReason(
        testCase.name,
        testCase.steps as unknown as Array<Record<string, unknown>>,
      );
      if (skipReason) {
        pending(skipReason);
        return;
      }

      const state = mountSurface(testCase);
      try {
        for (const step of testCase.steps) {
          await runStep(state, step);
        }
      } finally {
        if (!state.unmounted) {
          state.fixture?.destroy();
        }
      }
    });
  }
});
