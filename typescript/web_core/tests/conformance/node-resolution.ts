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
import {Catalog, createFunctionImplementation} from '../../src/catalog/types.js';
import {ComponentNode, isComponentNode} from '../../src/resolution/component-node.js';
import {NodeResolver} from '../../src/resolution/node-resolver.js';
import {ResolvedBinding, isWritable} from '../../src/resolution/resolved-binding.js';
import {effect, getValue, peekValue} from '../../src/reactivity/signals.js';
import {ComponentModel} from '../../src/state/component-model.js';
import {SurfaceModel} from '../../src/state/surface-model.js';

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
  props?: Record<string, unknown>;
}
interface Expectation {
  nodes: Record<string, NodeExpectation>;
  emissions?: Record<string, number>;
  same_nodes?: string[];
  replaced_nodes?: string[];
  destroyed?: Record<string, number>;
  data?: Record<string, unknown>;
  events?: unknown[];
  functions?: unknown[];
}
type Operation =
  | {op: 'set_data'; path: string; value: unknown}
  | {op: 'update_components'; components: Component[]}
  | {op: 'remove_component'; component_id: string}
  | {op: 'write'; node: string; property: string; value: unknown}
  | {op: 'invoke'; node: string; property: string}
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
  destroyed: number;
  lastProps?: unknown;
  stop(): void;
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

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

function checkNodes(
  nodes: Map<string, ComponentNode>,
  expected: Expectation,
  reason: string,
): void {
  assert.deepEqual(
    [...nodes.keys()].sort(),
    Object.keys(expected.nodes).sort(),
    `${reason}: node paths`,
  );
  for (const [path, fields] of Object.entries(expected.nodes)) {
    const node = requiredNode(nodes, path);
    const actual = {
      component_id: node.componentId,
      type: node.type,
      state: node.state,
      data_path: node.dataPath,
    };
    for (const key of ['component_id', 'type', 'state', 'data_path'] as const) {
      if (key in fields) assert.equal(actual[key], fields[key], `${reason}: ${path}.${key}`);
    }
    const props = peekValue(node.props);
    for (const [key, value] of Object.entries(fields.props ?? {})) {
      assert.ok(key in props, `${reason}: ${path}.${key} is absent`);
      assert.deepEqual(normalize(props[key], `${path}/${key}`), value, `${reason}: ${path}.${key}`);
    }
  }
}

function updateComponents(surface: SurfaceModel, components: Component[]): void {
  for (const {id, component, ...properties} of components) {
    const existing = surface.componentsModel.get(id);
    if (existing) {
      assert.equal(existing.type, component, `update_components cannot change ${id}'s type`);
      existing.properties = properties;
    } else {
      surface.componentsModel.addComponent(new ComponentModel(id, component, properties));
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

/**
 * Runs one `resolve_nodes` case; fixture and catalog paths resolve against
 * `conformanceRoot`.
 */
export async function runNodeResolutionCase(
  testCase: ConformanceCase,
  conformanceRoot: string,
): Promise<void> {
  assert.equal(testCase.action, 'resolve_nodes');
  const fixture = yaml.load(
    readFileSync(join(conformanceRoot, testCase.fixture), 'utf8'),
  ) as Fixture;
  const parsed = Catalog.fromJson(
    JSON.parse(readFileSync(join(conformanceRoot, fixture.catalog), 'utf8')),
  );
  const functions: unknown[] = [];
  const events: unknown[] = [];
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
  surface.dataModel.set('/', fixture.data);
  updateComponents(surface, fixture.components);
  const resolver = new NodeResolver(surface, catalog);
  const watches = new Map<ComponentNode, Watch>();
  const stopActions = surface.onAction.subscribe(action => {
    events.push({
      name: action.name,
      source_component_id: action.sourceComponentId,
      context: normalize(action.context, ''),
    });
  });

  function watchNodes(nodes: Map<string, ComponentNode>): void {
    for (const [path, node] of nodes) {
      const existing = watches.get(node);
      if (existing) {
        existing.path = path;
        continue;
      }
      const watch: Watch = {
        path,
        emissions: 0,
        destroyed: 0,
        stop: () => {},
      };
      const stopProps = effect(() => {
        const props = getValue(node.props);
        watch.emissions++;
        watch.lastProps = normalize(props, watch.path);
      });
      const stopDestroyed = node.onDestroyed.subscribe(() => {
        watch.destroyed++;
      });
      watch.stop = () => {
        stopProps();
        stopDestroyed.unsubscribe();
      };
      watches.set(node, watch);
    }
  }

  function check(expected: Expectation, before: Map<string, ComponentNode>, reason: string): void {
    const after = mountedNodes(resolver);
    checkNodes(after, expected, reason);
    const surviving = new Set(after.values());
    const emissions: Record<string, number> = {};
    const destroyed: Record<string, number> = {};
    for (const [node, watch] of watches) {
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
      if (watch.destroyed) {
        destroyed[watch.path] = (destroyed[watch.path] ?? 0) + watch.destroyed;
        assert.equal(node.disposed, true, `${reason}: ${watch.path} destruction without disposal`);
      }
    }
    assert.deepEqual(emissions, expected.emissions ?? {}, `${reason}: emissions`);
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
        normalize(surface.dataModel.get(path), path),
        value,
        `${reason}: data ${path}`,
      );
    }
    assert.deepEqual(events, expected.events ?? [], `${reason}: events`);
    assert.deepEqual(functions, expected.functions ?? [], `${reason}: functions`);
  }

  try {
    await flush();
    check(testCase.expect, new Map(), `${testCase.name} initial`);
    for (const [index, step] of testCase.steps.entries()) {
      const reason = `${testCase.name} step ${index} (${step.op})`;
      const before = mountedNodes(resolver);
      watchNodes(before);
      for (const watch of watches.values()) {
        watch.emissions = 0;
        watch.destroyed = 0;
        watch.lastProps = undefined;
      }
      events.length = 0;
      functions.length = 0;
      const bindings = saveBindings(before);
      switch (step.op) {
        case 'set_data':
          surface.dataModel.set(step.path, step.value);
          break;
        case 'update_components':
          updateComponents(surface, step.components);
          break;
        case 'remove_component':
          surface.componentsModel.removeComponent(step.component_id);
          break;
        case 'write': {
          const binding = peekValue(requiredNode(before, step.node).props)[step.property];
          assert.ok(
            binding instanceof ResolvedBinding && isWritable(binding),
            `${reason}: not a writable binding`,
          );
          binding.set(step.value);
          break;
        }
        case 'invoke': {
          const action = peekValue(requiredNode(before, step.node).props)[step.property];
          assert.equal(typeof action, 'function', `${reason}: not an action`);
          await (action as () => unknown)();
          break;
        }
        case 'dispose':
          resolver.dispose();
          break;
        default:
          assert.fail(`Unknown node operation: ${(step as {op: string}).op}`);
      }
      await flush();
      check(step.expect, before, reason);
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
  }
}
