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

import {asyncUpdate} from './dom-setup.js';
import {html} from 'lit';
import {z} from 'zod';

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
import {A2uiClientMessageSchema} from '@a2ui/web_core/v0_9';
import {RendererToAgentMessageSchema} from '@a2ui/web_core/v1_0';

import type {A2uiSurface} from '../index.js';
import type {LitComponentApi} from '../types.js';

export interface ExpectedAccessibilityNode {
  label?: string;
  description?: string;
  live?: string;
  hidden?: boolean;
  role?: string;
  checked?: boolean;
}

export interface AccessibilityAssertions {
  accessibilityTree?: Record<string, ExpectedAccessibilityNode>;
  axeCore?: string[];
}

export interface AccessibilityStep {
  description?: string;
  messages: ProcessableMessage[];
  assertions: AccessibilityAssertions;
}

export interface AccessibilityTestCase {
  name: string;
  description?: string;
  features?: string[];
  protocolVersion?: string;
  action?: string;
  catalogPath?: string;
  surface?: Record<string, unknown>;
  messages?: ProcessableMessage[];
  assertions?: AccessibilityAssertions;
  steps?: AccessibilityStep[];
}

export interface ExpectedViewNode {
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

export interface ExpectedAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context?: Record<string, unknown>;
}

export interface ExpectedError {
  code?: string;
  surfaceId?: string;
  message?: string;
}

export interface AdapterStep {
  description?: string;
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
  expectOutbound?: Array<Record<string, unknown>>;
  expectAccessibilityTree?: Record<string, ExpectedAccessibilityNode>;
  expectActiveSubscriptions?: number;
}

export interface SecondaryCatalogSpec {
  catalogId: string;
  protocolVersion?: string;
  components: Record<string, unknown>;
}

export interface AdapterTestCase {
  name: string;
  description?: string;
  features?: string[];
  protocolVersion?: string;
  action?: string;
  catalogPaths?: string[];
  catalogs?: SecondaryCatalogSpec[];
  steps: AdapterStep[];
}

export interface AdapterSession {
  processor: MessageProcessor<LitComponentApi>;
  surface?: SurfaceModel<LitComponentApi>;
  surfaceEl?: A2uiSurface;
  mountedElements: HTMLElement[];
  recordedActions: ExpectedAction[];
  recordedErrors: Array<{code: string; message: string; surfaceId: string}>;
  recordedOutbound: Array<Record<string, unknown>>;
  protocolVersion: string;
  currentOp?: string;
  priorIdentities: Map<string, HTMLElement>;
}

export interface ManifestRecord {
  harness: string;
  suite: string;
  case: string;
  status: 'passed' | 'failed' | 'skipped' | 'xfailed';
  reason?: string;
}

/**
 * Reasoned skip entries keyed by `"<case>"` or `"<case>/<op|expectKey>"`.
 * Every entry in this map must match at least one case during the run.
 */
export const UNSUPPORTED: Record<string, string> = {};

const matchedUnsupportedKeys = new Set<string>();

export const KNOWN_KEYS = {
  adapterCase: new Set([
    'name',
    'description',
    'features',
    'action',
    'protocolVersion',
    'catalogPaths',
    'catalogs',
    'steps',
  ]),
  adapterCatalog: new Set(['catalogId', 'protocolVersion', 'components']),
  adapterStep: new Set([
    'description',
    'op',
    'messages',
    'targetNode',
    'inputValue',
    'userActivation',
    'expectViewTree',
    'expectAccessibilityTree',
    'expectDataModel',
    'expectActions',
    'expectErrors',
    'expectOutbound',
    'expectSameViewIdentity',
    'expectActiveSubscriptions',
  ]),
  adapterOps: new Set([
    'process_messages',
    'user_input',
    'user_gesture',
    'programmatic_invoke',
    'unmount_surface',
  ]),
  viewNode: new Set([
    'id',
    'type',
    'state',
    'text',
    'value',
    'badgeText',
    'isValid',
    'validationErrors',
    'validationResults',
    'children',
  ]),
  validationResult: new Set(['valid', 'code', 'message', 'severity']),
  expectedAction: new Set(['name', 'surfaceId', 'sourceComponentId', 'context']),
  expectedError: new Set(['code', 'surfaceId', 'message']),
  accessibilityCase: new Set([
    'name',
    'description',
    'features',
    'action',
    'protocolVersion',
    'catalogPath',
    'surface',
    'messages',
    'assertions',
    'steps',
  ]),
  accessibilityStep: new Set(['description', 'messages', 'assertions']),
  accessibilityAssertions: new Set(['accessibilityTree', 'axeCore']),
  accessibilityNode: new Set(['label', 'description', 'live', 'hidden', 'role', 'checked']),
} as const;

function assertObjectKeys(obj: unknown, allowed: ReadonlySet<string>, where: string): void {
  if (obj === undefined || obj === null) {
    return;
  }
  assert.ok(typeof obj === 'object' && !Array.isArray(obj), `${where}: expected object`);
  const unknown = Object.keys(obj as Record<string, unknown>).filter(key => !allowed.has(key));
  assert.deepEqual(
    unknown,
    [],
    `${where}: unknown keys: ${unknown.map(k => `${where}.${k}`).join(', ')}`,
  );
}

function assertKnownViewNodeKeys(node: unknown, where: string): void {
  if (node === undefined || node === null) {
    return;
  }
  assertObjectKeys(node, KNOWN_KEYS.viewNode, where);
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.validationResults)) {
    record.validationResults.forEach((item, idx) => {
      assertObjectKeys(item, KNOWN_KEYS.validationResult, `${where}.validationResults[${idx}]`);
    });
  }
  if (Array.isArray(record.children)) {
    record.children.forEach((child, idx) => {
      assertKnownViewNodeKeys(child, `${where}.children[${idx}]`);
    });
  }
}

export function assertKnownKeys(
  obj: unknown,
  allowed: ReadonlySet<string> = KNOWN_KEYS.adapterStep,
  where = 'step',
): void {
  assertObjectKeys(obj, allowed, where);
  if (allowed !== KNOWN_KEYS.adapterStep || !obj || typeof obj !== 'object') {
    return;
  }
  const step = obj as Record<string, unknown>;
  if (step.op !== undefined) {
    assert.ok(
      typeof step.op === 'string' && KNOWN_KEYS.adapterOps.has(step.op),
      `${where}.op: unsupported op "${String(step.op)}"`,
    );
  }
  if (step.expectViewTree !== undefined) {
    assertKnownViewNodeKeys(step.expectViewTree, `${where}.expectViewTree`);
  }
  if (step.expectAccessibilityTree !== undefined) {
    assert.ok(
      typeof step.expectAccessibilityTree === 'object' &&
        step.expectAccessibilityTree !== null &&
        !Array.isArray(step.expectAccessibilityTree),
      `${where}.expectAccessibilityTree: expected object`,
    );
    for (const [compId, node] of Object.entries(
      step.expectAccessibilityTree as Record<string, unknown>,
    )) {
      assertObjectKeys(
        node,
        KNOWN_KEYS.accessibilityNode,
        `${where}.expectAccessibilityTree.${compId}`,
      );
    }
  }
  if (step.expectActions !== undefined) {
    assert.ok(Array.isArray(step.expectActions), `${where}.expectActions: expected array`);
    step.expectActions.forEach((item, idx) => {
      assertObjectKeys(item, KNOWN_KEYS.expectedAction, `${where}.expectActions[${idx}]`);
    });
  }
  if (step.expectErrors !== undefined) {
    assert.ok(Array.isArray(step.expectErrors), `${where}.expectErrors: expected array`);
    step.expectErrors.forEach((item, idx) => {
      assertObjectKeys(item, KNOWN_KEYS.expectedError, `${where}.expectErrors[${idx}]`);
    });
  }
  if (step.expectOutbound !== undefined) {
    assert.ok(Array.isArray(step.expectOutbound), `${where}.expectOutbound: expected array`);
    step.expectOutbound.forEach((item, idx) => {
      assert.ok(
        typeof item === 'object' && item !== null && !Array.isArray(item),
        `${where}.expectOutbound[${idx}]: expected object`,
      );
      assert.equal(
        typeof (item as Record<string, unknown>).version,
        'string',
        `${where}.expectOutbound[${idx}].version: expected string`,
      );
    });
  }
}

export function assertKnownAdapterCase(testCase: AdapterTestCase): void {
  assertObjectKeys(testCase, KNOWN_KEYS.adapterCase, `case(${testCase.name})`);
  if (testCase.action !== undefined) {
    assert.equal(
      testCase.action,
      'render_surface',
      `case(${testCase.name}): unsupported action "${testCase.action}"`,
    );
  }
  for (const [idx, cat] of (testCase.catalogs ?? []).entries()) {
    assertObjectKeys(cat, KNOWN_KEYS.adapterCatalog, `case(${testCase.name}).catalogs[${idx}]`);
  }
  for (const [idx, step] of testCase.steps.entries()) {
    assertKnownKeys(step, KNOWN_KEYS.adapterStep, `case(${testCase.name}).steps[${idx}]`);
  }
}

export function assertKnownAccessibilityAssertions(
  assertions: AccessibilityAssertions | undefined,
  where: string,
): void {
  if (!assertions) {
    return;
  }
  assertObjectKeys(assertions, KNOWN_KEYS.accessibilityAssertions, where);
  for (const [compId, node] of Object.entries(assertions.accessibilityTree ?? {})) {
    assertObjectKeys(node, KNOWN_KEYS.accessibilityNode, `${where}.accessibilityTree.${compId}`);
  }
}

export function assertKnownAccessibilityCase(testCase: AccessibilityTestCase): void {
  assertObjectKeys(testCase, KNOWN_KEYS.accessibilityCase, `case(${testCase.name})`);
  if (testCase.action !== undefined) {
    assert.equal(
      testCase.action,
      'accessibility_check',
      `case(${testCase.name}): unsupported action "${testCase.action}"`,
    );
  }
  assertKnownAccessibilityAssertions(testCase.assertions, `case(${testCase.name}).assertions`);
  for (const [idx, step] of (testCase.steps ?? []).entries()) {
    assertObjectKeys(step, KNOWN_KEYS.accessibilityStep, `case(${testCase.name}).steps[${idx}]`);
    assertKnownAccessibilityAssertions(
      step.assertions,
      `case(${testCase.name}).steps[${idx}].assertions`,
    );
  }
}

export function findUnsupportedReason(
  caseName: string,
  steps: Array<Record<string, unknown>> = [],
): string | undefined {
  if (Object.hasOwn(UNSUPPORTED, caseName)) {
    matchedUnsupportedKeys.add(caseName);
    return UNSUPPORTED[caseName];
  }
  for (const step of steps) {
    const op = typeof step.op === 'string' ? step.op : undefined;
    if (op) {
      const opKey = `${caseName}/${op}`;
      if (Object.hasOwn(UNSUPPORTED, opKey)) {
        matchedUnsupportedKeys.add(opKey);
        return UNSUPPORTED[opKey];
      }
    }
    for (const key of Object.keys(step)) {
      const stepKey = `${caseName}/${key}`;
      if (Object.hasOwn(UNSUPPORTED, stepKey)) {
        matchedUnsupportedKeys.add(stepKey);
        return UNSUPPORTED[stepKey];
      }
    }
    const assertions = step.assertions;
    if (assertions && typeof assertions === 'object' && !Array.isArray(assertions)) {
      for (const key of Object.keys(assertions as Record<string, unknown>)) {
        const assertionKey = `${caseName}/${key}`;
        if (Object.hasOwn(UNSUPPORTED, assertionKey)) {
          matchedUnsupportedKeys.add(assertionKey);
          return UNSUPPORTED[assertionKey];
        }
      }
    }
  }
  return undefined;
}

export function assertAllUnsupportedMatched(): void {
  const unused = Object.keys(UNSUPPORTED).filter(key => !matchedUnsupportedKeys.has(key));
  assert.deepEqual(
    unused,
    [],
    `Unused UNSUPPORTED entries did not match any executed case: ${unused.join(', ')}`,
  );
}

export function writeManifestRecord(rec: ManifestRecord): void {
  const manifestDir = process.env.A2UI_CONFORMANCE_MANIFEST_DIR;
  if (!manifestDir) {
    return;
  }
  fs.mkdirSync(manifestDir, {recursive: true});
  const filePath = path.join(manifestDir, `${rec.harness}-${process.pid}.jsonl`);
  const payload: Record<string, string> = {
    harness: rec.harness,
    suite: rec.suite.replaceAll('\\', '/'),
    case: rec.case,
    status: rec.status,
  };
  if (rec.reason) {
    payload.reason = rec.reason;
  }
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

export async function settleSurface(root: HTMLElement): Promise<void> {
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

export function createAugmentedBasicCatalog(): Catalog<LitComponentApi> {
  const base = v1BasicCatalog as unknown as Catalog<LitComponentApi>;
  const components = Array.from(base.components.values());
  const functions = [...Array.from(base.functions?.values() ?? []), createIncrementCounterFn()];
  return new Catalog<LitComponentApi>(
    base.id,
    base.protocolVersion ?? '1.0',
    components,
    functions,
  );
}

export function buildSecondaryCatalog(spec: SecondaryCatalogSpec): Catalog<LitComponentApi> {
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
  surfaceEl: A2uiSurface | undefined,
  actual: ComponentNode<LitComponentApi>,
  expected: ExpectedViewNode,
): void {
  const props = getValue(actual.props);
  if (expected.text !== undefined) {
    assert.equal(unwrapProp(props.text), expected.text);
    if (surfaceEl) {
      const domEl = findDomElementForNode(surfaceEl, actual);
      assert.ok(domEl?.textContent?.includes(expected.text));
    }
  }
  if (expected.value !== undefined) {
    assert.deepEqual(unwrapProp(props.value), expected.value);
  }
  if (expected.badgeText !== undefined) {
    assert.equal(unwrapProp(props.badgeText), expected.badgeText);
    if (surfaceEl) {
      const domEl = findDomElementForNode(surfaceEl, actual);
      assert.ok(domEl?.textContent?.includes(expected.badgeText));
    }
  }
  if (expected.isValid !== undefined) {
    assert.equal(props.isValid, expected.isValid);
    if (surfaceEl) {
      const domEl = findDomElementForNode(surfaceEl, actual);
      const inputContainer = domEl?.querySelector('.a2ui-textfield');
      if (inputContainer) {
        assert.equal(inputContainer.classList.contains('a2ui-invalid'), !expected.isValid);
      }
    }
  }
  if (expected.validationErrors !== undefined) {
    const actualErrors = props.validationErrors as string[] | undefined;
    assert.deepEqual(actualErrors, expected.validationErrors);
  }
  if (expected.validationResults !== undefined) {
    assert.deepEqual(props.validationResults, expected.validationResults);
  }
}

export function extractViewTree(
  session: AdapterSession,
): ComponentNode<LitComponentApi> | undefined {
  return session.surfaceEl?.rootNode;
}

export function assertViewTree(
  actual: ComponentNode<LitComponentApi> | undefined,
  expected: ExpectedViewNode,
  surfaceEl?: A2uiSurface,
): void {
  assert.ok(actual, `Expected view node for "${expected.id}"`);
  const resolvedSurfaceEl =
    surfaceEl ??
    (document.body.querySelector('a2ui-surface') as unknown as A2uiSurface | undefined);
  assert.equal(actual.componentId, expected.id);
  if (expected.type !== undefined) {
    assert.equal(actual.type, expected.type);
  }
  if (expected.state !== undefined) {
    assert.equal(actual.state, expected.state);
  }
  if (actual.state === 'resolved' && resolvedSurfaceEl) {
    const domEl = findDomElementForNode(resolvedSurfaceEl, actual);
    assert.ok(domEl, `Expected mounted DOM element for "${actual.componentId}"`);
  }
  assertNodeScalarProps(resolvedSurfaceEl, actual, expected);

  if (expected.children !== undefined) {
    const actualChildren = getDirectChildNodes(actual);
    assert.equal(
      actualChildren.length,
      expected.children.length,
      `Child count mismatch on "${actual.componentId}"`,
    );
    for (let i = 0; i < expected.children.length; i++) {
      assertViewTree(actualChildren[i], expected.children[i], resolvedSurfaceEl);
    }
  }
}

function isNestedComponentElement(host: HTMLElement, candidate: Element): boolean {
  let current: Element | null = candidate;
  while (current && current !== host) {
    const a2uiEl = current as unknown as {context?: unknown; node?: unknown};
    if (a2uiEl.context || a2uiEl.node) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function resolveOwnAttribute(el: HTMLElement, attr: string): string | undefined {
  const hostValue = el.getAttribute(attr);
  if (hostValue) {
    return hostValue;
  }
  for (const descendant of Array.from(el.querySelectorAll(`[${attr}]`))) {
    if (
      !isNestedComponentElement(el, descendant) &&
      !descendant.matches('.a2ui-filter-input, .a2ui-modal-close')
    ) {
      const value = descendant.getAttribute(attr);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function resolveAccessibleLabel(el: HTMLElement): string | undefined {
  const explicit = resolveOwnAttribute(el, 'aria-label');
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

export function assertAccessibilityNode(
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
    assert.equal(resolveOwnAttribute(el, 'aria-description'), expected.description);
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

export function assertAxeRules(container: HTMLElement, rules: string[]): void {
  if (rules.includes('button-name')) {
    const buttons = Array.from(container.querySelectorAll('button'));
    for (const btn of buttons) {
      const host = btn.closest('a2ui-basic-button') as HTMLElement | null;
      const name =
        btn.getAttribute('aria-label') ||
        host?.getAttribute('aria-label') ||
        btn.textContent?.trim();
      assert.ok(name, 'Expected accessible name on rendered button');
    }
  }
  if (rules.includes('aria-valid-attr-value')) {
    const liveNodes = Array.from(container.querySelectorAll('[aria-live]'));
    for (const node of liveNodes) {
      const val = node.getAttribute('aria-live');
      assert.ok(
        val !== null && ['off', 'polite', 'assertive'].includes(val),
        `Invalid aria-live attribute value: ${String(val)}`,
      );
    }
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

function frameActionEnvelope(
  action: Record<string, unknown>,
  protocolVersion: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: action.name,
    surfaceId: action.surfaceId,
    sourceComponentId: action.sourceComponentId,
    timestamp: action.timestamp,
    context: action.context ?? {},
  };
  if (action.userMessage !== undefined) {
    payload.userMessage = action.userMessage;
  }
  if (action.metadata !== undefined) {
    payload.metadata = action.metadata;
  }
  return {
    version: protocolVersion,
    action: payload,
  };
}

function frameErrorEnvelope(
  err: Record<string, unknown>,
  surfaceId: string,
  protocolVersion: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    code: err.code,
    surfaceId: typeof err.surfaceId === 'string' ? err.surfaceId : surfaceId,
    message: err.message,
  };
  if (typeof err.path === 'string') {
    payload.path = err.path;
  }
  if (typeof err.functionCallId === 'string') {
    payload.functionCallId = err.functionCallId;
  }
  return {
    version: protocolVersion,
    error: payload,
  };
}

function isMatchAny(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length === 1 && (value as Record<string, unknown>)['$match'] === 'any';
}

function assertMatchesExpectedOutbound(actual: unknown, expected: unknown, where: string): void {
  if (isMatchAny(expected)) {
    assert.ok(
      actual !== undefined && actual !== null,
      `${where}: expected defined non-null value for {$match: "any"}`,
    );
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected array`);
    assert.equal(actual.length, expected.length, `${where}: array length mismatch`);
    for (let i = 0; i < expected.length; i++) {
      assertMatchesExpectedOutbound(actual[i], expected[i], `${where}[${i}]`);
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
    assert.deepEqual(actualKeys, expectedKeys, `${where}: object keys mismatch`);
    for (const key of expectedKeys) {
      assertMatchesExpectedOutbound(actualRecord[key], expectedRecord[key], `${where}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, `${where}: value mismatch`);
}

function validateOutboundEnvelopes(
  envelopes: Array<Record<string, unknown>>,
  protocolVersion: string,
): void {
  const isV09 = protocolVersion.startsWith('v0.9') || protocolVersion.startsWith('0.9');
  for (let i = 0; i < envelopes.length; i++) {
    const env = envelopes[i];
    const parsed = isV09
      ? A2uiClientMessageSchema.safeParse(env)
      : RendererToAgentMessageSchema.safeParse(env);
    assert.ok(
      parsed.success,
      `recordedOutbound[${i}] failed protocol schema validation: ${
        parsed.success ? '' : JSON.stringify(parsed.error.issues)
      }`,
    );
  }
}

function assertExpectedOutbound(
  actual: Array<Record<string, unknown>>,
  expected: Array<Record<string, unknown>>,
): void {
  assert.equal(
    actual.length,
    expected.length,
    `expectOutbound length mismatch: actual=${actual.length}, expected=${expected.length}`,
  );
  for (let i = 0; i < expected.length; i++) {
    assertMatchesExpectedOutbound(actual[i], expected[i], `expectOutbound[${i}]`);
  }
}

export async function ensureSurfaceMounted(
  session: AdapterSession,
  mountedElements: HTMLElement[] = session.mountedElements,
): Promise<void> {
  if (session.surfaceEl) {
    return;
  }
  const surface =
    session.processor.model.getSurface('adapter_surface') ??
    session.processor.model.getSurface('a11y_surface') ??
    session.processor.model.surfacesMap.values().next().value;
  assert.ok(surface, 'Expected surface to exist in MessageProcessor');
  session.surface = surface;

  surface.onAction.subscribe(action => {
    session.recordedActions.push({
      name: action.name,
      surfaceId: action.surfaceId,
      sourceComponentId: action.sourceComponentId,
      context: action.context,
    });
    session.recordedOutbound.push(
      frameActionEnvelope(action as unknown as Record<string, unknown>, session.protocolVersion),
    );
  });
  surface.onError.subscribe(err => {
    session.recordedErrors.push({
      code: err.code,
      message: err.message,
      surfaceId: surface.id,
    });
    if (session.currentOp !== 'programmatic_invoke') {
      session.recordedOutbound.push(
        frameErrorEnvelope(
          err as unknown as Record<string, unknown>,
          surface.id,
          session.protocolVersion,
        ),
      );
    }
  });

  const el = document.createElement('a2ui-surface') as unknown as A2uiSurface;
  mountedElements.push(el);
  if (mountedElements !== session.mountedElements) {
    session.mountedElements.push(el);
  }
  document.body.appendChild(el);
  el.surface = surface;
  session.surfaceEl = el;
}

function performStepOperation(session: AdapterSession, step: AdapterStep): void {
  switch (step.op) {
    case 'process_messages':
      session.processor.processMessages(step.messages ?? []);
      return;
    case 'user_input': {
      assert.ok(session.surfaceEl && step.targetNode, 'Expected surfaceEl and targetNode');
      const hostEl = findDomElementByComponentId(session.surfaceEl, step.targetNode);
      const input = hostEl?.querySelector('input, textarea') as HTMLInputElement | undefined;
      assert.ok(input, `Expected input element inside "${step.targetNode}"`);
      input.value = String(step.inputValue ?? '');
      input.dispatchEvent(new Event('input', {bubbles: true}));
      return;
    }
    case 'user_gesture': {
      assert.ok(session.surfaceEl && step.targetNode, 'Expected surfaceEl and targetNode');
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
    case 'programmatic_invoke': {
      assert.ok(session.surfaceEl && step.targetNode, 'Expected surfaceEl and targetNode');
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
    case 'unmount_surface':
      session.surfaceEl?.remove();
      return;
    default:
      assert.fail(`Unsupported adapter step op: ${String(step.op)}`);
  }
}

function assertSameViewIdentities(session: AdapterSession, identityPaths: string[]): void {
  assert.ok(session.surfaceEl, 'Expected mounted surfaceEl for view identity check');
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
  if (step.expectViewTree) {
    const actualRoot = extractViewTree(session);
    assertViewTree(actualRoot, step.expectViewTree, session.surfaceEl);
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
  validateOutboundEnvelopes(session.recordedOutbound, session.protocolVersion);
  if (step.expectOutbound !== undefined) {
    assertExpectedOutbound(session.recordedOutbound, step.expectOutbound);
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

export function mountSurface(
  caseSpec?: Partial<AdapterTestCase>,
  mountedElements: HTMLElement[] = [],
): AdapterSession {
  const catalogs: Array<Catalog<LitComponentApi>> = [
    createAugmentedBasicCatalog(),
    ...(caseSpec?.catalogs ?? []).map(buildSecondaryCatalog),
  ];
  const recordedOutbound: Array<Record<string, unknown>> = [];
  const protocolVersion = caseSpec?.protocolVersion ?? '1.0';
  const processor = new MessageProcessor<LitComponentApi>(catalogs, undefined, {
    outboundListener: msg => {
      recordedOutbound.push(structuredClone(msg) as unknown as Record<string, unknown>);
    },
  });
  return {
    processor,
    mountedElements,
    recordedActions: [],
    recordedErrors: [],
    recordedOutbound,
    protocolVersion,
    priorIdentities: new Map(),
  };
}

export async function runStep(session: AdapterSession, step: AdapterStep): Promise<void> {
  assertKnownKeys(step);
  session.recordedActions = [];
  session.recordedErrors = [];
  session.recordedOutbound.length = 0;
  session.currentOp = step.op;
  session.priorIdentities = snapshotViewIdentities(session.surfaceEl);

  if (step.op === 'process_messages' && !session.surfaceEl) {
    for (const msg of step.messages ?? []) {
      const record = msg as Record<string, unknown>;
      if ('createSurface' in record) {
        session.processor.processMessages([msg]);
        await ensureSurfaceMounted(session, session.mountedElements);
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
