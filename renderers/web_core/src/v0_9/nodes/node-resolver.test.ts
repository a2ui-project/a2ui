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
import {
  ActionSchema,
  ChildListSchema,
  ComponentIdSchema,
  DynamicStringSchema,
} from '../schema/common-types.js';
import {effect, getValue, peekValue, Signal} from '../reactivity/signals.js';
import * as v0_9 from '../index.js';
import {ComponentNode, NodeProps, PLACEHOLDER_TYPE, isComponentNode} from './component-node.js';
import {NodeResolver} from './node-resolver.js';
import {ResolvedBinding, isWritable} from './resolved-binding.js';

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
  schema: z.object({child: ComponentIdSchema.optional()}),
};
const ColumnApi = {
  name: 'Column',
  schema: z.object({children: ChildListSchema.optional()}),
};
const TabsApi = {
  name: 'Tabs',
  schema: z.object({
    items: z.array(z.object({title: z.string(), child: ComponentIdSchema})).optional(),
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

/** Unwraps a dynamic prop's `ResolvedBinding` snapshot, asserting it is one. */
function bound(node: ComponentNode, key: string): unknown {
  const binding = props(node)[key];
  assert.ok(binding instanceof ResolvedBinding, `expected ${key} to resolve to a ResolvedBinding`);
  return binding.value;
}

function child(node: ComponentNode, key: string, index?: number): ComponentNode {
  const value = index === undefined ? props(node)[key] : (props(node)[key] as unknown[])[index];
  assert.ok(isComponentNode(value), `expected ${key}[${index ?? ''}] to be a ComponentNode`);
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
    assert.strictEqual(bound(upgraded, 'text'), 'Hello Node');

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
    assert.ok(isComponentNode(root));
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
    assert.strictEqual(bound(root, 'text'), 'Alice');

    surface.dataModel.set('/username', 'Bob');
    assert.strictEqual(bound(root, 'text'), 'Bob');
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
    assert.strictEqual(bound(textNode, 'text'), 'Hello');
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
    assert.strictEqual(bound(children[0], 'text'), 'C1');
    assert.strictEqual(bound(children[1], 'text'), 'C2');
    resolver.dispose();
  });

  it('gives repeated references to one component distinct sibling nodes and instance ids', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['a', 'a']});
    add(surface, 'a', 'Text', {text: 'dup'});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const children = props(root).children as ComponentNode[];
    assert.strictEqual(children.length, 2);
    assert.notStrictEqual(children[0], children[1]);
    assert.strictEqual(children[0].instanceId, 'a');
    assert.strictEqual(children[1].instanceId, 'a#2');
    assert.strictEqual(bound(children[1], 'text'), 'dup');

    // Instance ids stay distinct when a list edit shifts the ordinals.
    add(surface, 'x', 'Text', {text: 'x'});
    const rootModel = surface.componentsModel.get('root');
    assert.ok(rootModel);
    rootModel.properties = {children: ['x', 'a', 'a']};
    const after = props(root).children as ComponentNode[];
    assert.deepStrictEqual(
      after.map(n => n.instanceId),
      ['x', 'a', 'a#2'],
    );
    resolver.dispose();
  });

  it('resolves a plain array of component ids as a child list', () => {
    // The intuitive third-party spelling: z.array(ComponentIdSchema) instead
    // of the ChildList union. The marker sits on the elements.
    const PlainListApi = {
      name: 'PlainList',
      schema: z.object({children: z.array(ComponentIdSchema).optional()}),
    };
    const catalog = new Catalog<ComponentApi>('plain-list-catalog', [TextApi, PlainListApi], []);
    const surface = new SurfaceModel('surf-1', catalog);
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'PlainList', {children: ['a', 'b']});
    add(surface, 'a', 'Text', {text: 'A'});
    add(surface, 'b', 'Text', {text: 'B'});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const children = props(root).children as ComponentNode[];
    assert.strictEqual(children.length, 2);
    assert.ok(isComponentNode(children[0]));
    assert.ok(isComponentNode(children[1]));
    assert.strictEqual(bound(children[0], 'text'), 'A');
    assert.strictEqual(bound(children[1], 'text'), 'B');
    resolver.dispose();
  });

  it('keeps instance ids distinct when a component id mimics a suffixed or scoped form', () => {
    const PaneApi = {
      name: 'Pane',
      schema: z.object({
        main: ComponentIdSchema.optional(),
        items: ChildListSchema.optional(),
      }),
    };
    const catalog = new Catalog<ComponentApi>('mimic-catalog', [TextApi, ColumnApi, PaneApi], []);

    // A sibling literally named 'a#2' next to duplicates of 'a'.
    {
      const surface = new SurfaceModel('surf-a', catalog);
      const resolver = new NodeResolver(surface, catalog);
      add(surface, 'root', 'Column', {children: ['a', 'a', 'a#2']});
      add(surface, 'a', 'Text', {text: 'x'});
      add(surface, 'a#2', 'Text', {text: 'y'});
      const root = getValue(resolver.rootNode);
      assert.ok(root);
      const ids = (props(root).children as ComponentNode[]).map(n => n.instanceId);
      assert.strictEqual(new Set(ids).size, ids.length, `collision in ${ids.join(', ')}`);
      resolver.dispose();
    }

    // A root-scoped component literally named like a template instance,
    // next to the template instance it mimics.
    {
      const surface = new SurfaceModel('surf-b', catalog);
      const resolver = new NodeResolver(surface, catalog);
      surface.dataModel.set('/items', [{v: 'row0'}]);
      add(surface, 'root', 'Pane', {
        main: 'a-[/items/0]',
        items: {componentId: 'a', path: '/items'},
      });
      add(surface, 'a-[/items/0]', 'Text', {text: 'literal'});
      add(surface, 'a', 'Text', {text: {path: 'v'}});
      const root = getValue(resolver.rootNode);
      assert.ok(root);
      const rootProps = props(root);
      const nodes = [rootProps.main, ...(rootProps.items as ComponentNode[])] as ComponentNode[];
      const ids = nodes.map(n => n.instanceId);
      assert.strictEqual(new Set(ids).size, ids.length, `collision in ${ids.join(', ')}`);
      resolver.dispose();
    }
  });

  it('keeps edges distinct when property names and component ids share delimiters', () => {
    // Field 'a' referencing 'b>c' and field 'a>b' referencing 'c' would
    // concatenate to the same edge key without escaping, disposing the
    // first node the moment the second resolves.
    const TrickyApi = {
      name: 'Tricky',
      schema: z.object({
        'a': ComponentIdSchema.optional(),
        'a>b': ComponentIdSchema.optional(),
      }),
    };
    const catalog = new Catalog<ComponentApi>('tricky-catalog', [TextApi, TrickyApi], []);
    const surface = new SurfaceModel('surf-1', catalog);
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'Tricky', {'a': 'b>c', 'a>b': 'c'});
    add(surface, 'b>c', 'Text', {text: 'first'});
    add(surface, 'c', 'Text', {text: 'second'});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const first = props(root)['a'] as ComponentNode;
    const second = props(root)['a>b'] as ComponentNode;
    assert.ok(isComponentNode(first) && isComponentNode(second));
    assert.strictEqual(first.disposed, false);
    assert.strictEqual(second.disposed, false);
    assert.strictEqual(bound(first, 'text'), 'first');
    assert.strictEqual(bound(second, 'text'), 'second');

    // Both stay live: an update must reach the first node.
    const model = surface.componentsModel.get('b>c');
    assert.ok(model);
    model.properties = {text: 'updated'};
    assert.strictEqual(bound(props(root)['a'] as ComponentNode, 'text'), 'updated');
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
    assert.strictEqual(bound(children[0], 'text'), 'A');
    assert.strictEqual(bound(children[1], 'text'), 'B');
    resolver.dispose();
  });

  it('renders placeholders progressively and emits the parent exactly once on upgrade', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['late']});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const placeholder = child(root, 'children', 0);
    assert.strictEqual(placeholder.type, PLACEHOLDER_TYPE);
    assert.strictEqual(placeholder.state, 'pending');
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
    assert.strictEqual(upgraded.state, 'resolved');
    assert.strictEqual(bound(upgraded, 'text'), 'Arrived');
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
    assert.strictEqual(bound(root, 'text'), undefined);
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
    assert.strictEqual(bound(after[1], 'text'), 'C3');
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
    assert.strictEqual(bound(children[0], 'text'), 'T0');
    assert.strictEqual(explicitChild.disposed, true);
    resolver.dispose();
  });

  it('resolves function-call bindings reactively', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/username', 'alice');
    add(surface, 'root', 'Text', {text: {call: 'shout', args: {value: {path: '/username'}}}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(bound(root, 'text'), 'ALICE');

    surface.dataModel.set('/username', 'bob');
    assert.strictEqual(bound(root, 'text'), 'BOB');
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
    assert.ok(isComponentNode(first));
    assert.strictEqual(bound(first, 'text'), 'First');
    const second = items[1].child;
    assert.ok(isComponentNode(second));
    assert.strictEqual(bound(second, 'text'), 'Second');
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
    assert.strictEqual(bound(grown[2], 'text'), 'C');

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
    assert.deepStrictEqual(json, {
      id: 'root',
      type: 'Column',
      children: [
        {
          id: 'card',
          type: 'Card',
          child: {id: 'txt', type: 'Text', text: 'Hello'},
        },
        {id: 'btn', type: 'Button', label: 'Go', action: '<Action>'},
        {id: 'late', type: PLACEHOLDER_TYPE, state: 'pending'},
      ],
    });
    resolver.dispose();
  });
});

describe('NodeResolver defect coverage (fixes over the Python reference)', () => {
  it('does not emit when an action-bearing component is resent unchanged', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: ['b1']});
    add(surface, 'b1', 'Button', {label: 'Go', action: {event: {name: 'tap'}}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const button = (peekValue(root.props)['children'] as ComponentNode[])[0];
    assert.strictEqual(typeof peekValue(button.props)['action'], 'function');

    const emissions = countEmissions(button.props);
    const model = surface.componentsModel.get('b1');
    assert.ok(model);
    model.properties = {label: 'Go', action: {event: {name: 'tap'}}};
    assert.strictEqual(
      emissions.count,
      0,
      'an unchanged resend must not emit for action-bearing components',
    );

    const closureBefore = peekValue(button.props)['action'];
    model.properties = {label: 'Go', action: {event: {name: 'other'}}};
    assert.strictEqual(emissions.count, 1);
    assert.notStrictEqual(peekValue(button.props)['action'], closureBefore);

    emissions.dispose();
    resolver.dispose();
  });

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
    assert.strictEqual(bound(sharedViaB, 'text'), 'still updating');
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
    assert.strictEqual(bound(boundText, 'text'), 'Bob');
    assert.strictEqual(rootEmissions.count, 0);

    // Editing one item's field re-fires the template's array subscription;
    // the item node must update while the template parent's props stay
    // identity-stable and silent.
    surface.dataModel.set('/items/0/name', 'A2');
    assert.strictEqual(bound(item0, 'text'), 'A2');
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
    assert.strictEqual(backReference.state, 'cyclic');
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
    assert.strictEqual((bound(root, 'text') as {wrapper: unknown}).wrapper, first);

    surface.dataModel.set('/blob', {wrapper: second});
    assert.strictEqual((bound(root, 'text') as {wrapper: unknown}).wrapper, second);
    resolver.dispose();
  });

  it('dispatches UNKNOWN_COMPONENT_TYPE once per component, not per referencing edge', () => {
    const {surface, resolver} = setup();
    const errors: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      errors.push(e as Record<string, unknown>);
    });
    add(surface, 'weird', 'Bogus', {});
    add(surface, 'root', 'Column', {children: ['weird', 'weird']});
    assert.ok(getValue(resolver.rootNode));
    assert.strictEqual(errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length, 1);

    surface.componentsModel.removeComponent('weird');
    add(surface, 'weird', 'Bogus', {});
    assert.strictEqual(errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length, 2);
    resolver.dispose();
  });

  // Both stale-root tests register async listeners ahead of the resolver, as
  // any subscriber registered before it does in production: each event then
  // delivers to the resolver only after an await, by which time the model
  // has moved on.
  function setupWithDelayedDelivery() {
    const TextApi = {
      name: 'Text',
      schema: z.object({text: DynamicStringSchema.optional()}),
    };
    const catalog = new Catalog<ComponentApi>('stale-root-catalog', [TextApi], []);
    const surface = new SurfaceModel('surf-1', catalog);
    surface.componentsModel.onCreated.subscribe(async () => {
      await Promise.resolve();
    });
    surface.componentsModel.onDeleted.subscribe(async () => {
      await Promise.resolve();
    });
    add(surface, 'root', 'Text', {text: 'first'});
    const resolver = new NodeResolver(surface, catalog);
    return {surface, resolver};
  }

  it('does not rebuild the current root when a stale creation event arrives', async () => {
    const {surface, resolver} = setupWithDelayedDelivery();
    await flush();
    const seen: Array<ComponentNode | undefined> = [];
    const stop = effect(() => {
      seen.push(getValue(resolver.rootNode));
    });

    // Replace the root twice in one synchronous block: the intermediate
    // creation is stale by the time it delivers.
    surface.componentsModel.removeComponent('root');
    add(surface, 'root', 'Text', {text: 'intermediate'});
    surface.componentsModel.removeComponent('root');
    add(surface, 'root', 'Text', {text: 'final'});
    await flush();

    const instances = new Set(seen.filter(Boolean));
    // The initially bound root plus one rebind to the final model; the stale
    // creation must not add a dispose-and-rebuild of the already-current
    // tree.
    assert.strictEqual(
      instances.size,
      2,
      `saw ${instances.size} distinct root nodes after replacement`,
    );
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual((root.toJSON() as {text: unknown}).text, 'final');
    stop();
    resolver.dispose();
  });

  it('does not create a phantom root from a stale creation after the root is gone', async () => {
    const {surface, resolver} = setupWithDelayedDelivery();
    await flush();
    const seen: Array<ComponentNode | undefined> = [];
    const stop = effect(() => {
      seen.push(getValue(resolver.rootNode));
    });

    surface.componentsModel.removeComponent('root');
    add(surface, 'root', 'Text', {text: 'brief'});
    surface.componentsModel.removeComponent('root');
    await flush();

    // The stale creation delivers while the model has no root; nothing may
    // surface a pending stand-in for a root that does not exist.
    assert.ok(
      seen.every(node => !node || !node.isPlaceholder),
      'a placeholder root was surfaced for an absent root',
    );
    assert.strictEqual(getValue(resolver.rootNode), undefined);
    stop();
    resolver.dispose();
  });

  it('reports again after delete and re-add when the component id contains colons', () => {
    const {surface, resolver} = setup();
    const errors: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      errors.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'Column', {children: ['weird:x']});
    add(surface, 'weird:x', 'Bogus', {});
    assert.strictEqual(errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length, 1);

    surface.componentsModel.removeComponent('weird:x');
    add(surface, 'weird:x', 'Bogus', {});
    assert.strictEqual(errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length, 2);
    resolver.dispose();
  });

  it('reports a cycle again after it is fixed and reintroduced by a property update', () => {
    const {surface, resolver} = setup();
    const errors: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      errors.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'Card', {child: 'card'});
    add(surface, 'card', 'Card', {child: 'card'});
    add(surface, 'leaf', 'Text', {text: 'ok'});
    assert.strictEqual(errors.filter(e => e.code === 'CYCLIC_REFERENCE').length, 1);

    const cardModel = surface.componentsModel.get('card');
    assert.ok(cardModel);
    cardModel.properties = {child: 'leaf'};
    assert.strictEqual(errors.filter(e => e.code === 'CYCLIC_REFERENCE').length, 1);

    cardModel.properties = {child: 'card'};
    assert.strictEqual(errors.filter(e => e.code === 'CYCLIC_REFERENCE').length, 2);
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
    assert.strictEqual(placeholder.type, 'Bogus');
    assert.strictEqual(placeholder.state, 'unknown-type');
    assert.deepStrictEqual(placeholder.toJSON(), {
      id: 'weird',
      type: 'Bogus',
      state: 'unknown-type',
    });
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

describe('NodeResolver absent dynamic properties', () => {
  it('represents omitted dynamic properties as read-only bindings at every level', () => {
    const GroupApi = {
      name: 'Group',
      schema: z.object({
        title: DynamicStringSchema.optional(),
        group: z
          .object({
            value: DynamicStringSchema.optional(),
            label: z.string().optional(),
          })
          .optional(),
      }),
    };
    const catalog = new Catalog<ComponentApi>('group-catalog', [GroupApi], []);
    const surface = new SurfaceModel('surf-1', catalog);
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'Group', {group: {label: 'x'}});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const rootProps = props(root);
    const title = rootProps.title;
    assert.ok(title instanceof ResolvedBinding && !isWritable(title));
    assert.strictEqual(title.value, undefined);
    const group = rootProps.group as Record<string, unknown>;
    const value = group.value;
    assert.ok(value instanceof ResolvedBinding && !isWritable(value), 'nested omitted dynamic');
    assert.strictEqual(value.value, undefined);
    assert.strictEqual(group.label, 'x');
    resolver.dispose();
  });
});

describe('NodeResolver child markers survive schema description', () => {
  it('resolves a child whose componentId schema was described', () => {
    const Api = {
      name: 'DescribedCard',
      schema: z.object({child: ComponentIdSchema.describe('The child to show.').optional()}),
    };
    const TextApi = {name: 'Text', schema: z.object({text: DynamicStringSchema.optional()})};
    const catalog = new Catalog<ComponentApi>('described-catalog', [Api, TextApi], []);
    const surface = new SurfaceModel('surf-1', catalog);
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'DescribedCard', {child: 'kid'});
    add(surface, 'kid', 'Text', {text: 'child text'});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const child = props(root).child;
    assert.ok(isComponentNode(child), 'expected a resolved child node');
    assert.strictEqual((child as ComponentNode).componentId, 'kid');
    resolver.dispose();
  });

  it('resolves a child list whose schema was described', () => {
    const Api = {
      name: 'DescribedColumn',
      schema: z.object({children: ChildListSchema.describe('The children.').optional()}),
    };
    const TextApi = {name: 'Text', schema: z.object({text: DynamicStringSchema.optional()})};
    const catalog = new Catalog<ComponentApi>('described-catalog', [Api, TextApi], []);
    const surface = new SurfaceModel('surf-1', catalog);
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'DescribedColumn', {children: ['a', 'b']});
    add(surface, 'a', 'Text', {text: 'one'});
    add(surface, 'b', 'Text', {text: 'two'});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const children = props(root).children as ComponentNode[];
    assert.strictEqual(children.length, 2);
    assert.ok(children.every(isComponentNode));
    resolver.dispose();
  });

  it('still recognizes a hand-authored REF description', () => {
    const Api = {
      name: 'HandAuthored',
      schema: z.object({
        child: z
          .string()
          .describe('REF:common_types.json#/$defs/ComponentId|Authored by hand.')
          .optional(),
      }),
    };
    const TextApi = {name: 'Text', schema: z.object({text: DynamicStringSchema.optional()})};
    const catalog = new Catalog<ComponentApi>('hand-catalog', [Api, TextApi], []);
    const surface = new SurfaceModel('surf-1', catalog);
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'HandAuthored', {child: 'kid'});
    add(surface, 'kid', 'Text', {text: 'x'});

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.ok(isComponentNode(props(root).child), 'expected a resolved child node');
    resolver.dispose();
  });
});

describe('NodeResolver resolved bindings (write path)', () => {
  it('makes bindings writable iff the payload bound a data path', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/username', 'alice');
    add(surface, 'root', 'Column', {children: ['lit', 'bnd', 'call']});
    add(surface, 'lit', 'Text', {text: 'Literal'});
    add(surface, 'bnd', 'Text', {text: {path: '/username'}});
    add(surface, 'call', 'Text', {text: {call: 'shout', args: {value: {path: '/username'}}}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const [literalNode, boundNode, callNode] = props(root).children as ComponentNode[];

    const literal = props(literalNode).text as ResolvedBinding<unknown>;
    assert.strictEqual(literal.value, 'Literal');
    assert.strictEqual(isWritable(literal), false);
    assert.strictEqual('set' in literal, false);

    const call = props(callNode).text as ResolvedBinding<unknown>;
    assert.strictEqual(call.value, 'ALICE');
    assert.strictEqual(isWritable(call), false);
    assert.strictEqual('set' in call, false);

    const pathBound = props(boundNode).text as ResolvedBinding<unknown>;
    assert.strictEqual(pathBound.value, 'alice');
    if (!isWritable(pathBound)) {
      assert.fail('expected a writable binding');
    }
    pathBound.set('bob');
    assert.strictEqual(surface.dataModel.get('/username'), 'bob');
    assert.strictEqual(bound(boundNode, 'text'), 'bob');
    resolver.dispose();
  });

  it('rebinding a prop to a new path replaces the binding even when values are equal', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/a', 'same');
    surface.dataModel.set('/b', 'same');
    add(surface, 'root', 'Text', {text: {path: '/a'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);

    surface.componentsModel.get('root')!.properties = {text: {path: '/b'}};

    const binding = props(root).text as ResolvedBinding<unknown>;
    if (!isWritable(binding)) {
      assert.fail('expected a writable binding');
    }
    assert.strictEqual(binding.path, '/b');
    binding.set('written');
    assert.strictEqual(surface.dataModel.get('/b'), 'written');
    assert.strictEqual(surface.dataModel.get('/a'), 'same');
    resolver.dispose();
  });

  it("writes through a template item binding to that item's scoped path", () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item_tpl', path: '/items'}});
    add(surface, 'item_tpl', 'Text', {text: {path: 'name'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const children = props(root).children as ComponentNode[];
    const item1 = props(children[1]).text as ResolvedBinding<unknown>;
    if (!isWritable(item1)) {
      assert.fail('expected a writable binding');
    }
    item1.set('B2');

    assert.strictEqual(surface.dataModel.get('/items/1/name'), 'B2');
    assert.strictEqual(bound(children[1], 'text'), 'B2');
    assert.strictEqual(bound(children[0], 'text'), 'A');
    resolver.dispose();
  });

  it('serializes path-bound properties as plain snapshot values', () => {
    const {surface, resolver} = setup();
    surface.dataModel.set('/username', 'alice');
    add(surface, 'root', 'Text', {text: {path: '/username'}});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.deepStrictEqual(root.toJSON(), {id: 'root', type: 'Text', text: 'alice'});
    resolver.dispose();
  });
});

describe('NodeResolver stale event delivery', () => {
  it('reconciles events emitted before construction but delivered after', async () => {
    const catalog = makeCatalog();
    const surface = new SurfaceModel('surf-1', catalog);
    add(surface, 'root', 'Text', {text: 'original'});
    // Model events deliver to each listener in turn, awaiting async
    // listeners, so this delayer forces later subscribers to receive the
    // deletion after further mutations have happened.
    surface.componentsModel.onDeleted.subscribe(async () => {
      await flush();
    });
    surface.componentsModel.removeComponent('root');
    add(surface, 'root', 'Text', {text: 'fresh'});

    const resolver = new NodeResolver(surface, catalog);
    await flush();
    await flush();

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    assert.strictEqual(root.disposed, false);
    assert.strictEqual(bound(root, 'text'), 'fresh');
    resolver.dispose();
  });

  it('replaces an unknown-type node whose component was replaced before a delayed deletion delivery', async () => {
    const catalog = makeCatalog();
    const surface = new SurfaceModel('surf-1', catalog);
    surface.componentsModel.onDeleted.subscribe(async () => {
      await flush();
    });
    const resolver = new NodeResolver(surface, catalog);
    const errors: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      errors.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'Card', {child: 'weird'});
    add(surface, 'weird', 'Bogus', {});
    assert.strictEqual(errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length, 1);

    surface.componentsModel.removeComponent('weird');
    add(surface, 'weird', 'Bogus2', {});
    await flush();
    await flush();

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const node = child(root, 'child');
    assert.strictEqual(node.type, 'Bogus2');
    assert.strictEqual(node.state, 'unknown-type');
    assert.strictEqual(errors.filter(e => e.code === 'UNKNOWN_COMPONENT_TYPE').length, 2);
    resolver.dispose();
  });

  it('keeps waiting for a component whose add and remove both preceded a delayed delivery', async () => {
    const catalog = makeCatalog();
    const surface = new SurfaceModel('surf-1', catalog);
    surface.componentsModel.onCreated.subscribe(async () => {
      await flush();
    });
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'Column', {children: ['kid']});
    await flush();
    await flush();

    // The delayed onCreated delivery clears the waiting registration; the
    // deletion then reuses the pending placeholder. A later legitimate add
    // must still upgrade it.
    add(surface, 'kid', 'Text', {text: 'one'});
    surface.componentsModel.removeComponent('kid');
    await flush();
    await flush();
    add(surface, 'kid', 'Text', {text: 'two'});
    await flush();
    await flush();

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const kid = child(root, 'children', 0);
    assert.strictEqual(kid.state, 'resolved');
    assert.strictEqual(bound(kid, 'text'), 'two');
    resolver.dispose();
  });

  it('rebinds a child node whose component model was replaced before a delayed deletion delivery', async () => {
    const catalog = makeCatalog();
    const surface = new SurfaceModel('surf-1', catalog);
    surface.componentsModel.onDeleted.subscribe(async () => {
      await flush();
    });
    const resolver = new NodeResolver(surface, catalog);
    add(surface, 'root', 'Card', {child: 'leaf'});
    add(surface, 'leaf', 'Text', {text: 'old'});

    surface.componentsModel.removeComponent('leaf');
    add(surface, 'leaf', 'Text', {text: 'new'});
    await flush();
    await flush();

    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const leaf = child(root, 'child');
    assert.strictEqual(leaf.disposed, false);
    assert.strictEqual(bound(leaf, 'text'), 'new');

    // The node must be bound to the current model, not the replaced one.
    const leafModel = surface.componentsModel.get('leaf');
    assert.ok(leafModel);
    leafModel.properties = {text: 'updated'};
    assert.strictEqual(bound(child(root, 'child'), 'text'), 'updated');
    resolver.dispose();
  });
});

describe('NodeResolver constructor checks and disposal', () => {
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

  it('exposes no mutation API on resolved nodes', () => {
    const {surface, resolver} = setup();
    add(surface, 'root', 'Column', {children: []});
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    // @ts-expect-error setProps lives on MutableComponentNode, internal to the resolver
    const _setProps = root.setProps;
    // @ts-expect-error dispose lives on MutableComponentNode, internal to the resolver
    const _dispose = root.dispose;
    // ComponentNode is an interface: the package ships no runtime
    // constructor for nodes at all.
    assert.strictEqual('ComponentNode' in v0_9, false);
    // @ts-expect-error MutableComponentNode is not exported from the package
    const _leaked = v0_9.MutableComponentNode;
    resolver.dispose();
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
