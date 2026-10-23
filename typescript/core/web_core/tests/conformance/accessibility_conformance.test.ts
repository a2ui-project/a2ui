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
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it, before, after, afterEach} from 'node:test';

import * as yaml from 'js-yaml';

import {setupTestDom, teardownTestDom, asyncUpdate} from '../../src/test/dom-setup.js';
import {render} from 'lit';

import {basicCatalog} from '../../src/catalogs/basic/v1/index.js';
import {
  MessageProcessor,
  NodeResolver,
  effect,
  getValue,
  type ComponentNode,
  type ProcessableMessage,
  type SurfaceModel,
} from '../../src/index.js';
import {
  A2uiLitElement,
  registerUniversalElement,
  renderA2uiNode,
  type WebComponentImplementation,
} from '../../src/universal/index.js';

const CONFORMANCE_ROOT = path.resolve(import.meta.dirname, '../../../../../../conformance/core');

interface ExpectedAccessibilityNode {
  label?: string;
  description?: string;
  live?: string;
  hidden?: boolean;
  role?: string;
  checked?: boolean;
}

interface AccessibilityAssertions {
  accessibilityTree?: Record<string, ExpectedAccessibilityNode>;
  axeCore?: string[];
}

interface AccessibilityStep {
  messages: ProcessableMessage[];
  assertions: AccessibilityAssertions;
}

interface AccessibilityTestCase {
  name: string;
  description?: string;
  protocolVersion: string;
  action: string;
  messages?: ProcessableMessage[];
  assertions?: AccessibilityAssertions;
  steps?: AccessibilityStep[];
}

interface MountedHarness {
  container: HTMLElement;
  surface: SurfaceModel<WebComponentImplementation>;
  resolver: NodeResolver<WebComponentImplementation>;
  dispose: () => void;
}

function registerBasicCatalogElements(): void {
  for (const comp of basicCatalog.components.values()) {
    registerUniversalElement(comp);
  }
}

async function settleElements(container: HTMLElement): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    await asyncUpdate(() => {});
    const elements = Array.from(container.querySelectorAll('*'));
    for (const el of elements) {
      const litEl = el as unknown as {updateComplete?: Promise<boolean>};
      if (litEl.updateComplete) {
        await litEl.updateComplete;
      }
    }
  }
}

function mountResolvedSurface(surface: SurfaceModel<WebComponentImplementation>): MountedHarness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const resolver = new NodeResolver(surface, basicCatalog);
  const stopEffect = effect(() => {
    const rootNode = getValue(resolver.rootNode);
    if (rootNode) {
      render(renderA2uiNode(rootNode), container);
    }
  });
  return {
    container,
    surface,
    resolver,
    dispose: () => {
      stopEffect();
      resolver.dispose();
      container.remove();
    },
  };
}

function findComponentElement(
  container: HTMLElement,
  componentId: string,
): HTMLElement | undefined {
  const candidates = Array.from(container.querySelectorAll('*'));
  for (const candidate of candidates) {
    const a2uiEl = candidate as unknown as A2uiLitElement<WebComponentImplementation> & {
      node?: ComponentNode<WebComponentImplementation>;
    };
    if (a2uiEl.context?.componentModel.id === componentId) {
      return candidate as HTMLElement;
    }
  }
  return undefined;
}

function resolveAccessibleLabel(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute('aria-label');
  if (explicit) {
    return explicit;
  }
  const innerButton = el.querySelector('button');
  if (innerButton?.textContent) {
    return innerButton.textContent.trim();
  }
  const innerLabel = el.querySelector('label');
  if (innerLabel?.textContent) {
    return innerLabel.textContent.trim();
  }
  const text = el.textContent?.trim();
  return text || undefined;
}

function resolveSemanticRole(el: HTMLElement): string | undefined {
  const explicitRole = el.getAttribute('role');
  if (explicitRole) {
    return explicitRole;
  }
  if (el.querySelector('button')) {
    return 'button';
  }
  if (el.querySelector('input[type="checkbox"]')) {
    return 'checkbox';
  }
  if (el.querySelector('input[type="radio"]')) {
    return 'radiogroup';
  }
  if (
    el.querySelector(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea',
    )
  ) {
    return 'textbox';
  }
  return undefined;
}

function resolveCheckedState(el: HTMLElement): boolean | undefined {
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked === 'true' || ariaChecked === 'false') {
    return ariaChecked === 'true';
  }
  const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (checkbox) {
    return checkbox.checked;
  }
  return undefined;
}

function assertNodeAccessibility(
  container: HTMLElement,
  componentId: string,
  expected: ExpectedAccessibilityNode,
): void {
  const el = findComponentElement(container, componentId);
  assert.ok(el, `Expected rendered DOM element for component "${componentId}"`);

  if (expected.label !== undefined) {
    assert.equal(
      resolveAccessibleLabel(el),
      expected.label,
      `Accessibility label mismatch on "${componentId}"`,
    );
  }
  if (expected.description !== undefined) {
    assert.equal(
      el.getAttribute('aria-description'),
      expected.description,
      `aria-description mismatch on "${componentId}"`,
    );
  }
  if (expected.live !== undefined) {
    assert.equal(
      el.getAttribute('aria-live'),
      expected.live,
      `aria-live mismatch on "${componentId}"`,
    );
  }
  if (expected.hidden !== undefined) {
    assert.equal(
      el.getAttribute('aria-hidden'),
      String(expected.hidden),
      `aria-hidden mismatch on "${componentId}"`,
    );
  }
  if (expected.role !== undefined) {
    assert.equal(
      resolveSemanticRole(el),
      expected.role,
      `Semantic role mismatch on "${componentId}"`,
    );
  }
  if (expected.checked !== undefined) {
    assert.equal(
      resolveCheckedState(el),
      expected.checked,
      `Checked state mismatch on "${componentId}"`,
    );
  }
}

function assertAxeInvariants(container: HTMLElement, rules: string[] = []): void {
  if (rules.includes('button-name')) {
    const buttons = Array.from(container.querySelectorAll('button'));
    for (const btn of buttons) {
      const host = btn.closest('a2ui-basic-button') as HTMLElement | null;
      const name =
        btn.getAttribute('aria-label') ||
        host?.getAttribute('aria-label') ||
        btn.textContent?.trim();
      assert.ok(name, 'Every button must have an accessible name');
    }
  }
  if (rules.includes('aria-valid-attr-value')) {
    const liveNodes = Array.from(container.querySelectorAll('[aria-live]'));
    for (const node of liveNodes) {
      const val = node.getAttribute('aria-live');
      assert.ok(
        val === 'off' || val === 'polite' || val === 'assertive',
        `Invalid aria-live attribute value: ${val}`,
      );
    }
  }
}

async function verifyAssertions(
  container: HTMLElement,
  assertions: AccessibilityAssertions,
): Promise<void> {
  await settleElements(container);
  const tree = assertions.accessibilityTree ?? {};
  for (const [componentId, expected] of Object.entries(tree)) {
    assertNodeAccessibility(container, componentId, expected);
  }
  if (assertions.axeCore) {
    assertAxeInvariants(container, assertions.axeCore);
  }
}

describe('Web Universal Custom Elements Accessibility Conformance', () => {
  const yamlPath = path.join(CONFORMANCE_ROOT, 'accessibility.yaml');
  const testCases = yaml.load(fs.readFileSync(yamlPath, 'utf8')) as AccessibilityTestCase[];

  let activeHarness: MountedHarness | undefined;

  before(() => {
    setupTestDom();
    registerBasicCatalogElements();
  });

  afterEach(() => {
    activeHarness?.dispose();
    activeHarness = undefined;
  });

  after(() => {
    teardownTestDom();
  });

  for (const testCase of testCases) {
    it(`${testCase.name}: ${testCase.description ?? ''}`, async () => {
      const processor = new MessageProcessor<WebComponentImplementation>([basicCatalog]);
      const steps: AccessibilityStep[] = testCase.steps ?? [
        {
          messages: testCase.messages ?? [],
          assertions: testCase.assertions ?? {},
        },
      ];

      for (const step of steps) {
        processor.processMessages(step.messages);
        if (!activeHarness) {
          const surface = processor.model.getSurface('a11y_surface');
          assert.ok(surface, 'Surface "a11y_surface" was not created');
          activeHarness = mountResolvedSurface(surface);
        }
        await verifyAssertions(activeHarness.container, step.assertions);
      }
    });
  }
});
