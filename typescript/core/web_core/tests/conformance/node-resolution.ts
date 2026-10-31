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
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import yaml from 'js-yaml';

import {Catalog, ComponentApi, createFunctionImplementation} from '../../src/catalog/types.js';
import {A2uiMetadata, ActionDispatchOptions, jsonValueEquals} from '../../src/common/metadata.js';
import {MessageProcessor} from '../../src/processing/message-processor.js';
import {batchWrite, effect, getValue, peekValue} from '../../src/reactivity/signals.js';
import {
  ComponentNode,
  isComponentNode,
  PLACEHOLDER_TYPE,
} from '../../src/resolution/component-node.js';
import {NodeResolver} from '../../src/resolution/node-resolver.js';
import {isWritable, ResolvedBinding} from '../../src/resolution/resolved-binding.js';
import {ComponentModel} from '../../src/state/component-model.js';
import {A2uiErrorPayload, SurfaceModel} from '../../src/state/surface-model.js';

type Component = Record<string, unknown> & {id: string; component: string};
interface Fixture {
  catalog: string;
  data: Record<string, unknown>;
  components: Component[];
}
interface NodeExpectation {
  component_id?: string;
  type?: string;
  state?: string;
  data_path?: string;
  isValid?: boolean;
  validationErrors?: string[];
  validationResults?: Array<Record<string, unknown>>;
  props?: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}
interface Expectation {
  nodes: Record<string, NodeExpectation>;
  emissions?: Record<string, number>;
  metadata_emissions?: Record<string, number>;
  same_nodes?: string[];
  replaced_nodes?: string[];
  destroyed?: Record<string, number>;
  data?: Record<string, unknown>;
  events?: unknown[];
  functions?: unknown[];
  errors?: Array<{code?: string; surfaceId?: string; message?: string}>;
}
type Operation =
  | {op: 'set_data'; path: string; value: unknown}
  | {op: 'update_components'; components: Component[]}
  | {op: 'remove_component'; component_id: string}
  | {op: 'write'; node: string; property: string; value: unknown}
  | {op: 'invoke'; node: string; property: string; metadata?: Record<string, unknown>}
  | {op: 'process_messages'; messages: unknown[]}
  | {op: 'dispose'};
export interface ConformanceCase {
  name: string;
  action: 'resolve_nodes';
  fixture: string;
  expect: Expectation;
  steps: Array<Operation & {expect: Expectation}>;
}
interface Watch {
  path: string;
  emissions: number;
  metadataEmissions: number;
  destroyed: number;
  lastProps?: unknown;
  stop(): void;
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const KNOWN_KEYS = {
  case: new Set(['action', 'description', 'expect', 'features', 'fixture', 'name', 'steps']),
  fixture: new Set(['catalog', 'components', 'data']),
  expect: new Set([
    'data',
    'destroyed',
    'emissions',
    'errors',
    'events',
    'functions',
    'metadata_emissions',
    'nodes',
    'replaced_nodes',
    'same_nodes',
  ]),
  node: new Set([
    'component_id',
    'data_path',
    'isValid',
    'metadata',
    'props',
    'state',
    'type',
    'validationErrors',
    'validationResults',
  ]),
  event: new Set(['context', 'metadata', 'name', 'source_component_id']),
  function: new Set(['args', 'name']),
  error: new Set(['code', 'message', 'surfaceId']),
  step: {
    set_data: new Set(['expect', 'op', 'path', 'value']),
    update_components: new Set(['components', 'expect', 'op']),
    remove_component: new Set(['component_id', 'expect', 'op']),
    write: new Set(['expect', 'node', 'op', 'property', 'value']),
    invoke: new Set(['expect', 'metadata', 'node', 'op', 'property']),
    process_messages: new Set(['expect', 'messages', 'op']),
    dispose: new Set(['expect', 'op']),
  },
} as const;

function assertKnownKeys(obj: unknown, allowed: ReadonlySet<string>, where: string): void {
  if (obj === undefined || obj === null) return;
  assert.ok(typeof obj === 'object' && !Array.isArray(obj), `${where}: expected object`);
  const unknown = Object.keys(obj).filter(key => !allowed.has(key));
  assert.deepEqual(
    unknown,
    [],
    `${where}: unknown keys: ${unknown.map(k => `${where}.${k}`).join(', ')}`,
  );
}

function assertKnownKeysList(items: unknown, allowed: ReadonlySet<string>, where: string): void {
  if (!Array.isArray(items)) return;
  for (let i = 0; i < items.length; i++) {
    assertKnownKeys(items[i], allowed, `${where}[${i}]`);
  }
}

/** Detached values preserve binding snapshots and name child references by tree position. */
function normalize(value: unknown, path: string): unknown {
  if (isComponentNode(value)) return {node: path};
  if (value instanceof ResolvedBinding) {
    return {value: normalize(value.value, path), writable: isWritable(value)};
  }
  if (typeof value === 'function') return {action: true};
  if (Array.isArray(value)) return value.map((item, i) => normalize(item, `${path}/${i}`));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalize(item, `${path}/${key}`)]),
    );
  }
  return value ?? null;
}

/** Enumerates mounted nodes, including references nested inside ordinary property containers. */
function mountedNodes(resolver: NodeResolver): Map<string, ComponentNode> {
  const nodes = new Map<string, ComponentNode>();
  const seen = new Set<ComponentNode>();
  function visit(node: ComponentNode, path: string): void {
    assert.ok(!seen.has(node), `${path}: each mounted position must have a distinct node`);
    assert.equal(node.disposed, false, `${path}: mounted node is disposed`);
    seen.add(node);
    nodes.set(path, node);
    const siblingIds = new Set<string>();
    function children(value: unknown, childPath: string): void {
      if (isComponentNode(value)) {
        assert.ok(!siblingIds.has(value.instanceId), `${childPath}: duplicate sibling instanceId`);
        siblingIds.add(value.instanceId);
        visit(value, childPath);
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => children(item, `${childPath}/${i}`));
      } else if (
        value !== null &&
        typeof value === 'object' &&
        !(value instanceof ResolvedBinding)
      ) {
        for (const [key, item] of Object.entries(value)) children(item, `${childPath}/${key}`);
      }
    }
    children(peekValue(node.props), path);
  }
  const root = peekValue(resolver.rootNode);
  if (root) visit(root, 'root');
  return nodes;
}

function requiredNode(nodes: Map<string, ComponentNode>, path: string): ComponentNode {
  const node = nodes.get(path);
  assert.ok(node, `No node at ${path}`);
  return node;
}

function checkNodeValidationProps(
  props: Record<string, unknown>,
  fields: NodeExpectation,
  path: string,
  reason: string,
): void {
  for (const key of ['isValid', 'validationErrors', 'validationResults'] as const) {
    if (key in fields) {
      assert.deepEqual(
        normalize(props[key], `${path}/${key}`),
        fields[key],
        `${reason}: ${path}.${key}`,
      );
    }
  }
}

function checkNodes(
  nodes: Map<string, ComponentNode>,
  expected: Expectation,
  reason: string,
  surface?: SurfaceModel,
): void {
  assert.deepEqual(
    [...nodes.keys()].sort(),
    Object.keys(expected.nodes).sort(),
    `${reason}: node paths`,
  );
  for (const [path, fields] of Object.entries(expected.nodes)) {
    assertKnownKeys(fields, KNOWN_KEYS.node, `${reason}.expect.nodes.${path}`);
    const node = requiredNode(nodes, path);
    const nodeType =
      node.state === 'cyclic' && node.type === PLACEHOLDER_TYPE && surface
        ? (surface.componentsModel.get(node.componentId)?.type ?? node.type)
        : node.type;
    const actual = {
      component_id: node.componentId,
      type: nodeType,
      state: node.state,
      data_path: node.dataPath,
    };
    for (const key of ['component_id', 'type', 'state', 'data_path'] as const) {
      if (key in fields) assert.equal(actual[key], fields[key], `${reason}: ${path}.${key}`);
    }
    const props = peekValue(node.props);
    checkNodeValidationProps(props, fields, path, reason);
    for (const [key, value] of Object.entries(fields.props ?? {})) {
      assert.ok(key in props, `${reason}: ${path}.${key} is absent`);
      assert.deepEqual(normalize(props[key], `${path}/${key}`), value, `${reason}: ${path}.${key}`);
    }
    if ('metadata' in fields) {
      assert.deepEqual(
        peekValue(node.metadata) ?? null,
        fields.metadata,
        `${reason}: ${path}.metadata`,
      );
    }
  }
}

function updateComponents(
  surface: SurfaceModel,
  catalog: Catalog<ComponentApi>,
  components: Component[],
): void {
  for (const {id, component, metadata, ...properties} of components) {
    const existing = surface.componentsModel.get(id);
    if (existing) {
      assert.equal(existing.type, component, `update_components cannot change ${id}'s type`);
      batchWrite(() => {
        existing.metadata = metadata as A2uiMetadata | undefined;
        if (!jsonValueEquals(existing.properties, properties)) {
          existing.properties = properties;
        }
      });
    } else {
      surface.componentsModel.addComponent(
        new ComponentModel(
          id,
          component,
          properties,
          catalog,
          metadata as A2uiMetadata | undefined,
        ),
      );
    }
  }
}

function saveBindings(
  nodes: Map<string, ComponentNode>,
): Array<[ResolvedBinding<unknown>, unknown]> {
  const saved: Array<[ResolvedBinding<unknown>, unknown]> = [];
  function visit(value: unknown): void {
    if (value instanceof ResolvedBinding) {
      saved.push([value, normalize(value.value, '')]);
    } else if (!isComponentNode(value) && value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  }
  for (const node of nodes.values()) visit(peekValue(node.props));
  return saved;
}

function checkExpectedErrors(
  actualErrors: A2uiErrorPayload[],
  expectedErrors: NonNullable<Expectation['errors']> | undefined,
  reason: string,
): void {
  if (expectedErrors === undefined) return;
  assert.equal(actualErrors.length, expectedErrors.length, `${reason}: errors count`);
  for (let i = 0; i < expectedErrors.length; i++) {
    const expErr: {code?: string; surfaceId?: string; message?: string} = expectedErrors[i];
    assertKnownKeys(expErr, KNOWN_KEYS.error, `${reason}.expect.errors[${i}]`);
    const actErr = actualErrors[i];
    if (expErr.code !== undefined) {
      assert.equal(actErr.code, expErr.code, `${reason}: errors[${i}].code`);
    }
    if (expErr.surfaceId !== undefined) {
      assert.equal(actErr.surfaceId, expErr.surfaceId, `${reason}: errors[${i}].surfaceId`);
    }
    if (expErr.message !== undefined) {
      assert.ok(
        actErr.message.includes(expErr.message),
        `${reason}: errors[${i}].message (${actErr.message})`,
      );
    }
  }
}

async function executeNodeResolutionStep(
  step: ConformanceCase['steps'][number],
  before: Map<string, ComponentNode>,
  surface: SurfaceModel,
  catalog: Catalog<ComponentApi>,
  processor: MessageProcessor,
  resolver: NodeResolver,
  reason: string,
): Promise<void> {
  switch (step.op) {
    case 'set_data':
      assertKnownKeys(step, KNOWN_KEYS.step.set_data, reason);
      surface.dataModel.set(step.path, step.value);
      break;
    case 'update_components':
      assertKnownKeys(step, KNOWN_KEYS.step.update_components, reason);
      updateComponents(surface, catalog, step.components);
      break;
    case 'remove_component':
      assertKnownKeys(step, KNOWN_KEYS.step.remove_component, reason);
      surface.componentsModel.removeComponent(step.component_id);
      break;
    case 'write': {
      assertKnownKeys(step, KNOWN_KEYS.step.write, reason);
      const binding = peekValue(requiredNode(before, step.node).props)[step.property];
      assert.ok(
        binding instanceof ResolvedBinding && isWritable(binding),
        `${reason}: not a writable binding`,
      );
      binding.set(step.value);
      break;
    }
    case 'invoke': {
      assertKnownKeys(step, KNOWN_KEYS.step.invoke, reason);
      const action = peekValue(requiredNode(before, step.node).props)[step.property];
      assert.equal(typeof action, 'function', `${reason}: not an action`);
      await (action as (options?: ActionDispatchOptions) => unknown)(
        step.metadata ? {metadata: step.metadata as A2uiMetadata} : undefined,
      );
      break;
    }
    case 'process_messages':
      assertKnownKeys(step, KNOWN_KEYS.step.process_messages, reason);
      processor.processMessages(step.messages as any);
      break;
    case 'dispose':
      assertKnownKeys(step, KNOWN_KEYS.step.dispose, reason);
      resolver.dispose();
      break;
    default:
      assert.fail(`Unknown node operation: ${(step as {op: string}).op}`);
  }
}

interface ResolutionContext {
  resolver: NodeResolver;
  surface: SurfaceModel;
  watches: Map<ComponentNode, Watch>;
  events: unknown[];
  functions: unknown[];
  errors: A2uiErrorPayload[];
}

function watchNodes(nodes: Map<string, ComponentNode>, watches: Map<ComponentNode, Watch>): void {
  for (const [path, node] of nodes) {
    const existing = watches.get(node);
    if (existing) {
      existing.path = path;
      continue;
    }
    const watch: Watch = {
      path,
      emissions: 0,
      metadataEmissions: 0,
      destroyed: 0,
      stop: () => {},
    };
    const stopProps = effect(() => {
      const props = getValue(node.props);
      watch.emissions++;
      watch.lastProps = normalize(props, watch.path);
    });
    const stopMetadata = effect(() => {
      getValue(node.metadata);
      watch.metadataEmissions++;
    });
    const stopDestroyed = node.onDestroyed.subscribe(() => {
      watch.destroyed++;
    });
    watch.stop = () => {
      stopProps();
      stopMetadata();
      stopDestroyed.unsubscribe();
    };
    watches.set(node, watch);
  }
}

function checkExpectation(
  expected: Expectation,
  before: Map<string, ComponentNode>,
  ctx: ResolutionContext,
  reason: string,
): void {
  assertKnownKeys(expected, KNOWN_KEYS.expect, `${reason}.expect`);
  assertKnownKeysList(expected.events, KNOWN_KEYS.event, `${reason}.expect.events`);
  assertKnownKeysList(expected.functions, KNOWN_KEYS.function, `${reason}.expect.functions`);
  const after = mountedNodes(ctx.resolver);
  checkNodes(after, expected, reason, ctx.surface);
  const surviving = new Set(after.values());
  const emissions: Record<string, number> = {};
  const metadataEmissions: Record<string, number> = {};
  const destroyed: Record<string, number> = {};
  for (const [node, watch] of ctx.watches) {
    // Removal may update a binding before teardown; only surviving nodes have
    // exact emission counts. Retired nodes remain watched for destruction.
    if (watch.emissions && surviving.has(node)) {
      emissions[watch.path] = (emissions[watch.path] ?? 0) + watch.emissions;
      assert.deepEqual(
        watch.lastProps,
        normalize(peekValue(node.props), watch.path),
        `${reason}: ${watch.path} last emission`,
      );
    }
    if (watch.metadataEmissions && surviving.has(node)) {
      metadataEmissions[watch.path] =
        (metadataEmissions[watch.path] ?? 0) + watch.metadataEmissions;
    }
    if (watch.destroyed) {
      destroyed[watch.path] = (destroyed[watch.path] ?? 0) + watch.destroyed;
      assert.equal(node.disposed, true, `${reason}: ${watch.path} destruction without disposal`);
    }
  }
  assert.deepEqual(emissions, expected.emissions ?? {}, `${reason}: emissions`);
  if (expected.metadata_emissions !== undefined) {
    assert.deepEqual(
      metadataEmissions,
      expected.metadata_emissions,
      `${reason}: metadata_emissions`,
    );
  }
  assert.deepEqual(destroyed, expected.destroyed ?? {}, `${reason}: destroyed`);
  for (const path of expected.same_nodes ?? []) {
    assert.equal(
      requiredNode(after, path),
      requiredNode(before, path),
      `${reason}: ${path} identity`,
    );
  }
  for (const path of expected.replaced_nodes ?? []) {
    assert.notEqual(
      requiredNode(after, path),
      requiredNode(before, path),
      `${reason}: ${path} replacement`,
    );
  }
  for (const [path, value] of Object.entries(expected.data ?? {})) {
    assert.deepEqual(
      normalize(ctx.surface.dataModel.get(path), path),
      value,
      `${reason}: data ${path}`,
    );
  }
  assert.deepEqual(ctx.events, expected.events ?? [], `${reason}: events`);
  assert.deepEqual(ctx.functions, expected.functions ?? [], `${reason}: functions`);
  checkExpectedErrors(ctx.errors, expected.errors, reason);
}

/**
 * Runs one `resolve_nodes` case; fixture and catalog paths resolve against
 * `conformanceRoot`.
 */
export async function runNodeResolutionCase(
  testCase: ConformanceCase,
  conformanceRoot: string,
): Promise<void> {
  assertKnownKeys(testCase, KNOWN_KEYS.case, testCase.name || 'resolve_nodes');
  assert.equal(testCase.action, 'resolve_nodes');
  const fixture = yaml.load(
    readFileSync(join(conformanceRoot, testCase.fixture), 'utf8'),
  ) as Fixture;
  assertKnownKeys(fixture, KNOWN_KEYS.fixture, `${testCase.name}.fixture`);
  const parsed = Catalog.fromJson(
    JSON.parse(readFileSync(join(conformanceRoot, fixture.catalog), 'utf8')),
  );
  const functions: unknown[] = [];
  const events: unknown[] = [];
  const errors: A2uiErrorPayload[] = [];
  const catalog = new Catalog(
    parsed.id,
    parsed.protocolVersion,
    [...parsed.components.values()],
    [...parsed.functions.values()].map(api =>
      createFunctionImplementation(api, args => {
        functions.push({name: api.name, args: normalize(args, '')});
        return null;
      }),
    ),
  );
  const surface = new SurfaceModel('s', catalog);
  const processor = new MessageProcessor([catalog]);
  processor.model.addSurface(surface);
  surface.dataModel.set('/', fixture.data);
  updateComponents(surface, catalog, fixture.components);
  const resolver = new NodeResolver(surface, catalog);
  const watches = new Map<ComponentNode, Watch>();
  const ctx: ResolutionContext = {resolver, surface, watches, events, functions, errors};
  const stopActions = surface.onAction.subscribe(action => {
    events.push({
      name: action.name,
      source_component_id: action.sourceComponentId,
      context: normalize(action.context, ''),
      ...(action.metadata !== undefined ? {metadata: action.metadata} : {}),
    });
  });
  const stopErrors = surface.onError.subscribe(err => {
    errors.push(err);
  });

  try {
    await flush();
    checkExpectation(testCase.expect, new Map(), ctx, `${testCase.name} initial`);
    for (const [index, step] of testCase.steps.entries()) {
      const reason = `${testCase.name} step ${index} (${step.op})`;
      const before = mountedNodes(resolver);
      watchNodes(before, watches);
      for (const watch of watches.values()) {
        watch.emissions = 0;
        watch.metadataEmissions = 0;
        watch.destroyed = 0;
        watch.lastProps = undefined;
      }
      events.length = 0;
      functions.length = 0;
      errors.length = 0;
      const bindings = saveBindings(before);
      await executeNodeResolutionStep(step, before, surface, catalog, processor, resolver, reason);
      await flush();
      checkExpectation(step.expect, before, ctx, reason);
      for (const [binding, value] of bindings) {
        assert.deepEqual(
          normalize(binding.value, ''),
          value,
          `${reason}: prior binding snapshot changed`,
        );
      }
    }
  } finally {
    resolver.dispose();
    surface.dispose();
    await flush();
    for (const watch of watches.values()) watch.stop();
    stopActions.unsubscribe();
    stopErrors.unsubscribe();
  }
}
