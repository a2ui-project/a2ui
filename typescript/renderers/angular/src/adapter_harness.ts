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

import {ChangeDetectionStrategy, Component, computed} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {
  CommonSchemas,
  type ComponentNode,
  createFunctionImplementation,
  isComponentNode,
  peekValue,
  type ProcessableMessage,
  ResolvedBinding,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import type {A2uiWebComponentElement} from '@a2ui/web_core/v0_9/universal';
import {z} from 'zod';
import {
  A2uiRendererService,
  AngularCatalog,
  type AngularComponentImplementation,
  type AnyDuringSchemaAlignment,
  BasicCatalogBase,
  CatalogComponent,
  SurfaceComponent,
  createComponentImplementation,
  provideA2UI,
} from './public-api';

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
  protocolVersion: string;
  action: string;
  catalogPath?: string;
  surface?: Record<string, unknown>;
  messages?: ProcessableMessage[];
  assertions?: AccessibilityAssertions;
  steps?: AccessibilityStep[];
}

export interface ExpectedViewNode {
  id?: string;
  type?: string;
  state?: string;
  isValid?: boolean;
  validationErrors?: string[];
  validationResults?: Array<Record<string, unknown>>;
  children?: ExpectedViewNode[];
  [key: string]: unknown;
}

export interface ExpectedActionEvent {
  name: string;
  surfaceId?: string;
  sourceComponentId?: string;
  context?: Record<string, unknown>;
}

export interface ExpectedErrorEntry {
  code?: string;
  surfaceId?: string;
  message?: string;
}

export interface ExtraCatalogEntry {
  catalogId: string;
  protocolVersion?: string;
  components: Record<
    string,
    {
      type: string;
      required?: string[];
      properties?: Record<string, {type?: string; const?: string; $ref?: string}>;
    }
  >;
}

export interface AdapterStep {
  description?: string;
  op?:
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
  expectAccessibilityTree?: Record<string, ExpectedAccessibilityNode>;
  expectDataModel?: Record<string, unknown>;
  expectActions?: ExpectedActionEvent[];
  expectErrors?: ExpectedErrorEntry[];
  expectSameViewIdentity?: string[];
  expectActiveSubscriptions?: number;
}

export interface AdapterTestCase {
  name: string;
  description?: string;
  features?: string[];
  protocolVersion: string;
  action: string;
  catalogPaths?: string[];
  catalogs?: ExtraCatalogEntry[];
  steps: AdapterStep[];
}

export interface KarmaConformanceConfig {
  accessibility: AccessibilityTestCase[];
  adapterConformance: AdapterTestCase[];
  basicCatalogJson: Record<string, unknown>;
}

export interface HarnessState {
  rendererService: A2uiRendererService;
  surface?: SurfaceModel<AngularComponentImplementation>;
  fixture?: ComponentFixture<SurfaceComponent>;
  unmounted: boolean;
  actions: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
  previousNodes: Map<string, ComponentNode>;
  previousDomElements: Map<string, HTMLElement>;
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
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`${where}: expected object`);
  }
  const unknown = Object.keys(obj as Record<string, unknown>).filter(key => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${where}: unknown keys: ${unknown.map(k => `${where}.${k}`).join(', ')}`);
  }
}

function assertKnownViewNodeKeys(node: unknown, where: string): void {
  if (node === undefined || node === null) {
    return;
  }
  assertObjectKeys(node, KNOWN_KEYS.viewNode, where);
  const record = node as Record<string, unknown>;
  if (Array.isArray(record['validationResults'])) {
    record['validationResults'].forEach((item, idx) => {
      assertObjectKeys(item, KNOWN_KEYS.validationResult, `${where}.validationResults[${idx}]`);
    });
  }
  if (Array.isArray(record['children'])) {
    record['children'].forEach((child, idx) => {
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
  if (step['op'] !== undefined) {
    if (typeof step['op'] !== 'string' || !KNOWN_KEYS.adapterOps.has(step['op'])) {
      throw new Error(`${where}.op: unsupported op "${String(step['op'])}"`);
    }
  }
  if (step['expectViewTree'] !== undefined) {
    assertKnownViewNodeKeys(step['expectViewTree'], `${where}.expectViewTree`);
  }
  if (step['expectAccessibilityTree'] !== undefined) {
    if (
      typeof step['expectAccessibilityTree'] !== 'object' ||
      step['expectAccessibilityTree'] === null ||
      Array.isArray(step['expectAccessibilityTree'])
    ) {
      throw new Error(`${where}.expectAccessibilityTree: expected object`);
    }
    for (const [compId, node] of Object.entries(
      step['expectAccessibilityTree'] as Record<string, unknown>,
    )) {
      assertObjectKeys(
        node,
        KNOWN_KEYS.accessibilityNode,
        `${where}.expectAccessibilityTree.${compId}`,
      );
    }
  }
  if (step['expectActions'] !== undefined) {
    if (!Array.isArray(step['expectActions'])) {
      throw new Error(`${where}.expectActions: expected array`);
    }
    (step['expectActions'] as unknown[]).forEach((item, idx) => {
      assertObjectKeys(item, KNOWN_KEYS.expectedAction, `${where}.expectActions[${idx}]`);
    });
  }
  if (step['expectErrors'] !== undefined) {
    if (!Array.isArray(step['expectErrors'])) {
      throw new Error(`${where}.expectErrors: expected array`);
    }
    (step['expectErrors'] as unknown[]).forEach((item, idx) => {
      assertObjectKeys(item, KNOWN_KEYS.expectedError, `${where}.expectErrors[${idx}]`);
    });
  }
}

export function assertKnownAdapterCase(testCase: AdapterTestCase): void {
  assertObjectKeys(testCase, KNOWN_KEYS.adapterCase, `case(${testCase.name})`);
  if (testCase.action !== 'render_surface') {
    throw new Error(`case(${testCase.name}): unsupported action "${testCase.action}"`);
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
  if (testCase.action !== 'accessibility_check') {
    throw new Error(`case(${testCase.name}): unsupported action "${testCase.action}"`);
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
    const op = typeof step['op'] === 'string' ? step['op'] : undefined;
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
    const assertions = step['assertions'];
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
  if (unused.length > 0) {
    throw new Error(
      `Unused UNSUPPORTED entries did not match any executed case: ${unused.join(', ')}`,
    );
  }
}

export function writeManifestRecord(rec: ManifestRecord): void {
  const karma = (
    window as unknown as {
      __karma__?: {info?: (payload: {conformanceManifestRecord: ManifestRecord}) => void};
    }
  ).__karma__;
  karma?.info?.({conformanceManifestRecord: rec});
}

const RESERVED_VIEW_KEYS = new Set([
  'id',
  'type',
  'state',
  'isValid',
  'validationErrors',
  'validationResults',
  'children',
]);

const INTERNAL_PROP_KEYS = new Set(['isValid', 'validationErrors', 'validationResults']);

@Component({
  selector: 'a2ui-conformance-custom-widget',
  standalone: true,
  template: `<span class="a2ui-conformance-custom-widget">{{ renderedText() }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ConformanceCustomWidgetComponent extends CatalogComponent<AnyDuringSchemaAlignment> {
  readonly renderedText = computed(() => {
    const entries = Object.entries(this.props());
    const parts: string[] = [];
    for (const [key, prop] of entries) {
      if (INTERNAL_PROP_KEYS.has(key)) {
        continue;
      }
      const val = prop?.value?.();
      if (typeof val === 'string' || typeof val === 'number') {
        parts.push(String(val));
      }
    }
    return parts.join(' ');
  });
}

function decodeConformanceSuites(raw: KarmaConformanceConfig | string): KarmaConformanceConfig {
  if (typeof raw !== 'string') {
    return raw;
  }
  const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as KarmaConformanceConfig;
}

export function getConformanceSuites(): KarmaConformanceConfig {
  const karma = (
    window as unknown as {
      __karma__?: {config?: {conformanceSuites?: KarmaConformanceConfig | string}};
    }
  ).__karma__;
  const suites = karma?.config?.conformanceSuites;
  if (!suites) {
    throw new Error(
      'Conformance suites were not injected into __karma__.config.conformanceSuites.',
    );
  }
  return decodeConformanceSuites(suites);
}

export function createDefaultAdapterCatalog(): AngularCatalog {
  const incrementCounter = createFunctionImplementation(
    {
      name: 'incrementCounter',
      returnType: 'void',
      schema: z.object({
        path: z.string().optional(),
        step: z.number().optional(),
        amount: z.number().optional(),
      }),
    },
    (args, context) => {
      const targetPath = args.path ?? '/counter';
      const delta = args.amount ?? args.step ?? 1;
      const current = Number(context.dataModel.get(targetPath) ?? 0);
      context.dataModel.set(targetPath, current + delta);
    },
  );
  return new BasicCatalogBase({
    functions: [...Array.from(basicCatalog.functions.values()), incrementCounter],
  });
}

export function buildExtraCatalog(entry: ExtraCatalogEntry): AngularCatalog {
  const implementations = Object.entries(entry.components).map(([name, def]) => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [propKey, propSchema] of Object.entries(def.properties ?? {})) {
      if (propKey === 'component') {
        continue;
      }
      shape[propKey] =
        propSchema.type === 'number'
          ? CommonSchemas.DynamicNumber.optional()
          : CommonSchemas.DynamicString.optional();
    }
    return createComponentImplementation(
      {name, schema: z.object(shape)},
      ConformanceCustomWidgetComponent,
    );
  });
  return new AngularCatalog(entry.catalogId, entry.protocolVersion ?? '1.0', implementations);
}

export async function settleSurfaceDom(fixture: ComponentFixture<SurfaceComponent>): Promise<void> {
  const container = fixture.nativeElement as HTMLElement;
  for (let pass = 0; pass < 4; pass++) {
    TestBed.flushEffects();
    fixture.detectChanges();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const elements = Array.from(container.querySelectorAll('*'));
    for (const el of elements) {
      const litEl = el as unknown as {updateComplete?: Promise<boolean>};
      if (litEl.updateComplete) {
        await litEl.updateComplete;
      }
    }
  }
  TestBed.flushEffects();
  fixture.detectChanges();
}

function findComponentElement(
  container: HTMLElement,
  componentId: string,
): HTMLElement | undefined {
  const candidates = Array.from(container.querySelectorAll('*'));
  for (const candidate of candidates) {
    const a2uiEl = candidate as unknown as A2uiWebComponentElement;
    if (
      a2uiEl.context?.componentModel?.id === componentId ||
      a2uiEl.node?.componentId === componentId
    ) {
      return candidate as HTMLElement;
    }
  }
  return undefined;
}

function getRootComponentNode(container: HTMLElement): ComponentNode | undefined {
  const host = container.querySelector('a2ui-v09-component-host');
  const first = host?.firstElementChild as A2uiWebComponentElement | null | undefined;
  return first?.node;
}

function extractDirectChildNodes(node: ComponentNode): ComponentNode[] {
  const props = peekValue(node.props);
  if (Array.isArray(props['children'])) {
    return props['children'].filter(isComponentNode);
  }
  if (isComponentNode(props['child'])) {
    return [props['child']];
  }
  return [];
}

function collectMountedNodes(root: ComponentNode | undefined): Map<string, ComponentNode> {
  const nodes = new Map<string, ComponentNode>();
  if (!root) {
    return nodes;
  }
  const visit = (node: ComponentNode, nodePath: string): void => {
    nodes.set(nodePath, node);
    const props = peekValue(node.props);
    if (Array.isArray(props['children'])) {
      props['children'].forEach((child, i) => {
        if (isComponentNode(child)) {
          visit(child, `${nodePath}/children/${i}`);
        }
      });
    } else if (isComponentNode(props['child'])) {
      visit(props['child'], `${nodePath}/child`);
    }
  };
  visit(root, 'root');
  return nodes;
}

function unwrapBindingValue(value: unknown): unknown {
  if (value instanceof ResolvedBinding) {
    return unwrapBindingValue(value.value);
  }
  if (Array.isArray(value)) {
    return value.map(unwrapBindingValue);
  }
  return value;
}

function resolveNodeType(
  node: ComponentNode,
  surface?: SurfaceModel<AngularComponentImplementation>,
): string {
  if (node.state === 'cyclic' && node.type === 'Placeholder' && surface) {
    return surface.componentsModel.get(node.componentId)?.type ?? node.type;
  }
  return node.type;
}

function assertViewNodeProps(
  node: ComponentNode,
  expected: ExpectedViewNode,
  nodePath: string,
): void {
  const props = peekValue(node.props);
  if (expected.isValid !== undefined) {
    expect(unwrapBindingValue(props['isValid']))
      .withContext(`${nodePath}.isValid`)
      .toBe(expected.isValid);
  }
  if (expected.validationErrors !== undefined) {
    expect(unwrapBindingValue(props['validationErrors']))
      .withContext(`${nodePath}.validationErrors`)
      .toEqual(expected.validationErrors);
  }
  if (expected.validationResults !== undefined) {
    expect(unwrapBindingValue(props['validationResults']))
      .withContext(`${nodePath}.validationResults`)
      .toEqual(expected.validationResults);
  }
  for (const [key, expectedVal] of Object.entries(expected)) {
    if (!RESERVED_VIEW_KEYS.has(key)) {
      expect(unwrapBindingValue(props[key])).withContext(`${nodePath}.${key}`).toEqual(expectedVal);
    }
  }
}

function findDomElementForNode(
  container: HTMLElement,
  node: ComponentNode,
): HTMLElement | undefined {
  const match = Array.from(container.querySelectorAll('*')).find(
    el => (el as A2uiWebComponentElement).node === node,
  );
  return match as HTMLElement | undefined;
}

export function extractViewTree(state: HarnessState): ComponentNode | undefined {
  if (!state.fixture || state.unmounted) {
    return undefined;
  }
  const container = state.fixture.nativeElement as HTMLElement;
  return getRootComponentNode(container);
}

export function assertViewTree(
  node: ComponentNode | undefined,
  expected: ExpectedViewNode,
  surface?: SurfaceModel<AngularComponentImplementation>,
  container?: HTMLElement,
  nodePath = 'root',
): void {
  expect(node).withContext(`Missing node at ${nodePath}`).toBeDefined();
  const actual = node!;
  if (expected.id !== undefined) {
    expect(actual.componentId).withContext(`${nodePath}.id`).toBe(expected.id);
  }
  if (expected.type !== undefined) {
    expect(resolveNodeType(actual, surface)).withContext(`${nodePath}.type`).toBe(expected.type);
  }
  if (expected.state !== undefined) {
    expect(actual.state).withContext(`${nodePath}.state`).toBe(expected.state);
  }
  if (actual.state === 'resolved' && container) {
    const domEl = findDomElementForNode(container, actual);
    expect(domEl).withContext(`Expected a mounted DOM element for ${nodePath}`).toBeDefined();
    for (const key of ['text', 'badgeText'] as const) {
      const expectedText = expected[key];
      if (typeof expectedText === 'string') {
        expect(domEl!.textContent)
          .withContext(`${nodePath}.${key} rendered text`)
          .toContain(expectedText);
      }
    }
  }
  assertViewNodeProps(actual, expected, nodePath);
  if (expected.children !== undefined) {
    const childNodes = extractDirectChildNodes(actual);
    expect(childNodes.length)
      .withContext(`${nodePath}.children length`)
      .toBe(expected.children.length);
    expected.children.forEach((expectedChild, idx) => {
      assertViewTree(
        childNodes[idx],
        expectedChild,
        surface,
        container,
        `${nodePath}/children/${idx}`,
      );
    });
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
  const buttonText = el.querySelector('button')?.textContent?.trim();
  if (buttonText) {
    return buttonText;
  }
  const labelText = el.querySelector('label')?.textContent?.trim();
  if (labelText) {
    return labelText;
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
  const textInput = el.querySelector(
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea',
  );
  return textInput ? 'textbox' : undefined;
}

function resolveCheckedState(el: HTMLElement): boolean | undefined {
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked === 'true' || ariaChecked === 'false') {
    return ariaChecked === 'true';
  }
  const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  return checkbox ? checkbox.checked : undefined;
}

export function assertNodeAccessibility(
  container: HTMLElement,
  componentId: string,
  expected: ExpectedAccessibilityNode,
): void {
  const el = findComponentElement(container, componentId);
  expect(el).withContext(`Expected rendered DOM element for "${componentId}"`).toBeDefined();
  const target = el!;
  if (expected.label !== undefined) {
    expect(resolveAccessibleLabel(target)).toBe(expected.label);
  }
  if (expected.description !== undefined) {
    expect(resolveOwnAttribute(target, 'aria-description')).toBe(expected.description);
  }
  if (expected.live !== undefined) {
    expect(target.getAttribute('aria-live')).toBe(expected.live);
  }
  if (expected.hidden !== undefined) {
    expect(target.getAttribute('aria-hidden')).toBe(String(expected.hidden));
  }
  if (expected.role !== undefined) {
    expect(resolveSemanticRole(target)).toBe(expected.role);
  }
  if (expected.checked !== undefined) {
    expect(resolveCheckedState(target)).toBe(expected.checked);
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
      expect(Boolean(name)).toBe(true);
    }
  }
  if (rules.includes('aria-valid-attr-value')) {
    const liveNodes = Array.from(container.querySelectorAll('[aria-live]'));
    for (const node of liveNodes) {
      const val = node.getAttribute('aria-live') ?? '';
      expect(['off', 'polite', 'assertive']).toContain(val);
    }
  }
}

function countActiveSubscriptions(surface: SurfaceModel<AngularComponentImplementation>): number {
  const createdListeners =
    (surface.componentsModel.onCreated as unknown as {listeners?: Set<unknown>}).listeners?.size ??
    0;
  const deletedListeners =
    (surface.componentsModel.onDeleted as unknown as {listeners?: Set<unknown>}).listeners?.size ??
    0;
  let componentUpdatedListeners = 0;
  for (const comp of surface.componentsModel.values) {
    componentUpdatedListeners +=
      (comp.onUpdated as unknown as {listeners?: Set<unknown>}).listeners?.size ?? 0;
  }
  const dataModelInternal = surface.dataModel as unknown as {
    subscriptions?: Set<unknown>;
    signals?: Map<string, {_targets?: unknown}>;
  };
  let activeSignalTargets = 0;
  for (const sig of dataModelInternal.signals?.values() ?? []) {
    if (sig._targets !== null && sig._targets !== undefined) {
      activeSignalTargets += 1;
    }
  }
  const directDataSubs = dataModelInternal.subscriptions?.size ?? 0;
  return (
    createdListeners +
    deletedListeners +
    componentUpdatedListeners +
    activeSignalTargets +
    directDataSubs
  );
}

async function performStepOperation(state: HarnessState, step: AdapterStep): Promise<void> {
  if (!step.op || step.op === 'process_messages') {
    return;
  }
  if (step.op === 'unmount_surface') {
    state.fixture?.destroy();
    state.unmounted = true;
    return;
  }
  const container = state.fixture!.nativeElement as HTMLElement;
  const targetId = step.targetNode!;
  if (step.op === 'user_input') {
    const compEl = findComponentElement(container, targetId);
    const input = compEl?.querySelector('input, textarea') as HTMLInputElement | null;
    expect(input).withContext(`Input element for "${targetId}"`).not.toBeNull();
    input!.value = String(step.inputValue ?? '');
    input!.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
    input!.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
    return;
  }
  if (step.op === 'user_gesture') {
    const compEl = findComponentElement(container, targetId);
    const button = compEl?.querySelector('button') as HTMLButtonElement | null;
    expect(button).withContext(`Button element for "${targetId}"`).not.toBeNull();
    button!.click();
    return;
  }
  if (step.op === 'programmatic_invoke') {
    const compModel = state.surface!.componentsModel.get(targetId);
    const compEl = findComponentElement(container, targetId) as A2uiWebComponentElement | undefined;
    const dataContext = compEl?.context?.dataContext;
    expect(dataContext).withContext(`DataContext for "${targetId}"`).toBeDefined();
    dataContext!.resolveAction(compModel!.properties['action'] as Record<string, unknown>, {
      userActivation: step.userActivation ?? false,
    });
    return;
  }
  throw new Error(`Unsupported adapter step op: ${String(step.op)}`);
}

function assertExpectedActions(
  actualActions: Array<Record<string, unknown>>,
  expectedActions: ExpectedActionEvent[] | undefined,
): void {
  if (expectedActions === undefined) {
    return;
  }
  expect(actualActions.length).toBe(expectedActions.length);
  expectedActions.forEach((expected, i) => {
    const actual = actualActions[i];
    expect(actual?.['name']).toBe(expected.name);
    if (expected.surfaceId !== undefined) {
      expect(actual?.['surfaceId']).toBe(expected.surfaceId);
    }
    if (expected.sourceComponentId !== undefined) {
      expect(actual?.['sourceComponentId']).toBe(expected.sourceComponentId);
    }
    if (expected.context !== undefined) {
      expect(actual?.['context']).toEqual(expected.context);
    }
  });
}

function assertExpectedErrors(
  actualErrors: Array<Record<string, unknown>>,
  expectedErrors: ExpectedErrorEntry[] | undefined,
): void {
  if (expectedErrors === undefined) {
    return;
  }
  expect(actualErrors.length).toBe(expectedErrors.length);
  expectedErrors.forEach((expected, i) => {
    const actual = actualErrors[i];
    if (expected.code !== undefined) {
      expect(actual?.['code']).toBe(expected.code);
    }
    if (expected.surfaceId !== undefined) {
      expect(actual?.['surfaceId']).toBe(expected.surfaceId);
    }
    if (expected.message !== undefined) {
      expect(String(actual?.['message'] ?? '')).toContain(expected.message);
    }
  });
}

function assertStepIdentityAndModel(
  state: HarnessState,
  step: AdapterStep,
  currentNodes: Map<string, ComponentNode>,
  currentDom: Map<string, HTMLElement>,
): void {
  if (step.expectSameViewIdentity) {
    for (const nodePath of step.expectSameViewIdentity) {
      const prevNode = state.previousNodes.get(nodePath);
      const currNode = currentNodes.get(nodePath);
      expect(currNode).withContext(`Node at ${nodePath}`).toBeDefined();
      expect(currNode).toBe(prevNode);
      const prevEl = state.previousDomElements.get(nodePath);
      const currEl = currentDom.get(nodePath);
      expect(prevEl).withContext(`Previous DOM element for ${nodePath}`).toBeDefined();
      expect(currEl).withContext(`Current DOM element for ${nodePath}`).toBeDefined();
      expect(currEl).toBe(prevEl);
    }
  }
  if (step.expectDataModel !== undefined) {
    expect(state.surface!.dataModel.get('/')).toEqual(step.expectDataModel);
  }
  if (step.expectActiveSubscriptions !== undefined) {
    expect(countActiveSubscriptions(state.surface!)).toBe(step.expectActiveSubscriptions);
  }
}

function mapNodesToDomElements(
  container: HTMLElement,
  nodes: Map<string, ComponentNode>,
): Map<string, HTMLElement> {
  const result = new Map<string, HTMLElement>();
  const allElements = Array.from(container.querySelectorAll('*'));
  for (const [nodePath, node] of nodes) {
    const match = allElements.find(el => (el as A2uiWebComponentElement).node === node);
    if (match) {
      result.set(nodePath, match as HTMLElement);
    }
  }
  return result;
}

export function mountSurface(caseSpec?: Partial<AdapterTestCase>): HarnessState {
  const catalogs: AngularCatalog[] = [
    createDefaultAdapterCatalog(),
    ...(caseSpec?.catalogs ?? []).map(buildExtraCatalog),
  ];
  TestBed.configureTestingModule({
    imports: [SurfaceComponent],
    providers: [provideA2UI({catalogs})],
  });
  const rendererService = TestBed.inject(A2uiRendererService);
  const state: HarnessState = {
    rendererService,
    unmounted: false,
    actions: [],
    errors: [],
    previousNodes: new Map(),
    previousDomElements: new Map(),
  };
  rendererService.surfaceGroup.onSurfaceCreated.subscribe(surface => {
    state.surface = surface;
    surface.onAction.subscribe(action => {
      state.actions.push(action as unknown as Record<string, unknown>);
    });
    surface.onError.subscribe(err => {
      state.errors.push(err as unknown as Record<string, unknown>);
    });
  });
  return state;
}

export async function runStep(state: HarnessState, step: AdapterStep): Promise<void> {
  assertKnownKeys(step);
  state.actions = [];
  state.errors = [];
  if (step.messages && step.messages.length > 0) {
    state.rendererService.processMessages(step.messages);
  }
  if (!state.fixture && state.surface) {
    state.fixture = TestBed.createComponent(SurfaceComponent);
    state.fixture.componentRef.setInput('surfaceId', state.surface.id);
  }
  if (state.fixture && !state.unmounted) {
    await settleSurfaceDom(state.fixture);
  }
  await performStepOperation(state, step);
  if (state.fixture && !state.unmounted) {
    await settleSurfaceDom(state.fixture);
  }
  const container = state.fixture!.nativeElement as HTMLElement;
  const rootNode = extractViewTree(state);
  const currentNodes = collectMountedNodes(rootNode);
  const currentDom = state.unmounted
    ? new Map<string, HTMLElement>()
    : mapNodesToDomElements(container, currentNodes);

  if (step.expectViewTree) {
    assertViewTree(rootNode, step.expectViewTree, state.surface!, container);
  }
  if (step.expectAccessibilityTree) {
    for (const [compId, expectedA11y] of Object.entries(step.expectAccessibilityTree)) {
      assertNodeAccessibility(container, compId, expectedA11y);
    }
  }
  assertExpectedActions(state.actions, step.expectActions);
  assertExpectedErrors(state.errors, step.expectErrors);
  assertStepIdentityAndModel(state, step, currentNodes, currentDom);
  state.previousNodes = currentNodes;
  state.previousDomElements = currentDom;
}
