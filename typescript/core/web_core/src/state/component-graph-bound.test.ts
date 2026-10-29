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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';

import {Catalog} from '../catalog/types.js';
import {A2uiRecursionError, A2uiValidationError} from '../errors.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {ValidationConfig} from '../validation/integrity-checker.js';
import {ComponentGraphBound} from './component-graph-bound.js';
import {ComponentModel} from './component-model.js';

/** The config an agent's renderer state uses: the graph checks are deferred. */
const DEFERRED: ValidationConfig = {
  allowDanglingReferences: true,
  allowMissingRoot: true,
  allowOrphanComponents: true,
};

/**
 * A catalog whose `Box` holds children and limits their types, whose `Label`
 * may only be placed under a `Panel`, and whose `Panel` holds one child with
 * no limits.
 */
function compositionCatalog(): Catalog<any, any> {
  return Catalog.fromJson(
    {
      catalogId: 'custom',
      components: {
        Box: {
          type: 'object',
          properties: {children: {$ref: '#/$defs/ChildList'}},
          allowedChildren: ['Box', 'Label'],
        },
        Label: {
          type: 'object',
          properties: {text: {type: 'string'}},
          allowedParents: ['Panel'],
        },
        Panel: {type: 'object', properties: {child: {$ref: '#/$defs/ComponentId'}}},
      },
    },
    '1.0',
  );
}

/** A catalog like `compositionCatalog` that declares no composition limits. */
function plainCatalog(): Catalog<any, any> {
  return Catalog.fromJson(
    {
      catalogId: 'custom',
      components: {
        Box: {type: 'object', properties: {children: {$ref: '#/$defs/ChildList'}}},
        Label: {type: 'object', properties: {text: {type: 'string'}}},
        Panel: {type: 'object', properties: {child: {$ref: '#/$defs/ComponentId'}}},
      },
    },
    '1.0',
  );
}

function createProcessor(
  config: ValidationConfig | undefined,
  catalog: Catalog<any, any> = compositionCatalog(),
) {
  const processor = new MessageProcessor([catalog as Catalog<any>], undefined, {
    validationConfig: config,
  });
  processor.processMessages([
    {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'custom'}},
  ]);
  return processor;
}

function update(processor: MessageProcessor, ...components: Array<Record<string, unknown>>) {
  processor.processMessages([{version: '1.0', updateComponents: {surfaceId: 's', components}}]);
}

/** The surface's components as plain objects, keyed by id. */
function snapshot(processor: MessageProcessor): Record<string, unknown> {
  const surface = processor.model.getSurface('s')!;
  const out: Record<string, unknown> = {};
  for (const [id, component] of surface.componentsModel.entries) {
    out[id] = component.componentTree;
  }
  return out;
}

/** The error `body` throws as `Class: message`, or `ok`. */
function outcome(body: () => void): string {
  try {
    body();
    return 'ok';
  } catch (e) {
    return e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  }
}

describe('ComponentGraphBound', () => {
  const graph = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

  it('is undefined for a graph with a cycle', () => {
    assert.strictEqual(ComponentGraphBound.of(graph({a: ['b'], b: ['c'], c: ['a']})), undefined);
  });

  it('records references and parents, ignoring ids the graph does not hold', () => {
    const bound = ComponentGraphBound.of(graph({a: ['b', 'missing'], b: []}))!;
    assert.deepStrictEqual(bound.childrenOf('a'), ['b', 'missing']);
    assert.deepStrictEqual([...bound.parentsOf('b')], ['a']);
    assert.deepStrictEqual([...bound.parentsOf('missing')], ['a']);
  });

  it('admits a batch that keeps the graph acyclic and within the limit', () => {
    const bound = ComponentGraphBound.of(graph({a: ['b'], b: []}))!;
    assert.strictEqual(
      bound.admits(graph({b: ['c'], c: []}), 5, id => id in {a: 1, b: 1}),
      true,
    );
  });

  it('does not admit a batch that closes a cycle', () => {
    const bound = ComponentGraphBound.of(graph({a: ['b'], b: ['c'], c: []}))!;
    assert.strictEqual(
      bound.admits(graph({c: ['a']}), 50, () => true),
      false,
    );
  });

  it('does not admit a self-reference', () => {
    const bound = ComponentGraphBound.of(graph({a: []}))!;
    assert.strictEqual(
      bound.admits(graph({a: ['a']}), 50, () => true),
      false,
    );
  });

  it('does not admit a chain longer than the limit, counting references to held ids only', () => {
    const bound = ComponentGraphBound.of(graph({a: ['b'], b: ['c'], c: []}))!;
    // a -> b -> c -> d is three references.
    assert.strictEqual(
      ComponentGraphBound.of(graph({a: ['b'], b: ['c'], c: []}))!.admits(
        graph({c: ['d']}),
        2,
        id => id !== 'd',
      ),
      true,
    );
    assert.strictEqual(
      bound.admits(graph({c: ['d'], d: []}), 2, () => true),
      false,
    );
  });

  it('updates references and parents even when it does not admit the batch', () => {
    const bound = ComponentGraphBound.of(graph({a: ['b'], b: []}))!;
    assert.strictEqual(
      bound.admits(graph({b: ['a']}), 50, () => true),
      false,
    );
    assert.deepStrictEqual(bound.childrenOf('b'), ['a']);
    assert.deepStrictEqual([...bound.parentsOf('a')], ['b']);
  });
});

describe('MessageProcessor composition check without a validation config', () => {
  it('checks a component added from outside the processor in a catalog with limits', () => {
    const processor = createProcessor(undefined, plainCatalog());
    const surface = processor.model.getSurface('s')!;
    // The surface's own catalog declares no limits; this component's does.
    surface.componentsModel.addComponent(
      new ComponentModel('x', 'Label', {text: 'Hi'}, compositionCatalog()),
    );
    assert.throws(
      () => update(processor, {id: 'b', component: 'Box', children: ['x']}),
      (e: unknown) => e instanceof A2uiValidationError && e.code === 'UNALLOWED_PARENT',
    );
  });

  it('adds no listeners to the surface components', () => {
    const processor = createProcessor(undefined, compositionCatalog());
    update(processor, {id: 'root', component: 'Panel', child: 'a'});
    const listeners = (processor.model.getSurface('s')!.componentsModel.onCreated as any)
      .listeners as Set<unknown>;
    assert.strictEqual(listeners.size, 0);
  });
});

describe('MessageProcessor under a config that defers the graph checks', () => {
  it('rejects a cycle that a later message closes, and leaves the surface unchanged', () => {
    const processor = createProcessor(DEFERRED);
    update(processor, {id: 'root', component: 'Box', children: ['a']});
    update(processor, {id: 'a', component: 'Box', children: ['b']});
    const before = snapshot(processor);
    assert.throws(
      () => update(processor, {id: 'b', component: 'Box', children: ['root']}),
      A2uiRecursionError,
    );
    assert.deepStrictEqual(snapshot(processor), before);
  });

  it('rejects a self-reference', () => {
    const processor = createProcessor(DEFERRED);
    update(processor, {id: 'root', component: 'Box', children: ['a']});
    assert.throws(
      () => update(processor, {id: 'a', component: 'Box', children: ['a']}),
      /references itself/,
    );
  });

  it('rejects a chain deeper than maxDepth built over several messages', () => {
    const processor = createProcessor({...DEFERRED, maxDepth: 2});
    update(processor, {id: 'a', component: 'Box', children: ['b']});
    update(processor, {id: 'b', component: 'Box', children: ['c']});
    update(processor, {id: 'c', component: 'Box', children: ['d']});
    // a -> b -> c -> d is three references once `d` arrives.
    assert.throws(
      () => update(processor, {id: 'd', component: 'Box', children: []}),
      /Global recursion limit exceeded/,
    );
  });

  it('keeps checking after a rejected message', () => {
    const processor = createProcessor(DEFERRED);
    update(processor, {id: 'root', component: 'Box', children: ['a']});
    assert.throws(() => update(processor, {id: 'a', component: 'Box', children: ['root']}));
    update(processor, {id: 'a', component: 'Box', children: ['b']});
    assert.throws(
      () => update(processor, {id: 'b', component: 'Box', children: ['root']}),
      A2uiRecursionError,
    );
  });

  it('sees references added to the surface outside the processor', () => {
    const processor = createProcessor(DEFERRED);
    update(processor, {id: 'root', component: 'Panel', child: 'a'});
    update(processor, {id: 'a', component: 'Panel'});
    // Only the processor's own changes are in its record of the graph.
    processor.model.getSurface('s')!.componentsModel.get('a')!.properties = {child: 'b'};
    assert.throws(
      () => update(processor, {id: 'b', component: 'Panel', child: 'root'}),
      A2uiRecursionError,
    );
  });

  it('rejects a child placed under a parent its type does not allow', () => {
    const processor = createProcessor(DEFERRED);
    update(processor, {id: 'root', component: 'Box', children: ['a', 'label']});
    update(processor, {id: 'a', component: 'Box', children: []});
    assert.throws(
      () =>
        update(
          processor,
          {id: 'p', component: 'Panel', child: 'x'},
          {id: 'label', component: 'Panel'},
        ),
      (e: unknown) => e instanceof A2uiValidationError && e.code === 'UNALLOWED_CHILD',
    );
  });

  it('rejects a parent whose type changes to one its child does not allow', () => {
    const processor = createProcessor(DEFERRED);
    update(processor, {id: 'root', component: 'Panel', child: 'holder'});
    update(processor, {id: 'holder', component: 'Panel', child: 'label'});
    update(processor, {id: 'label', component: 'Label', text: 'Hi'});
    // `holder` stays the parent of `label` but becomes a type `Label` does not allow.
    assert.throws(
      () => update(processor, {id: 'holder', component: 'Box', children: ['label']}),
      (e: unknown) => e instanceof A2uiValidationError && e.code === 'UNALLOWED_PARENT',
    );
  });

  it('rejects a batch that leaves a component without the parent its type requires', () => {
    const processor = createProcessor({...DEFERRED, allowOrphanComponents: false});
    update(processor, {id: 'holder', component: 'Panel', child: 'label'});
    update(processor, {id: 'label', component: 'Label', text: 'Hi'});
    // `label` loses its only parent, and a `Label` may not sit on the surface.
    assert.throws(
      () => update(processor, {id: 'holder', component: 'Panel'}),
      (e: unknown) => e instanceof A2uiValidationError && e.code === 'UNALLOWED_PARENT',
    );
  });

  // Checks the processor against one whose record of the graph is dropped
  // before every message, which checks every message against the whole
  // surface as before the record existed. Both must accept and reject the
  // same messages, with the same errors, and hold the same components.
  const configs: Record<string, ValidationConfig> = {
    'missing root and orphans allowed': {...DEFERRED, maxDepth: 3},
    'orphans allowed, root required': {...DEFERRED, allowMissingRoot: false, maxDepth: 3},
    'missing root allowed, orphans not': {...DEFERRED, allowOrphanComponents: false, maxDepth: 3},
  };
  for (const [name, config] of Object.entries(configs)) {
    for (const [catalogName, makeCatalog] of [
      ['composition limits', compositionCatalog],
      ['no composition limits', plainCatalog],
    ] as const) {
      it(`matches a whole-surface check on random messages (${name}, ${catalogName})`, () => {
        let seed = 12345;
        const random = (n: number) => {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          return seed % n;
        };
        const ids = ['root', 'a', 'b', 'c', 'd', 'e', 'f'];
        const pick = () => ids[random(ids.length)];
        const randomComponent = () => {
          const id = pick();
          switch (random(3)) {
            case 0:
              return {
                id,
                component: 'Box',
                children: Array.from({length: random(3)}, pick),
              };
            case 1:
              return {id, component: 'Label', text: 'x'};
            default:
              return random(4) === 0
                ? {id, component: 'Panel'}
                : {id, component: 'Panel', child: pick()};
          }
        };
        for (let run = 0; run < 60; run++) {
          const incremental = createProcessor(config, makeCatalog());
          const whole = createProcessor(config, makeCatalog());
          for (let step = 0; step < 25; step++) {
            const batch = new Map<string, Record<string, unknown>>();
            const size = 1 + random(2);
            for (let i = 0; i < size; i++) {
              const component = randomComponent();
              batch.set(component.id, component);
            }
            const components = [...batch.values()];
            (whole as unknown as {graphBounds: WeakMap<object, unknown>}).graphBounds =
              new WeakMap();
            const expected = outcome(() => update(whole, ...components));
            const actual = outcome(() => update(incremental, ...components));
            assert.strictEqual(actual, expected, `run ${run}, step ${step}`);
            assert.deepStrictEqual(snapshot(incremental), snapshot(whole));
          }
        }
      });
    }
  }
});

/**
 * The catalog of the Dart core's incremental composition tests (#3345): `Strict`
 * holds only `Item` and `Box` children, an `Item` may sit under a `Strict`, a
 * `Box` or the surface, and a `Header` only under a `Box`.
 */
function strictCatalog(id = 'custom'): Catalog<any, any> {
  return Catalog.fromJson(
    {
      catalogId: id,
      components: {
        Box: {type: 'object', properties: {children: {$ref: '#/$defs/ChildList'}}},
        Strict: {
          type: 'object',
          allowedChildren: ['Item', 'Box'],
          properties: {children: {$ref: '#/$defs/ChildList'}},
        },
        Card: {type: 'object', properties: {child: {$ref: '#/$defs/ComponentId'}}},
        Item: {type: 'object', allowedParents: ['Strict', 'Box', 'Surface']},
        Header: {type: 'object', allowedParents: ['Box']},
      },
    },
    '1.0',
  );
}

/**
 * A second catalog declaring other constraints for some of the same type
 * names. A component's constraints are those of its own catalog.
 */
function otherCatalog(): Catalog<any, any> {
  return Catalog.fromJson(
    {
      catalogId: 'other',
      components: {
        Box: {
          type: 'object',
          allowedChildren: ['Item', 'Card'],
          properties: {children: {$ref: '#/$defs/ChildList'}},
        },
        Strict: {
          type: 'object',
          allowedChildren: ['Card'],
          allowedParents: ['Box', 'Surface'],
          properties: {children: {$ref: '#/$defs/ChildList'}},
        },
        Item: {type: 'object', allowedParents: ['Card', 'Strict']},
      },
    },
    '1.0',
  );
}

/** The error `body` throws as `Class code: message`, or `ok`. */
function outcomeWithCode(body: () => void): string {
  try {
    body();
    return 'ok';
  } catch (e) {
    if (e instanceof A2uiValidationError) {
      return `${e.constructor.name} ${e.code}: ${e.message}`;
    }
    return e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  }
}

/** The surface's components with the id of each one's catalog. */
function snapshotWithCatalogs(processor: MessageProcessor): Record<string, unknown> {
  const surface = processor.model.getSurface('s')!;
  const out: Record<string, unknown> = {};
  for (const [id, component] of surface.componentsModel.entries) {
    out[id] = [component.componentTree, component.catalog.id];
  }
  return out;
}

/**
 * An incremental processor and one whose record of the graph is dropped
 * before every message, fed the same batches.
 */
class Pair {
  readonly incremental: MessageProcessor;
  readonly whole: MessageProcessor;

  constructor(config: ValidationConfig, makeCatalogs: () => Array<Catalog<any, any>>) {
    const create = () => {
      const processor = new MessageProcessor(makeCatalogs() as Array<Catalog<any>>, undefined, {
        validationConfig: config,
      });
      processor.processMessages([
        {version: '1.0', createSurface: {surfaceId: 's', catalogId: 'custom'}},
      ]);
      return processor;
    };
    this.incremental = create();
    this.whole = create();
  }

  /** Sends one batch to both, expects the same outcome, and returns it. */
  send(...components: Array<Record<string, unknown>>): string {
    (this.whole as unknown as {graphBounds: WeakMap<object, unknown>}).graphBounds = new WeakMap();
    const expected = outcomeWithCode(() => update(this.whole, ...components));
    const actual = outcomeWithCode(() => update(this.incremental, ...components));
    const context = JSON.stringify(components);
    assert.strictEqual(actual, expected, context);
    assert.deepStrictEqual(
      snapshotWithCatalogs(this.incremental),
      snapshotWithCatalogs(this.whole),
      context,
    );
    return actual;
  }
}

describe('MessageProcessor composition cases of the Dart core, against a whole-surface check', () => {
  const configs: Record<string, ValidationConfig> = {
    'missing root allowed': DEFERRED,
    'orphans allowed': {...DEFERRED, allowMissingRoot: false},
  };
  const c = (id: string, component: string, props: Record<string, unknown> = {}) => ({
    id,
    component,
    ...props,
  });
  const code = (outcome: string) => /^A2uiValidationError (\w+):/.exec(outcome)?.[1] ?? outcome;

  for (const [name, config] of Object.entries(configs)) {
    const pair = () => new Pair(config, () => [strictCatalog()]);

    it(`rejects a child that arrives after its container (${name})`, () => {
      const p = pair();
      assert.strictEqual(p.send(c('root', 'Strict', {children: ['a']})), 'ok');
      assert.strictEqual(code(p.send(c('a', 'Card'))), 'UNALLOWED_CHILD');
    });

    it(`rejects a container that arrives after its child (${name})`, () => {
      const p = pair();
      assert.strictEqual(p.send(c('root', 'Box')), 'ok');
      assert.strictEqual(p.send(c('a', 'Card')), 'ok');
      assert.strictEqual(code(p.send(c('b', 'Strict', {children: ['a']}))), 'UNALLOWED_CHILD');
    });

    it(`rejects a child added to a container in a later message (${name})`, () => {
      const p = pair();
      assert.strictEqual(p.send(c('root', 'Strict', {children: ['a']})), 'ok');
      assert.strictEqual(p.send(c('a', 'Item')), 'ok');
      assert.strictEqual(p.send(c('b', 'Card')), 'ok');
      assert.strictEqual(
        code(p.send(c('root', 'Strict', {children: ['a', 'b']}))),
        'UNALLOWED_CHILD',
      );
    });

    it(`accepts a container rewritten to drop a child it disallows (${name})`, () => {
      const p = pair();
      assert.strictEqual(p.send(c('root', 'Box', {children: ['a', 'h']})), 'ok');
      assert.strictEqual(p.send(c('a', 'Item'), c('h', 'Header')), 'ok');
      assert.strictEqual(
        code(p.send(c('root', 'Strict', {children: ['a', 'h']}))),
        'UNALLOWED_CHILD',
      );
      assert.strictEqual(p.send(c('root', 'Strict', {children: ['a']})), 'ok');
      // `h` no longer has a parent, and may be held by a `Box` again.
      assert.strictEqual(p.send(c('b', 'Box', {children: ['h']})), 'ok');
    });

    it(`rejects a held child whose type changes (${name})`, () => {
      const p = pair();
      assert.strictEqual(p.send(c('root', 'Strict', {children: ['a']}), c('a', 'Item')), 'ok');
      assert.strictEqual(code(p.send(c('a', 'Header'))), 'UNALLOWED_CHILD');
    });

    it(`rejects a child under a holder its allowedParents omits (${name})`, () => {
      const p = pair();
      assert.strictEqual(
        p.send(c('root', 'Box', {children: ['c']}), c('c', 'Card', {child: 'x'})),
        'ok',
      );
      assert.strictEqual(code(p.send(c('x', 'Header'))), 'UNALLOWED_PARENT');
    });

    it(`rejects a root its allowedParents does not let the surface hold (${name})`, () => {
      const p = pair();
      // A root no component references is placed under the surface.
      assert.strictEqual(code(p.send(c('root', 'Header'))), 'UNALLOWED_PARENT');
      // A root a `Box` references is placed under that `Box`.
      assert.strictEqual(p.send(c('a', 'Box', {children: ['root']}), c('root', 'Header')), 'ok');
      // Dropping the reference leaves the root under the surface again.
      assert.strictEqual(code(p.send(c('a', 'Box'))), 'UNALLOWED_PARENT');
    });
  }

  // Two catalogs that both declare constraints, on the same type names, with
  // each component drawn from either.
  const randomConfigs: Record<string, ValidationConfig> = {
    ...configs,
    'missing root allowed, orphans not': {...DEFERRED, allowOrphanComponents: false, maxDepth: 3},
  };
  for (const [name, config] of Object.entries(randomConfigs)) {
    it(`matches a whole-surface check on random messages across two catalogs (${name})`, () => {
      let seed = 2024;
      // The high bits of a linear congruential generator, whose low bits
      // repeat with short periods.
      const random = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return Math.floor(seed / 65536) % n;
      };
      const ids = ['root', 'a', 'b', 'c', 'd', 'e'];
      const types = ['Box', 'Strict', 'Card', 'Item', 'Header'];
      const pick = () => ids[random(ids.length)];
      for (let run = 0; run < 60; run++) {
        const p = new Pair(config, () => [strictCatalog(), otherCatalog()]);
        for (let step = 0; step < 20; step++) {
          const batch = new Map<string, Record<string, unknown>>();
          for (let k = 1 + random(3); k > 0; k--) {
            const id = pick();
            const type = types[random(types.length)];
            const component: Record<string, unknown> = {id, component: type};
            if (type === 'Box' || type === 'Strict') {
              component.children = Array.from({length: random(4)}, pick);
            } else if (type === 'Card') {
              component.child = pick();
            }
            if (type !== 'Card' && type !== 'Header' && random(2) === 0) {
              component.catalogId = 'other';
            }
            batch.set(id, component);
          }
          p.send(...batch.values());
        }
      }
    });
  }
});
