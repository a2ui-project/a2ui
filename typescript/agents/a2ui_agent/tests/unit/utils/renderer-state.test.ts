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

import {describe, expect, it} from 'vitest';

import {
  A2uiCatalogError,
  A2uiIntegrityError,
  A2uiValidationError,
  InMemoryCatalogProvider,
  RendererState,
  validatePayload,
} from '../../../src/index.js';
import {Catalog} from '../../../src/internal/web-core.js';
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

type Message = Record<string, unknown>;
type Component = Record<string, unknown>;

const BASIC = loadBasicCatalog('v0.9');
const CREATE: Message = {
  version: 'v0.9',
  createSurface: {surfaceId: 's', catalogId: BASIC_CATALOG_IDS['v0.9']},
};
const DELETE: Message = {version: 'v0.9', deleteSurface: {surfaceId: 's'}};

function update(...components: Component[]): Message {
  return {version: 'v0.9', updateComponents: {surfaceId: 's', components}};
}

function column(children: string[], id = 'root'): Component {
  return {id, component: 'Column', children};
}

function text(id: string, value = 'Hi'): Component {
  return {id, component: 'Text', text: value};
}

/** Applies one turn's messages and checks the trees they touch. */
function turn(state: RendererState, ...messages: Message[]): void {
  state.checkTopology(state.apply(messages));
}

function componentIds(state: RendererState, surfaceId = 's'): string[] {
  const surface = state.getSurface(surfaceId);
  expect(surface).toBeDefined();
  return [...surface!.componentsModel.keys].sort();
}

function textOf(state: RendererState, componentId: string): unknown {
  return state.getSurface('s')?.componentsModel.get(componentId)?.properties.text;
}

/** The surfaces a state holds, as plain data, to compare two states. */
function snapshot(state: RendererState): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const surfaceId of state.surfaceIds) {
    const surface = state.getSurface(surfaceId)!;
    const components: Record<string, unknown> = {};
    for (const component of surface.componentsModel.values) {
      components[component.id] = [component.type, component.properties];
    }
    result[surfaceId] = [components, surface.dataModel.get('/')];
  }
  return result;
}

/** A state holding a surface whose root column shows one text. */
function canvas(): RendererState {
  const state = new RendererState([BASIC]);
  turn(state, CREATE, update(column(['a']), text('a')));
  return state;
}

describe('RendererState', () => {
  it('lets a later turn reference components of an earlier turn', () => {
    const state = canvas();

    turn(state, update(column(['a', 'b']), text('b')));

    expect(componentIds(state)).toEqual(['a', 'b', 'root']);
  });

  it('rejects a reference that no turn sent', () => {
    const state = canvas();
    const payload = [update(column(['a', 'missing']))];

    // Checked on its own, the update may refer to anything the renderer holds.
    validatePayload([BASIC], payload);
    expect(() => turn(state, ...payload)).toThrow(A2uiIntegrityError);
    expect(() => turn(state, ...payload)).toThrow(/Dangling reference/);
  });

  it('rejects a cycle formed with components of an earlier turn', () => {
    const state = canvas();

    expect(() => state.apply(update(column(['root'], 'a')))).toThrow(A2uiValidationError);
    expect(() => state.apply(update(column(['root'], 'a')))).toThrow(/[Cc]ircular|[Cc]ycle/);
  });

  it('rejects a new component that is unreachable', () => {
    const state = canvas();

    expect(() => turn(state, update(text('orphan')))).toThrow(A2uiIntegrityError);
    expect(() => turn(state, update(text('orphan')))).toThrow(/'orphan' is not reachable/);
  });

  it('lets a later turn leave a replaced component unreachable', () => {
    // The protocol cannot remove one component, so replacing one detaches it.
    const state = canvas();

    turn(state, update(column(['b']), text('b')));
    turn(state, update(text('b', 'Still fine')));

    expect(componentIds(state)).toEqual(['a', 'b', 'root']);
  });

  it('rejects one payload that adds a component it leaves unreachable', () => {
    const state = new RendererState([BASIC]);

    expect(() =>
      turn(state, CREATE, update(column(['a']), text('a')), update(column(['b']), text('b'))),
    ).toThrow(/'a' is not reachable/);
  });

  it('rejects creating a surface twice', () => {
    const state = canvas();

    expect(() => state.apply(CREATE)).toThrow(A2uiIntegrityError);
    expect(() => state.apply(CREATE)).toThrow(/already exists/);
  });

  it('lets a deleted surface be created again', () => {
    const state = canvas();

    turn(state, DELETE);
    expect(state.surfaceIds).toEqual([]);
    turn(state, CREATE, update(text('root')));

    expect(componentIds(state)).toEqual(['root']);
  });

  it('rejects an update to a surface it never saw created', () => {
    const state = new RendererState([BASIC]);

    expect(() => state.apply(update(column(['a'])))).toThrow(A2uiIntegrityError);
    expect(() => state.apply(update(column(['a'])))).toThrow(/Surface not found/);
    expect(state.surfaceIds).toEqual([]);
  });

  it('returns the surfaces the messages touch, in order', () => {
    const state = new RendererState([BASIC]);
    const other: Message = {
      version: 'v0.9',
      createSurface: {surfaceId: 'other', catalogId: BASIC_CATALOG_IDS['v0.9']},
    };

    expect(state.apply([other, CREATE, update(text('root'))])).toEqual(['other', 's']);
  });

  it('applies a payload atomically', () => {
    const state = canvas();
    const before = snapshot(state);

    expect(() =>
      state.apply([
        update(text('a', 'Changed'), text('b')),
        update({id: 'c', component: 'Unknown'}),
      ]),
    ).toThrow(A2uiValidationError);

    expect(snapshot(state)).toEqual(before);
    expect(componentIds(state)).toEqual(['a', 'root']);
    expect(textOf(state, 'a')).toBe('Hi');
  });

  it('restores every call inside a failed transaction', () => {
    const state = new RendererState([BASIC]);

    expect(() =>
      state.transaction(() => {
        state.apply([CREATE, update(column(['a']))]);
        state.checkTopology(['s']);
      }),
    ).toThrow(/Dangling reference/);

    expect(state.surfaceIds).toEqual([]);
  });

  it('keeps the calls of a successful transaction and returns its result', () => {
    const state = new RendererState([BASIC]);

    const result = state.transaction(inner => {
      inner.apply(CREATE);
      return inner.apply(update(text('root')));
    });

    expect(result).toEqual(['s']);
    expect(componentIds(state)).toEqual(['root']);
  });

  it('rejects an asynchronous transaction and restores the state', () => {
    const state = new RendererState([BASIC]);

    expect(() =>
      // @ts-expect-error The type of `fn` rejects a promise; JavaScript callers hit the runtime check.
      state.transaction(async () => {
        state.apply(CREATE);
      }),
    ).toThrow(TypeError);
    expect(state.surfaceIds).toEqual([]);
  });

  it('rejects catalogs of incompatible versions', () => {
    expect(() => new RendererState([BASIC, loadBasicCatalog('v1.0')])).toThrow(A2uiCatalogError);
    expect(() => new RendererState([BASIC, loadBasicCatalog('v1.0')])).toThrow(
      /incompatible protocol versions/,
    );
  });

  it('rejects an empty catalog list', () => {
    expect(() => new RendererState([])).toThrow(A2uiCatalogError);
  });

  it('rejects a message that states the wrong version', () => {
    const state = canvas();

    expect(() => state.apply({...update(text('a')), version: 'v1.0'})).toThrow(A2uiValidationError);
  });

  it('replaces an older version of a message with a newer one', () => {
    // A stream applies a message again each time it grows.
    const versions = [update(text('a', 'Hel')), update(text('a', 'Hello'))];
    const everyVersion = canvas();
    const latestOnly = canvas();

    for (const version of versions) {
      everyVersion.apply(version);
    }
    latestOnly.apply(versions[versions.length - 1]);

    expect(snapshot(everyVersion)).toEqual(snapshot(latestOnly));
  });

  it('restores a deleted surface on rollback', () => {
    const state = canvas();

    expect(() =>
      state.transaction(() => {
        state.apply(DELETE);
        state.apply(update(text('a')));
      }),
    ).toThrow(A2uiValidationError);

    expect(componentIds(state)).toEqual(['a', 'root']);
  });

  it('restores the state from before the outer transaction after nested rollbacks', () => {
    const state = canvas();

    expect(() =>
      state.transaction(() => {
        state.apply(update(text('a', 'Outer')));
        expect(() => state.apply(update({id: 'x', component: 'Unknown'}))).toThrow(
          A2uiValidationError,
        );
        state.apply(update(text('a', 'Changed again')));
        state.apply(update({id: 'y', component: 'Unknown'}));
      }),
    ).toThrow(A2uiValidationError);

    expect(textOf(state, 'a')).toBe('Hi');
  });

  it('keeps the data model across a rollback', () => {
    const state = canvas();
    state.apply({version: 'v0.9', updateDataModel: {surfaceId: 's', value: {name: 'Ada'}}});

    expect(() =>
      state.transaction(() => {
        state.apply({
          version: 'v0.9',
          updateDataModel: {surfaceId: 's', path: '/name', value: 'Bob'},
        });
        state.apply(update({id: 'x', component: 'Unknown'}));
      }),
    ).toThrow(A2uiValidationError);

    expect(state.getSurface('s')?.dataModel.get('/')).toEqual({name: 'Ada'});
  });

  it('stops holding changed components against checks once marked checked', () => {
    const state = canvas();
    state.apply(update(text('orphan')));

    state.markChecked(['s']);

    expect(() => state.checkTopology(['s'])).not.toThrow();
  });

  it('still reports a dangling reference after a surface is marked checked', () => {
    const state = canvas();
    state.apply(update(column(['a', 'missing'])));

    state.markChecked(['s']);

    expect(() => state.checkTopology(['s'])).toThrow(A2uiIntegrityError);
    expect(() => state.checkTopology(['s'])).toThrow(/Dangling reference/);
  });

  it('undoes markChecked when the transaction it was made in fails', () => {
    const state = canvas();
    state.apply(update(text('orphan')));

    expect(() =>
      state.transaction(() => {
        state.markChecked(['s']);
        throw new Error('the stream failed later');
      }),
    ).toThrow('the stream failed later');

    expect(() => state.checkTopology(['s'])).toThrow(A2uiIntegrityError);
  });

  it('restores the state where a failed inner transaction started, and the outer goes on', () => {
    const state = canvas();

    state.transaction(() => {
      state.apply(update(text('a', 'Outer')));
      expect(() =>
        state.transaction(() => {
          state.apply(update(text('a', 'Inner'), text('b')));
          state.apply(DATA('/name', 'Inner'));
          state.apply(update({id: 'x', component: 'Unknown'}));
        }),
      ).toThrow(A2uiValidationError);
      expect(textOf(state, 'a')).toBe('Outer');
      state.apply(update(column(['a', 'c']), text('c')));
    });

    expect(componentIds(state)).toEqual(['a', 'c', 'root']);
    expect(textOf(state, 'a')).toBe('Outer');
    expect(state.getSurface('s')?.dataModel.get('/')).toEqual({});
  });

  it('undoes an update in place without copying the surface', () => {
    const state = canvas();
    const surface = state.getSurface('s');
    const component = surface?.componentsModel.get('a');
    const before = snapshot(state);

    expect(() =>
      state.transaction(() => {
        state.apply(update(text('a', 'Changed')));
        state.apply(update(text('a', 'Changed again')));
        state.apply(update({id: 'x', component: 'Unknown'}));
      }),
    ).toThrow(A2uiValidationError);

    // The same objects hold the state: rollback undid the updates rather than swapping in a
    // copy of the surface.
    expect(state.getSurface('s')).toBe(surface);
    expect(state.getSurface('s')?.componentsModel.get('a')).toBe(component);
    expect(snapshot(state)).toEqual(before);
  });

  it('undoes an update that changes a component type', () => {
    const state = canvas();
    const before = snapshot(state);

    expect(() =>
      state.transaction(() => {
        state.apply(update({id: 'a', component: 'Divider'}));
        state.apply(update({id: 'x', component: 'Unknown'}));
      }),
    ).toThrow(A2uiValidationError);

    expect(snapshot(state)).toEqual(before);
    expect(state.getSurface('s')?.componentsModel.get('a')?.type).toBe('Text');
  });

  it('restores a surface that was deleted and created again', () => {
    const state = canvas();
    state.apply(DATA('/items', ['x', 'y']));
    const before = snapshot(state);

    expect(() =>
      state.transaction(() => {
        state.apply(update(text('a', 'Before delete')));
        state.apply([DELETE, CREATE, update(column(['n']), text('n'))]);
        state.apply(DATA('/items/5', 'z'));
        state.apply(update({id: 'x', component: 'Unknown'}));
      }),
    ).toThrow(A2uiValidationError);

    expect(snapshot(state)).toEqual(before);
    // The restored surface keeps checking what changed against the tree.
    expect(() => turn(state, update(text('orphan')))).toThrow(A2uiIntegrityError);
  });

  it('undoes data model writes that create containers and pad lists', () => {
    const state = canvas();
    state.apply(DATA('/', {list: ['a'], nested: {kept: 1}}));
    const before = structuredClone(state.getSurface('s')?.dataModel.get('/'));

    expect(() =>
      state.transaction(() => {
        state.apply(DATA('/list/3', 'd'));
        state.apply(DATA('/nested/kept', 2));
        state.apply(DATA('/fresh/deep/path', true));
        state.apply(DATA('/nested', null));
        state.apply(update({id: 'x', component: 'Unknown'}));
      }),
    ).toThrow(A2uiValidationError);

    expect(state.getSurface('s')?.dataModel.get('/')).toEqual(before);
    expect(state.getSurface('s')?.dataModel.get('/list')).toHaveLength(1);
  });

  it('restores what a tree check marked checked when the transaction fails', () => {
    const state = canvas();
    // Not reachable yet, so the next tree check of the surface holds it to that.
    state.apply(update(text('b')));

    expect(() =>
      state.transaction(() => {
        turn(state, update(column(['a', 'b'])));
        throw new Error('the response failed later');
      }),
    ).toThrow('the response failed later');

    expect(() => state.checkTopology(['s'])).toThrow(A2uiIntegrityError);
  });

  it('restores the components of a v1.0 surface from several catalogs', () => {
    const primary = v10Catalog('urn:primary', 'Panel');
    const extra = v10Catalog('urn:extra', 'Badge');
    const state = new RendererState([primary, extra]);
    state.apply([
      {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: 'urn:primary'}},
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's',
          components: [
            {id: 'root', component: 'Panel', text: 'Hi'},
            {id: 'b', component: 'Badge', text: 'New', catalogId: 'urn:extra'},
          ],
        },
      },
    ]);
    const catalogOf = (id: string) => state.getSurface('s')?.componentsModel.get(id)?.catalog.id;

    expect(() =>
      state.transaction(() => {
        state.apply({version: 'v1.0', deleteSurface: {surfaceId: 's'}});
        state.apply({version: 'v1.0', deleteSurface: {surfaceId: 'missing'}});
        state.apply({
          version: 'v1.0',
          updateComponents: {surfaceId: 's', components: [{id: 'root', component: 'Panel'}]},
        });
      }),
    ).toThrow(A2uiValidationError);

    expect(componentIds(state)).toEqual(['b', 'root']);
    expect(catalogOf('root')).toBe('urn:primary');
    expect(catalogOf('b')).toBe('urn:extra');
  });

  it('restores a data model root that is not an object after an undone delete', () => {
    for (const root of ['hello', '', 42, 0, false, [], ['x']]) {
      const state = canvas();
      state.apply(DATA('/', root));

      rolledBack(state, () => state.apply(DELETE));

      expect(state.getSurface('s')?.dataModel.get('/')).toEqual(root);
    }
    const state = canvas();
    state.apply(DATA('/', 'hello'));
    rolledBack(state, () => state.apply(DELETE));
    // The renderer rejects a write through a primitive root, and so does the restored state.
    expect(() => state.apply(DATA('/a', 1))).toThrow(/root is a primitive/);
  });

  it('restores a deleted surface whose data model is deeper than one message may be', () => {
    const state = canvas();
    const path = '/' + Array.from({length: 60}, () => 'a').join('/');
    // Each message nests the value one level deeper than the last; one message holding the
    // whole value would exceed the depth limit on messages.
    for (let depth = 1; depth <= 60; depth++) {
      state.apply(DATA(path.slice(0, depth * 2), {}));
    }
    state.apply(DATA(path, 'leaf'));
    const before = structuredClone(state.getSurface('s')?.dataModel.get('/'));

    rolledBack(state, () => state.apply(DELETE));

    expect(state.getSurface('s')?.dataModel.get('/')).toEqual(before);
    expect(state.getSurface('s')?.dataModel.get(path)).toBe('leaf');
  });

  it('restores the order of the components after an undone deleteSurface', () => {
    const state = new RendererState([BASIC]);
    turn(state, CREATE, update(column(['b', 'a']), text('b'), text('a')));
    const before = order(state);

    rolledBack(state, () => state.apply(DELETE));

    expect(order(state)).toEqual(before);
  });

  it('keeps the position of a component whose type change is undone', () => {
    const state = new RendererState([BASIC]);
    state.apply([CREATE, update(column(['a', 'b']), column(['x'], 'a'), column(['y'], 'b'))]);
    const before = order(state);
    const firstProblem = () => {
      try {
        state.checkTopology(['s']);
        return undefined;
      } catch (e) {
        return (e as Error).message;
      }
    };
    const problemBefore = firstProblem();

    rolledBack(state, () => state.apply(update({id: 'a', component: 'Card', child: 'b'})));

    expect(order(state)).toEqual(before);
    expect(firstProblem()).toBe(problemBefore);
  });

  it('keeps the order when an update in place is undone after a later deleteSurface', () => {
    const state = new RendererState([BASIC]);
    state.apply([CREATE, update(column(['a', 'b']), text('a'), text('b'))]);
    const before = order(state);

    rolledBack(state, () => state.apply([update(text('a', 'Changed')), DELETE]));

    expect(order(state)).toEqual(before);
    expect(textOf(state, 'a')).toBe('Hi');
  });

  it('keeps the order when an update in place is undone after a later type change', () => {
    const state = new RendererState([BASIC]);
    state.apply([CREATE, update(column(['a', 'b']), text('a'), text('b'))]);
    const before = order(state);

    rolledBack(state, () =>
      state.apply([update(text('a', 'Changed')), update({id: 'a', component: 'Divider'})]),
    );

    expect(order(state)).toEqual(before);
    expect(textOf(state, 'a')).toBe('Hi');
  });

  it('keeps the positions of several components whose type changes one message undoes', () => {
    const state = new RendererState([BASIC]);
    turn(
      state,
      CREATE,
      update(column(['a', 'b', 'c', 'd']), ...['a', 'b', 'c', 'd'].map(id => text(id))),
    );
    const before = order(state);

    rolledBack(state, () =>
      state.apply(
        update(
          {id: 'c', component: 'Divider'},
          text('b', 'Changed in place'),
          {id: 'a', component: 'Divider'},
          text('new'),
        ),
      ),
    );

    expect(order(state)).toEqual(before);
    expect(textOf(state, 'b')).toBe('Hi');
  });

  it('keeps the position of a v1.0 component whose catalog change is undone', () => {
    const primary = v10Catalog('urn:primary', 'Panel', 'Badge');
    const extra = v10Catalog('urn:extra', 'Badge');
    const state = new RendererState([primary, extra]);
    const v10Update = (...components: Component[]): Message => ({
      version: 'v1.0',
      updateComponents: {surfaceId: 's', components},
    });
    state.apply([
      {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: 'urn:primary'}},
      v10Update(
        {id: 'root', component: 'Panel', text: 'Hi'},
        {id: 'b', component: 'Badge', text: 'New', catalogId: 'urn:extra'},
        {id: 'c', component: 'Panel', text: 'Last'},
      ),
    ]);
    const before = order(state);

    // From v1.0 an update that names no catalog moves the component to the default one.
    rolledBack(state, () => state.apply(v10Update({id: 'b', component: 'Badge', text: 'Moved'})));

    expect(order(state)).toEqual(before);
    expect(state.getSurface('s')?.componentsModel.get('b')?.catalog.id).toBe('urn:extra');
  });

  it('puts a deleted data model key back where it was', () => {
    const state = canvas();
    state.apply(DATA('/', {first: 1, middle: 2, last: 3}));

    rolledBack(state, () => state.apply(DATA('/middle', null)));

    expect(Object.keys(state.getSurface('s')?.dataModel.get('/') as object)).toEqual([
      'first',
      'middle',
      'last',
    ]);
  });

  it('keeps a hole in a padded list when a write through it is undone', () => {
    const state = canvas();
    state.apply(DATA('/list/2', 'c'));
    const list = () => state.getSurface('s')?.dataModel.get('/list') as unknown[];
    expect(0 in list()).toBe(false);

    rolledBack(state, () => {
      state.apply(DATA('/list/0/name', 'a'));
      state.apply(DATA('/list/1', 'b'));
    });

    expect(list()).toHaveLength(3);
    expect(0 in list()).toBe(false);
    expect(1 in list()).toBe(false);
    expect(JSON.stringify(state.getSurface('s')?.dataModel.get('/'))).toBe(
      '{"list":[null,null,"c"]}',
    );
  });

  it('refuses changes from an asynchronous transaction after it is rejected', async () => {
    const state = canvas();
    const before = snapshot(state);
    let resume!: () => void;
    const gate = new Promise<void>(resolve => (resume = resolve));
    let late: unknown;

    expect(() =>
      // @ts-expect-error The type of `fn` rejects a promise; JavaScript callers hit the runtime check.
      state.transaction(async () => {
        await gate;
        try {
          state.apply(update(text('a', 'Late')));
        } catch (e) {
          late = e;
          // A rejection nobody can handle, since the caller never got the promise.
          throw e;
        }
      }),
    ).toThrow(TypeError);
    // Until the promise settles, nothing changes the state.
    expect(() => state.apply(update(text('a', 'Other')))).toThrow(TypeError);
    expect(() => state.markChecked(['s'])).toThrow(TypeError);
    resume();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(late).toBeInstanceOf(TypeError);
    expect(snapshot(state)).toEqual(before);
    // Once the promise has settled, the state takes changes again.
    turn(state, update(text('a', 'Now')));
    expect(textOf(state, 'a')).toBe('Now');
  });

  it('keeps undoing when one undo fails, and rethrows the original error', () => {
    const state = canvas();
    const surface = state.getSurface('s')!;
    const removeComponent = surface.componentsModel.removeComponent;

    expect(() =>
      state.transaction(() => {
        state.apply(DATA('/name', 'Ada'));
        state.apply(update(column(['a', 'b']), text('b')));
        surface.componentsModel.removeComponent = () => {
          throw new Error('undo failed');
        };
        throw new Error('the response is rejected');
      }),
    ).toThrow('the response is rejected');
    surface.componentsModel.removeComponent = removeComponent;

    // The undo logged before the failing one still ran.
    expect(surface.dataModel.get('/')).toEqual({});
  });

  it('rejects catalogs of a protocol version it does not support', () => {
    const v08 = new Catalog('urn:x', 'v0.8', []);

    expect(() => new RendererState([v08])).toThrow(A2uiCatalogError);
    expect(() =>
      validatePayload([v08], [{version: 'v0.8', deleteSurface: {surfaceId: 's'}}]),
    ).toThrow(A2uiCatalogError);
  });
});

/** Runs `fn` in a transaction that then fails, so that everything `fn` applied is rolled back. */
function rolledBack(state: RendererState, fn: () => void): void {
  expect(() =>
    state.transaction(() => {
      fn();
      throw new Error('the response is rejected');
    }),
  ).toThrow('the response is rejected');
}

/** The ids of a surface's components, in the order the surface holds them. */
function order(state: RendererState, surfaceId = 's'): string[] {
  return [...state.getSurface(surfaceId)!.componentsModel.keys];
}

function DATA(path: string, value: unknown): Message {
  return {version: 'v0.9', updateDataModel: {surfaceId: 's', path, value}};
}

/** A v1.0 catalog whose components each require a `text` string. */
function v10Catalog(catalogId: string, ...components: string[]) {
  return new InMemoryCatalogProvider(
    {
      catalogId,
      components: Object.fromEntries(
        components.map(name => [
          name,
          {
            type: 'object',
            properties: {component: {const: name}, text: {type: 'string'}},
            required: ['component', 'text'],
          },
        ]),
      ),
    },
    'v1.0',
  ).load();
}
