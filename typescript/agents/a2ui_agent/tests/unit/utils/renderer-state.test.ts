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
  RendererState,
  validatePayload,
} from '../../../src/index.js';
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

  it('restores the outer snapshot after nested rollbacks', () => {
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
});
