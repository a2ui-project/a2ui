/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Conformance suite for the node layer, ported from the Python reference
 * (`agent_sdks/python/a2ui_core/tests/test_node_graph.py`) plus tests for the
 * defects the reference is known to have: eager action resolution, shared-node
 * use-after-dispose, and whole-list template respawn.
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';
import {z} from 'zod';
import {
  Catalog,
  ComponentApi,
  FunctionApi,
  createFunctionImplementation,
} from '../catalog/types.js';
import {ComponentModel} from '../state/component-model.js';
import {SurfaceModel} from '../state/surface-model.js';
import {A2uiClientAction} from '../schema/client-to-server.js';
import {ActionSchema, DynamicStringSchema} from '../schema/common-types.js';
import {effect, getValue, peekValue, Signal} from '../reactivity/signals.js';
import {ComponentNode, NodeProps, PLACEHOLDER_TYPE} from './component-node.js';
import {NodeResolver} from './node-resolver.js';
import {componentReference, componentReferenceList} from './ref-fields.js';

const TextApi = {
  name: 'Text',
  schema: z.object({text: DynamicStringSchema.optional()}),
};
const ButtonApi = {
  name: 'Button',
  schema: z.object({label: DynamicStringSchema.optional(), action: ActionSchema.optional()}),
};
const CardApi = {
  name: 'Card',
  schema: z.object({child: componentReference().optional()}),
};
const ColumnApi = {
  name: 'Column',
  schema: z.object({children: componentReferenceList().optional()}),
};
const TabsApi = {
  name: 'Tabs',
  schema: z.object({
    items: z.array(z.object({title: z.string(), child: componentReference()})).optional(),
  }),
};

const ShoutApi = {
  name: 'shout',
  returnType: 'string',
  schema: z.object({value: z.coerce.string()}),
} as const;

function makeCatalog() {
  return new Catalog<ComponentApi>(
    'node-test-catalog',
    [TextApi, ButtonApi, CardApi, ColumnApi, TabsApi],
    [createFunctionImplementation(ShoutApi, args => String(args.value).toUpperCase())],
  );
}

function setup() {
  const catalog = makeCatalog();
  const surface = new SurfaceModel('surf-1', catalog);
  const resolver = new NodeResolver(surface, catalog);
  return {catalog, surface, resolver};
}

function add(surface: SurfaceModel, id: string, type: string, props: Record<string, unknown>) {
  surface.componentsModel.addComponent(new ComponentModel(id, type, props));
}

function props(node: ComponentNode): NodeProps {
  return peekValue(node.props);
}

function child(node: ComponentNode, key: string, index?: number): ComponentNode {
  const value = index === undefined ? props(node)[key] : (props(node)[key] as unknown[])[index];
  assert.ok(
    value instanceof ComponentNode,
    `expected ${key}[${index ?? ''}] to be a ComponentNode`,
  );
  return value;
}

/** Counts emissions of a signal, excluding the subscription-time run. */
function countEmissions(sig: Signal<unknown>): {readonly count: number; dispose(): void} {
  let n = -1;
  const dispose = effect(() => {
    getValue(sig);
    n++;
  });
  return {
    get count() {
      return n;
    },
    dispose,
  };
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('NodeResolver conformance (port of test_node_graph.py)', () => {
  it('resolves the root and upgrades and downgrades referenced children (lifecycle)', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['child_1']});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(root.type, 'Column');
    assert.strictEqual(child(root, 'children', 0).type, PLACEHOLDER_TYPE);

    add(surface, 'child_1', 'Text', {text: 'Hello Node'});
    const upgraded = child(root, 'children', 0);
    assert.strictEqual(upgraded.type, 'Text');
    assert.strictEqual(props(upgraded).text, 'Hello Node');

    surface.componentsModel.removeComponent('child_1');
    assert.strictEqual(child(root, 'children', 0).type, PLACEHOLDER_TYPE);
    assert.strictEqual(upgraded.disposed, true);
    resolver.dispose();
    surface.dispose();
  });

  it('tracks root creation and removal on rootNode', () => {
    const {surface, resolver} = setup();
    assert.strictEqual(getValue(resolver.rootNode), undefined);

    add(surface, 'root', 'Column', {children: []});
    const root = getValue(resolver.rootNode);
    assert.ok(root instanceof ComponentNode);
    assert.strictEqual(root.componentId, 'root');
    assert.strictEqual(root.type, 'Column');

    surface.componentsModel.removeComponent('root');
    assert.strictEqual(getValue(resolver.rootNode), undefined);
    assert.strictEqual(root.disposed, true);
    resolver.dispose();
  });

  it('exposes core node properties', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Card', {child: 'text-1'});
    add(surface, 'text-1', 'Text', {text: 'Hi'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(root.instanceId, 'root');
    assert.strictEqual(root.dataPath, '/');
    const textNode = child(root, 'child');
    assert.strictEqual(textNode.instanceId, 'text-1');
    assert.strictEqual(textNode.componentId, 'text-1');
    assert.strictEqual(textNode.type, 'Text');
    assert.strictEqual(textNode.dataPath, '/');
    resolver.dispose();
  });

  it('resolves data-bound properties reactively', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/username', 'Alice');
    add(surface, 'root', 'Text', {text: {path: '/username'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(props(root).text, 'Alice');

    surface.dataModel.set('/username', 'Bob');
    assert.strictEqual(props(root).text, 'Bob');
    resolver.dispose();
  });

  it('resolves a single child reference to a live node', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Card', {child: 'text-1'});
    add(surface, 'text-1', 'Text', {text: 'Hello'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const textNode = child(root, 'child');
    assert.strictEqual(textNode.type, 'Text');
    assert.strictEqual(props(textNode).text, 'Hello');
    resolver.dispose();
  });

  it('resolves an explicit children list in order', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['c1', 'c2']});
    add(surface, 'c1', 'Text', {text: 'C1'});
    add(surface, 'c2', 'Text', {text: 'C2'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const children = props(root).children as ComponentNode[];
    assert.strictEqual(children.length, 2);
    assert.strictEqual(props(children[0]).text, 'C1');
    assert.strictEqual(props(children[1]).text, 'C2');
    resolver.dispose();
  });

  it('spawns one node per array item for a template child list', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item_tpl', path: '/items'}});
    add(surface, 'item_tpl', 'Text', {text: {path: 'name'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const children = props(root).children as ComponentNode[];
    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0].instanceId, 'item_tpl-[/items/0]');
    assert.strictEqual(children[0].dataPath, '/items/0');
    assert.strictEqual(props(children[0]).text, 'A');
    assert.strictEqual(props(children[1]).text, 'B');
    resolver.dispose();
  });

  it('renders placeholders progressively and emits the parent exactly once on upgrade', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['late']});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const placeholder = child(root, 'children', 0);
    assert.strictEqual(placeholder.type, PLACEHOLDER_TYPE);
    assert.strictEqual(placeholder.componentId, 'late');

    let destroyed = 0;
    placeholder.onDestroyed.subscribe(() => {
      destroyed++;
    });
    const emissions = countEmissions(root.props);

    add(surface, 'late', 'Text', {text: 'Arrived'});
    assert.strictEqual(emissions.count, 1);
    const upgraded = child(root, 'children', 0);
    assert.notStrictEqual(upgraded, placeholder);
    assert.strictEqual(upgraded.type, 'Text');
    assert.strictEqual(props(upgraded).text, 'Arrived');
    assert.strictEqual(placeholder.disposed, true);
    assert.strictEqual(destroyed, 1);
    emissions.dispose();
    resolver.dispose();
  });

  it('binds actions as closures that dispatch through the surface', async () => {
    const {surface, resolver} = setup();
    const actions: A2uiClientAction[] = [];
    surface.onAction.subscribe(action => {
      actions.push(action);
    });
    surface.dataModel.set('/current_id', 42);
    add(surface, 'root', 'Button', {
      label: 'Go',
      action: {event: {name: 'submit', context: {itemId: {path: '/current_id'}}}},
    });
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const fire = props(root).action;
    assert.strictEqual(typeof fire, 'function');
    (fire as () => void)();
    await flush();

    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].name, 'submit');
    assert.strictEqual(actions[0].surfaceId, 'surf-1');
    assert.strictEqual(actions[0].sourceComponentId, 'root');
    assert.deepStrictEqual(actions[0].context, {itemId: 42});
    resolver.dispose();
  });

  it('resolves an unresolved binding to undefined without failing', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Text', {text: {path: '/missing'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(props(root).text, undefined);
    resolver.dispose();
  });

  it('reconciles explicit children list changes, reusing surviving nodes', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['c1', 'c2']});
    add(surface, 'c1', 'Text', {text: 'C1'});
    add(surface, 'c2', 'Text', {text: 'C2'});
    add(surface, 'c3', 'Text', {text: 'C3'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const before = props(root).children as ComponentNode[];

    const rootModel = surface.componentsModel.get('root');
    assert.ok(rootModel);
    rootModel.properties = {children: ['c1', 'c3']};

    const after = props(root).children as ComponentNode[];
    assert.strictEqual(after.length, 2);
    assert.strictEqual(after[0], before[0]);
    assert.strictEqual(props(after[1]).text, 'C3');
    assert.strictEqual(before[1].disposed, true);
    resolver.dispose();
  });

  it('reconciles a swap from explicit children to a template', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/items', [{name: 'T0'}]);
    add(surface, 'root', 'Column', {children: ['c1']});
    add(surface, 'c1', 'Text', {text: 'C1'});
    add(surface, 'item_tpl', 'Text', {text: {path: 'name'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const explicitChild = child(root, 'children', 0);

    const rootModel = surface.componentsModel.get('root');
    assert.ok(rootModel);
    rootModel.properties = {children: {componentId: 'item_tpl', path: '/items'}};

    const children = props(root).children as ComponentNode[];
    assert.strictEqual(children.length, 1);
    assert.strictEqual(props(children[0]).text, 'T0');
    assert.strictEqual(explicitChild.disposed, true);
    resolver.dispose();
  });

  it('resolves function-call bindings reactively', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/username', 'alice');
    add(surface, 'root', 'Text', {text: {call: 'shout', args: {value: {path: '/username'}}}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(props(root).text, 'ALICE');

    surface.dataModel.set('/username', 'bob');
    assert.strictEqual(props(root).text, 'BOB');
    resolver.dispose();
  });

  it('resolves nested child references inside item arrays', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Tabs', {
      items: [
        {title: 'One', child: 't1'},
        {title: 'Two', child: 't2'},
      ],
    });
    add(surface, 't1', 'Text', {text: 'First'});
    add(surface, 't2', 'Text', {text: 'Second'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const items = props(root).items as Array<Record<string, unknown>>;
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].title, 'One');
    const first = items[0].child;
    assert.ok(first instanceof ComponentNode);
    assert.strictEqual(props(first).text, 'First');
    const second = items[1].child;
    assert.ok(second instanceof ComponentNode);
    assert.strictEqual(props(second).text, 'Second');
    resolver.dispose();
  });

  it('reconciles a deleted component back to a placeholder, leaving siblings alone', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['c1', 'c2']});
    add(surface, 'c1', 'Text', {text: 'C1'});
    add(surface, 'c2', 'Text', {text: 'C2'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const before = props(root).children as ComponentNode[];

    surface.componentsModel.removeComponent('c2');

    const after = props(root).children as ComponentNode[];
    assert.strictEqual(after[0], before[0]);
    assert.strictEqual(after[1].type, PLACEHOLDER_TYPE);
    assert.strictEqual(before[1].disposed, true);
    resolver.dispose();
  });

  it('re-spawns template children as the bound array grows and shrinks', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/items', [{name: 'A'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item_tpl', path: '/items'}});
    add(surface, 'item_tpl', 'Text', {text: {path: 'name'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual((props(root).children as ComponentNode[]).length, 1);

    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}, {name: 'C'}]);
    const grown = props(root).children as ComponentNode[];
    assert.strictEqual(grown.length, 3);
    assert.strictEqual(props(grown[2]).text, 'C');

    surface.dataModel.set('/items', [{name: 'A'}]);
    const shrunk = props(root).children as ComponentNode[];
    assert.strictEqual(shrunk.length, 1);
    assert.strictEqual(grown[1].disposed, true);
    assert.strictEqual(grown[2].disposed, true);
    resolver.dispose();
  });

  it('serializes the resolved tree, rendering actions and placeholders specially', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['card', 'btn', 'late']});
    add(surface, 'card', 'Card', {child: 'txt'});
    add(surface, 'txt', 'Text', {text: 'Hello'});
    add(surface, 'btn', 'Button', {label: 'Go', action: {event: {name: 'go'}}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const json = root.toJSON();
    // setText/setLabel are the binder's synthesized two-way setters; like
    // action closures they serialize as '<Action>'.
    assert.deepStrictEqual(json, {
      id: 'root',
      type: 'Column',
      children: [
        {
          id: 'card',
          type: 'Card',
          child: {id: 'txt', type: 'Text', text: 'Hello', setText: '<Action>'},
        },
        {id: 'btn', type: 'Button', label: 'Go', setLabel: '<Action>', action: '<Action>'},
        {id: 'late', type: PLACEHOLDER_TYPE},
      ],
    });
    resolver.dispose();
  });
});

describe('NodeResolver defect coverage (fixes over the Python reference)', () => {
  it('resolves action context at dispatch time, not bind time (late resolution)', async () => {
    const {surface, resolver} = setup();
    const actions: A2uiClientAction[] = [];
    surface.onAction.subscribe(action => {
      actions.push(action);
    });
    surface.dataModel.set('/current_id', 'stale');
    add(surface, 'root', 'Button', {
      action: {event: {name: 'submit', context: {itemId: {path: '/current_id'}}}},
    });
    const root = getValue(resolver.rootNode);
    assert.ok(root);

    surface.dataModel.set('/current_id', 'fresh');
    (props(root).action as () => void)();
    await flush();

    assert.strictEqual(actions.length, 1);
    assert.deepStrictEqual(actions[0].context, {itemId: 'fresh'});
    resolver.dispose();
  });

  it('keeps a shared child alive for one parent when the other stops referencing it', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/label', 'shared text');
    add(surface, 'root', 'Column', {children: ['card_a', 'card_b']});
    add(surface, 'card_a', 'Card', {child: 'shared'});
    add(surface, 'card_b', 'Card', {child: 'shared'});
    add(surface, 'shared', 'Text', {text: {path: '/label'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const cardA = child(root, 'children', 0);
    const cardB = child(root, 'children', 1);
    const sharedViaA = child(cardA, 'child');
    const sharedViaB = child(cardB, 'child');
    assert.notStrictEqual(sharedViaA, sharedViaB);

    const cardAModel = surface.componentsModel.get('card_a');
    assert.ok(cardAModel);
    cardAModel.properties = {};

    assert.strictEqual(sharedViaA.disposed, true);
    assert.strictEqual(sharedViaB.disposed, false);
    surface.dataModel.set('/label', 'still updating');
    assert.strictEqual(props(sharedViaB).text, 'still updating');
    resolver.dispose();
  });

  it('keeps surviving template nodes across array growth and shrink (key stability)', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item_tpl', path: '/items'}});
    add(surface, 'item_tpl', 'Text', {text: {path: 'name'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const before = [...(props(root).children as ComponentNode[])];

    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}, {name: 'C'}]);
    const grown = props(root).children as ComponentNode[];
    assert.strictEqual(grown[0], before[0]);
    assert.strictEqual(grown[1], before[1]);
    assert.strictEqual(before[0].disposed, false);
    assert.strictEqual(before[1].disposed, false);

    surface.dataModel.set('/items', [{name: 'A'}]);
    const shrunk = props(root).children as ComponentNode[];
    assert.strictEqual(shrunk[0], before[0]);
    assert.strictEqual(before[1].disposed, true);
    resolver.dispose();
  });

  it('does not emit a parent props signal when only a child property changes (no bubbling)', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/username', 'Alice');
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    add(surface, 'root', 'Column', {children: ['bound', 'tpl_col']});
    add(surface, 'bound', 'Text', {text: {path: '/username'}});
    add(surface, 'tpl_col', 'Column', {children: {componentId: 'item_tpl', path: '/items'}});
    add(surface, 'item_tpl', 'Text', {text: {path: 'name'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const boundText = child(root, 'children', 0);
    const templateColumn = child(root, 'children', 1);
    const item0 = child(templateColumn, 'children', 0);

    const rootEmissions = countEmissions(root.props);
    const templateColumnEmissions = countEmissions(templateColumn.props);
    const boundEmissions = countEmissions(boundText.props);
    const item0Emissions = countEmissions(item0.props);

    surface.dataModel.set('/username', 'Bob');
    assert.strictEqual(boundEmissions.count, 1);
    assert.strictEqual(props(boundText).text, 'Bob');
    assert.strictEqual(rootEmissions.count, 0);

    // Editing one item's field re-fires the template's array subscription
    // (ancestor-path propagation); the item node must update while the
    // template parent's props stay identity-stable and silent.
    surface.dataModel.set('/items/0/name', 'A2');
    assert.strictEqual(props(item0).text, 'A2');
    assert.ok(item0Emissions.count >= 1);
    assert.strictEqual(templateColumnEmissions.count, 0);
    assert.strictEqual(rootEmissions.count, 0);

    rootEmissions.dispose();
    templateColumnEmissions.dispose();
    boundEmissions.dispose();
    item0Emissions.dispose();
    resolver.dispose();
  });
});

describe('NodeResolver malformed and unusual payloads', () => {
  it('renders cyclic references as placeholders instead of recursing', () => {
    const {surface, resolver} = setup();
    const errors: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      errors.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'Card', {child: 'a'});
    add(surface, 'a', 'Card', {child: 'b'});
    add(surface, 'b', 'Card', {child: 'a'});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const a = child(root, 'child');
    const b = child(a, 'child');
    const backReference = child(b, 'child');
    assert.strictEqual(backReference.type, PLACEHOLDER_TYPE);
    assert.strictEqual(backReference.componentId, 'a');
    assert.ok(errors.some(e => e.code === 'CYCLIC_REFERENCE'));
    assert.ok(resolver.activeNodeCount <= 5);
    resolver.dispose();
  });

  it('renders a self-referencing component as a placeholder child', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Card', {child: 'root'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(child(root, 'child').type, PLACEHOLDER_TYPE);
    resolver.dispose();
  });

  it('propagates changes to non-plain object values', () => {
    // The data model shallow-clones values when notifying, so the non-plain
    // object sits one level down, where the clone preserves its reference.
    const {surface, resolver} = setup();
    const first = new Map([['k', 1]]);
    const second = new Map([['k', 2]]);
    surface.dataModel.set('/blob', {wrapper: first});
    add(surface, 'root', 'Text', {text: {path: '/blob'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual((props(root).text as {wrapper: unknown}).wrapper, first);

    surface.dataModel.set('/blob', {wrapper: second});
    assert.strictEqual((props(root).text as {wrapper: unknown}).wrapper, second);
    resolver.dispose();
  });

  it('keeps a stable placeholder for a component whose type is not in the catalog', () => {
    const {surface, resolver} = setup();
    const errors: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      errors.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'Card', {child: 'weird'});
    add(surface, 'weird', 'Bogus', {});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const placeholder = child(root, 'child');
    assert.strictEqual(placeholder.type, PLACEHOLDER_TYPE);
    const reportsBefore = errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length;

    const rootModel = surface.componentsModel.get('root');
    assert.ok(rootModel);
    rootModel.properties = {child: 'weird'};
    rootModel.properties = {child: 'weird'};

    assert.strictEqual(child(root, 'child'), placeholder);
    assert.strictEqual(
      errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length,
      reportsBefore,
    );
    resolver.dispose();
  });
});

describe('NodeResolver construction gate', () => {
  it('rejects a catalog instance other than the surface catalog', () => {
    const catalogA = makeCatalog();
    const catalogB = makeCatalog();
    const surface = new SurfaceModel('surf-1', catalogA);
    assert.throws(() => new NodeResolver(surface, catalogB), /same catalog instance/);
  });

  it('rejects a schema-only catalog at compile time', () => {
    // The assertion is the @ts-expect-error below: the build fails if a
    // schema-only catalog ever satisfies NodeResolver's constructor bound.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function schemaOnlyCatalogIsRejected(
      surface: SurfaceModel<ComponentApi, FunctionApi>,
      schemaOnly: Catalog<ComponentApi, FunctionApi>,
    ) {
      // @ts-expect-error a schema-only catalog has no function implementations
      return new NodeResolver(surface, schemaOnly);
    }
    assert.strictEqual(typeof schemaOnlyCatalogIsRejected, 'function');
  });

  it('disposes the whole tree with the resolver, leaving no live nodes', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    add(surface, 'root', 'Column', {children: ['card', 'tpl_col']});
    add(surface, 'card', 'Card', {child: 'txt'});
    add(surface, 'txt', 'Text', {text: 'Hello'});
    add(surface, 'tpl_col', 'Column', {children: {componentId: 'item_tpl', path: '/items'}});
    add(surface, 'item_tpl', 'Text', {text: {path: 'name'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.ok(resolver.activeNodeCount >= 6);

    resolver.dispose();
    assert.strictEqual(resolver.activeNodeCount, 0);
    assert.strictEqual(getValue(resolver.rootNode), undefined);
    assert.strictEqual(root.disposed, true);

    // A data change after disposal must not resurrect any binding.
    surface.dataModel.set('/items', [{name: 'X'}]);
    assert.strictEqual(resolver.activeNodeCount, 0);
  });
});
