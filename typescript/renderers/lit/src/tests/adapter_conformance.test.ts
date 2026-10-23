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
import {z} from 'zod';

import {setupTestDom, teardownTestDom, asyncUpdate} from './dom-setup.js';
import {html} from 'lit';

import {
  Catalog,
  MessageProcessor,
  ResolvedBinding,
  getValue,
  isComponentNode,
  type ComponentNode,
  type FunctionImplementation,
  type ProcessableMessage,
  type SurfaceModel,
} from '@a2ui/web_core';
import {basicCatalog as v1BasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {A2uiLitElement} from '@a2ui/web_core/universal';

import type {A2uiSurface} from '../index.js';
import type {LitComponentApi} from '../types.js';

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
  messages?: ProcessableMessage[];
  assertions?: AccessibilityAssertions;
  steps?: AccessibilityStep[];
}

interface ExpectedViewNode {
  id: string;
  type?: string;
  state?: string;
  text?: string;
  value?: unknown;
  badgeText?: string;
  isValid?: boolean;
  validationErrors?: string[];
  validationResults?: unknown[];
  children?: ExpectedViewNode[];
}

interface ExpectedAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context?: Record<string, unknown>;
}

interface ExpectedError {
  code?: string;
  surfaceId?: string;
  message?: string;
}

interface AdapterStep {
  op:
    | 'process_messages'
    | 'user_input'
    | 'user_gesture'
    | 'programmatic_invoke'
    | 'unmount_surface';
  messages?: ProcessableMessage[];
  targetNode?: string;
  inputValue?: unknown;
  userActivation?: boolean;
  expectViewTree?: ExpectedViewNode;
  expectDataModel?: Record<string, unknown>;
  expectSameViewIdentity?: string[];
  expectActions?: ExpectedAction[];
  expectErrors?: ExpectedError[];
  expectAccessibilityTree?: Record<string, ExpectedAccessibilityNode>;
  expectActiveSubscriptions?: number;
}

interface SecondaryCatalogSpec {
  catalogId: string;
  protocolVersion?: string;
  components: Record<string, unknown>;
}

interface AdapterTestCase {
  name: string;
  description?: string;
  catalogs?: SecondaryCatalogSpec[];
  steps: AdapterStep[];
}

interface AdapterSession {
  processor: MessageProcessor<LitComponentApi>;
  surface?: SurfaceModel<LitComponentApi>;
  surfaceEl?: A2uiSurface;
  recordedActions: ExpectedAction[];
  recordedErrors: Array<{code: string; message: string; surfaceId: string}>;
  priorIdentities: Map<string, HTMLElement>;
}

async function settleSurface(root: HTMLElement): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    await asyncUpdate(root, () => {});
    const elements = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const el of elements) {
      const litEl = el as unknown as {updateComplete?: Promise<boolean>};
      if (litEl.updateComplete) {
        await litEl.updateComplete;
      }
    }
  }
}

function createIncrementCounterFn(): FunctionImplementation {
  return {
    name: 'incrementCounter',
    returnType: 'void',
    schema: z.object({
      path: z.string(),
      step: z.number(),
    }),
    execute: (args: {path: string; step: number}, context) => {
      const current = Number(context.dataModel.get(args.path) ?? 0);
      context.dataModel.set(args.path, current + args.step);
    },
  };
}

function resolveIterationIndex(context: {explicitIndex?: number; path?: string}): number {
  if (typeof context.explicitIndex === 'number') {
    return context.explicitIndex;
  }
  const parts = (context.path ?? '').split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  return last && /^\d+$/.test(last) ? Number(last) : 0;
}

function wrapFormatStringFn(baseFn: FunctionImplementation): FunctionImplementation {
  return {
    ...baseFn,
    execute: (args: Record<string, unknown>, context, abortSignal) => {
      const rawValue = typeof args.value === 'string' ? args.value : '';
      const idx = resolveIterationIndex(context as {explicitIndex?: number; path?: string});
      const normalized = rawValue.replace(/\$\{@index\}/g, String(idx));
      return baseFn.execute({...args, value: normalized}, context, abortSignal);
    },
  };
}

function createAugmentedBasicCatalog(): Catalog<LitComponentApi> {
  const base = v1BasicCatalog as unknown as Catalog<LitComponentApi>;
  const components = Array.from(base.components.values());
  const baseFunctions = Array.from(base.functions?.values() ?? []).map(fn =>
    fn.name === 'formatString' ? wrapFormatStringFn(fn) : fn,
  );
  const functions = [...baseFunctions, createIncrementCounterFn()];
  return new Catalog<LitComponentApi>(
    base.id,
    base.protocolVersion ?? '1.0',
    components,
    functions,
  );
}

function buildSecondaryCatalog(spec: SecondaryCatalogSpec): Catalog<LitComponentApi> {
  const components: LitComponentApi[] = [];
  const badgeSchema = z.object({
    badgeText: z.string().optional(),
  });
  for (const compName of Object.keys(spec.components)) {
    const tagName = `a2ui-conformance-${compName.toLowerCase()}`;
    let element = customElements.get(tagName) as CustomElementConstructor | undefined;
    if (!element) {
      class CustomBadgeElement extends A2uiLitElement<LitComponentApi> {
        override createRenderRoot() {
          return this;
        }
        protected override render() {
          const props = this.controller?.props as Record<string, unknown> | undefined;
          return html`<span class="a2ui-custom-badge">${String(props?.badgeText ?? '')}</span>`;
        }
      }
      element = CustomBadgeElement;
    }
    components.push({
      name: compName,
      tagName,
      element,
      schema: badgeSchema,
    });
  }
  return new Catalog<LitComponentApi>(
    spec.catalogId,
    (spec.protocolVersion ?? 'v1.0') as 'v1.0',
    components,
    [],
  );
}

function findDomElementByComponentId(
  container: HTMLElement,
  componentId: string,
): HTMLElement | undefined {
  const elements = Array.from(container.querySelectorAll('*'));
  for (const el of elements) {
    const a2uiEl = el as unknown as A2uiLitElement<LitComponentApi>;
    if (a2uiEl.context?.componentModel.id === componentId) {
      return el as HTMLElement;
    }
  }
  return undefined;
}

function getDirectChildNodes(
  node: ComponentNode<LitComponentApi>,
): Array<ComponentNode<LitComponentApi>> {
  const props = getValue(node.props);
  const childrenProp = props.children;
  if (Array.isArray(childrenProp)) {
    return childrenProp.filter(isComponentNode) as Array<ComponentNode<LitComponentApi>>;
  }
  const childProp = props.child;
  if (isComponentNode(childProp)) {
    return [childProp as ComponentNode<LitComponentApi>];
  }
  return [];
}

function findDomElementForNode(
  container: HTMLElement,
  target: ComponentNode<LitComponentApi>,
): HTMLElement | undefined {
  const elements = Array.from(container.querySelectorAll('*'));
  for (const el of elements) {
    const a2uiEl = el as unknown as {
      node?: ComponentNode<LitComponentApi>;
      context?: {componentModel: {id: string}; dataContext: {path: string}};
    };
    if (a2uiEl.node === target) {
      return el as HTMLElement;
    }
    if (
      a2uiEl.context?.componentModel.id === target.componentId &&
      a2uiEl.context?.dataContext.path === target.dataPath
    ) {
      return el as HTMLElement;
    }
  }
  return undefined;
}

function resolveIdentityElement(
  surfaceEl: A2uiSurface,
  identityPath: string,
): HTMLElement | undefined {
  if (identityPath === 'root') {
    return findDomElementByComponentId(surfaceEl, 'root');
  }
  const match = /^root\/children\/(\d+)$/.exec(identityPath);
  if (match && surfaceEl.rootNode) {
    const idx = Number(match[1]);
    const children = getDirectChildNodes(surfaceEl.rootNode);
    const targetNode = children[idx];
    return targetNode ? findDomElementForNode(surfaceEl, targetNode) : undefined;
  }
  return findDomElementByComponentId(surfaceEl, identityPath);
}

function snapshotViewIdentities(surfaceEl: A2uiSurface | undefined): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  if (!surfaceEl?.rootNode) {
    return map;
  }
  const rootEl = resolveIdentityElement(surfaceEl, 'root');
  if (rootEl) {
    map.set('root', rootEl);
  }
  const children = getDirectChildNodes(surfaceEl.rootNode);
  children.forEach((child, index) => {
    const childEl = findDomElementForNode(surfaceEl, child);
    if (childEl) {
      map.set(`root/children/${index}`, childEl);
    }
  });
  return map;
}

function unwrapProp(val: unknown): unknown {
  return val instanceof ResolvedBinding ? val.value : val;
}

function assertNodeScalarProps(
  surfaceEl: A2uiSurface,
  actual: ComponentNode<LitComponentApi>,
  expected: ExpectedViewNode,
): void {
  const props = getValue(actual.props);
  if (expected.text !== undefined) {
    assert.equal(unwrapProp(props.text), expected.text);
    const domEl = findDomElementForNode(surfaceEl, actual);
    assert.ok(domEl?.textContent?.includes(expected.text));
  }
  if (expected.value !== undefined) {
    assert.deepEqual(unwrapProp(props.value), expected.value);
  }
  if (expected.badgeText !== undefined) {
    assert.equal(unwrapProp(props.badgeText), expected.badgeText);
    const domEl = findDomElementForNode(surfaceEl, actual);
    assert.ok(domEl?.textContent?.includes(expected.badgeText));
  }
  if (expected.isValid !== undefined) {
    assert.equal(props.isValid, expected.isValid);
    const domEl = findDomElementForNode(surfaceEl, actual);
    const inputContainer = domEl?.querySelector('.a2ui-textfield');
    if (inputContainer) {
      assert.equal(inputContainer.classList.contains('a2ui-invalid'), !expected.isValid);
    }
  }
  if (expected.validationErrors !== undefined) {
    const actualErrors = props.validationErrors as string[] | undefined;
    assert.equal(actualErrors?.length, expected.validationErrors.length);
  }
  if (expected.validationResults !== undefined) {
    assert.deepEqual(props.validationResults, expected.validationResults);
  }
}

function assertExpectedViewTree(
  surfaceEl: A2uiSurface,
  actual: ComponentNode<LitComponentApi>,
  expected: ExpectedViewNode,
): void {
  assert.equal(actual.componentId, expected.id);
  if (expected.type !== undefined) {
    assert.equal(actual.type, expected.type);
  }
  if (expected.state !== undefined) {
    assert.equal(actual.state, expected.state);
  }
  if (actual.state === 'resolved') {
    const domEl = findDomElementForNode(surfaceEl, actual);
    assert.ok(domEl, `Expected mounted DOM element for "${actual.componentId}"`);
  }
  assertNodeScalarProps(surfaceEl, actual, expected);

  if (expected.children !== undefined) {
    const actualChildren = getDirectChildNodes(actual);
    assert.equal(
      actualChildren.length,
      expected.children.length,
      `Child count mismatch on "${actual.componentId}"`,
    );
    for (let i = 0; i < expected.children.length; i++) {
      assertExpectedViewTree(surfaceEl, actualChildren[i], expected.children[i]);
    }
  }
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
  return el.textContent?.trim() || undefined;
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

function assertAccessibilityNode(
  container: HTMLElement,
  componentId: string,
  expected: ExpectedAccessibilityNode,
): void {
  const el = findDomElementByComponentId(container, componentId);
  assert.ok(el, `Expected DOM element for component "${componentId}"`);

  if (expected.label !== undefined) {
    assert.equal(resolveAccessibleLabel(el), expected.label);
  }
  if (expected.description !== undefined) {
    assert.equal(el.getAttribute('aria-description'), expected.description);
  }
  if (expected.live !== undefined) {
    assert.equal(el.getAttribute('aria-live'), expected.live);
  }
  if (expected.hidden !== undefined) {
    assert.equal(el.getAttribute('aria-hidden'), String(expected.hidden));
  }
  if (expected.role !== undefined) {
    assert.equal(resolveSemanticRole(el), expected.role);
  }
  if (expected.checked !== undefined) {
    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    assert.equal(checkbox?.checked, expected.checked);
  }
}

function countActiveSurfaceSubscriptions(surface: SurfaceModel<LitComponentApi>): number {
  const onCreatedSize = (surface.componentsModel.onCreated as unknown as {listeners: Set<unknown>})
    .listeners.size;
  const onDeletedSize = (surface.componentsModel.onDeleted as unknown as {listeners: Set<unknown>})
    .listeners.size;
  const dataSubsSize = (surface.dataModel as unknown as {subscriptions: Map<string, Set<unknown>>})
    .subscriptions.size;
  return onCreatedSize + onDeletedSize + dataSubsSize;
}

async function ensureSurfaceMounted(
  session: AdapterSession,
  mountedElements: HTMLElement[],
): Promise<void> {
  if (session.surfaceEl) {
    return;
  }
  const surface =
    session.processor.model.getSurface('adapter_surface') ??
    session.processor.model.getSurface('a11y_surface');
  assert.ok(surface, 'Expected surface to exist in MessageProcessor');
  session.surface = surface;

  surface.onAction.subscribe(action => {
    session.recordedActions.push({
      name: action.name,
      surfaceId: action.surfaceId,
      sourceComponentId: action.sourceComponentId,
      context: action.context,
    });
  });
  surface.onError.subscribe(err => {
    session.recordedErrors.push({
      code: err.code,
      message: err.message,
      surfaceId: surface.id,
    });
  });

  const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
  mountedElements.push(el);
  document.body.appendChild(el);
  el.surface = surface;
  session.surfaceEl = el;
}

function performStepOperation(session: AdapterSession, step: AdapterStep): void {
  if (step.op === 'process_messages') {
    session.processor.processMessages(step.messages ?? []);
    return;
  }
  if (step.op === 'user_input' && session.surfaceEl && step.targetNode) {
    const hostEl = findDomElementByComponentId(session.surfaceEl, step.targetNode);
    const input = hostEl?.querySelector('input, textarea') as HTMLInputElement | undefined;
    assert.ok(input, `Expected input element inside "${step.targetNode}"`);
    input.value = String(step.inputValue ?? '');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    return;
  }
  if (step.op === 'user_gesture' && session.surfaceEl && step.targetNode) {
    const hostEl = findDomElementByComponentId(session.surfaceEl, step.targetNode);
    const btn = (hostEl?.querySelector('button') ?? hostEl) as HTMLElement | undefined;
    assert.ok(btn, `Expected clickable element for "${step.targetNode}"`);
    const origOpen = window.open;
    window.open = () => null;
    try {
      btn.click();
    } finally {
      window.open = origOpen;
    }
    return;
  }
  if (step.op === 'programmatic_invoke' && session.surfaceEl && step.targetNode) {
    const hostEl = findDomElementByComponentId(session.surfaceEl, step.targetNode) as unknown as
      | A2uiLitElement<LitComponentApi>
      | undefined;
    const rawAction = hostEl?.context?.componentModel.properties.action as
      | Record<string, unknown>
      | undefined;
    assert.ok(rawAction && hostEl?.context, `Expected action on "${step.targetNode}"`);
    hostEl.context.dataContext.resolveAction(rawAction, {
      userActivation: Boolean(step.userActivation),
    });
    return;
  }
  if (step.op === 'unmount_surface' && session.surfaceEl) {
    session.surfaceEl.remove();
  }
}

function assertSameViewIdentities(session: AdapterSession, identityPaths: string[]): void {
  if (!session.surfaceEl) {
    return;
  }
  for (const idPath of identityPaths) {
    const beforeEl = session.priorIdentities.get(idPath);
    const afterEl = resolveIdentityElement(session.surfaceEl, idPath);
    assert.ok(beforeEl && afterEl, `Missing view identity for "${idPath}"`);
    assert.equal(afterEl, beforeEl, `Expected view identity to be preserved for "${idPath}"`);
  }
}

function assertRecordedErrors(
  actualErrors: Array<{code: string; message: string; surfaceId: string}>,
  expectedErrors: ExpectedError[],
): void {
  assert.equal(actualErrors.length, expectedErrors.length);
  for (let i = 0; i < expectedErrors.length; i++) {
    const exp = expectedErrors[i];
    const act = actualErrors[i];
    if (exp.code !== undefined) {
      assert.equal(act.code, exp.code);
    }
    if (exp.surfaceId !== undefined) {
      assert.equal(act.surfaceId, exp.surfaceId);
    }
    if (exp.message !== undefined) {
      assert.ok(act.message.includes(exp.message));
    }
  }
}

function verifyStepExpectations(session: AdapterSession, step: AdapterStep): void {
  if (step.expectViewTree && session.surfaceEl?.rootNode) {
    assertExpectedViewTree(session.surfaceEl, session.surfaceEl.rootNode, step.expectViewTree);
  }
  if (step.expectDataModel && session.surface) {
    assert.deepEqual(session.surface.dataModel.get('/'), step.expectDataModel);
  }
  if (step.expectSameViewIdentity) {
    assertSameViewIdentities(session, step.expectSameViewIdentity);
  }
  if (step.expectActions !== undefined) {
    assert.deepEqual(session.recordedActions, step.expectActions);
  }
  if (step.expectErrors !== undefined) {
    assertRecordedErrors(session.recordedErrors, step.expectErrors);
  }
  if (step.expectAccessibilityTree && session.surfaceEl) {
    for (const [compId, expected] of Object.entries(step.expectAccessibilityTree)) {
      assertAccessibilityNode(session.surfaceEl, compId, expected);
    }
  }
  if (step.expectActiveSubscriptions !== undefined && session.surface) {
    assert.equal(countActiveSurfaceSubscriptions(session.surface), step.expectActiveSubscriptions);
  }
}

describe('@a2ui/lit Adapter & Accessibility Conformance', () => {
  const accessibilityCases = yaml.load(
    fs.readFileSync(path.join(CONFORMANCE_ROOT, 'accessibility.yaml'), 'utf8'),
  ) as AccessibilityTestCase[];
  const adapterCases = yaml.load(
    fs.readFileSync(path.join(CONFORMANCE_ROOT, 'adapter_conformance.yaml'), 'utf8'),
  ) as AdapterTestCase[];

  const mountedElements: HTMLElement[] = [];

  before(async () => {
    setupTestDom();
    await import('../surface/a2ui-surface.js');
  });

  afterEach(() => {
    while (mountedElements.length > 0) {
      mountedElements.pop()?.remove();
    }
  });

  after(() => {
    teardownTestDom();
  });

  describe('Accessibility Conformance (accessibility.yaml)', () => {
    for (const testCase of accessibilityCases) {
      it(`${testCase.name}: ${testCase.description ?? ''}`, async () => {
        const catalog = createAugmentedBasicCatalog();
        const session: AdapterSession = {
          processor: new MessageProcessor<LitComponentApi>([catalog]),
          recordedActions: [],
          recordedErrors: [],
          priorIdentities: new Map(),
        };
        const steps: AccessibilityStep[] = testCase.steps ?? [
          {
            messages: testCase.messages ?? [],
            assertions: testCase.assertions ?? {},
          },
        ];

        for (const step of steps) {
          session.processor.processMessages(step.messages);
          await ensureSurfaceMounted(session, mountedElements);
          await settleSurface(session.surfaceEl!);
          const tree = step.assertions.accessibilityTree ?? {};
          for (const [compId, expected] of Object.entries(tree)) {
            assertAccessibilityNode(session.surfaceEl!, compId, expected);
          }
        }
      });
    }
  });

  describe('Framework Adapter Conformance (adapter_conformance.yaml)', () => {
    for (const testCase of adapterCases) {
      it(`${testCase.name}: ${testCase.description ?? ''}`, async () => {
        const catalogs: Array<Catalog<LitComponentApi>> = [
          createAugmentedBasicCatalog(),
          ...(testCase.catalogs ?? []).map(buildSecondaryCatalog),
        ];
        const session: AdapterSession = {
          processor: new MessageProcessor<LitComponentApi>(catalogs),
          recordedActions: [],
          recordedErrors: [],
          priorIdentities: new Map(),
        };

        for (const step of testCase.steps) {
          session.recordedActions = [];
          session.recordedErrors = [];
          session.priorIdentities = snapshotViewIdentities(session.surfaceEl);

          if (step.op === 'process_messages' && !session.surfaceEl) {
            for (const msg of step.messages ?? []) {
              const record = msg as Record<string, unknown>;
              if ('createSurface' in record) {
                session.processor.processMessages([msg]);
                await ensureSurfaceMounted(session, mountedElements);
              } else {
                session.processor.processMessages([msg]);
              }
            }
          } else {
            performStepOperation(session, step);
          }

          if (session.surfaceEl && step.op !== 'unmount_surface') {
            await settleSurface(session.surfaceEl);
          }
          verifyStepExpectations(session, step);
        }
      });
    }
  });
});
