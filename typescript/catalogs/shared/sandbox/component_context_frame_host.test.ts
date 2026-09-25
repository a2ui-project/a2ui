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

import {
  Catalog,
  ComponentContext,
  MessageProcessor,
  signal,
  type A2uiClientAction,
  type FunctionImplementation,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {z} from 'zod';
import {ComponentContextFrameHost} from './component_context_frame_host.js';

const CATALOG_ID = 'https://example.com/catalogs/frame-host-test.json';
const SURFACE_ID = 'frame-host-surface';

/** A function whose result is a signal, as reactive catalog functions return. */
const reactiveDouble: FunctionImplementation = {
  name: 'reactiveDouble',
  returnType: 'number',
  schema: z.object({n: z.number()}),
  execute: args => signal((args['n'] as number) * 2),
};

/** A function whose result is a promise, as functions that reach a server return. */
const asyncGreeting: FunctionImplementation = {
  name: 'asyncGreeting',
  returnType: 'string',
  schema: z.object({who: z.string()}),
  execute: args => Promise.resolve(`hello ${args['who']}`),
};

describe('ComponentContextFrameHost', () => {
  let surface: SurfaceModel;
  let actions: A2uiClientAction[];
  let host: ComponentContextFrameHost;

  beforeEach(() => {
    actions = [];
    const catalog = new Catalog(
      CATALOG_ID,
      [...basicCatalog.components.values()],
      [...basicCatalog.functions.values(), reactiveDouble, asyncGreeting],
    );
    const processor = new MessageProcessor([catalog], action => {
      actions.push(action);
    });
    processor.processMessages([
      {version: 'v0.9', createSurface: {surfaceId: SURFACE_ID, catalogId: CATALOG_ID}},
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: SURFACE_ID,
          value: {game: {score: 1, player: 'ann'}, items: [{name: 'first'}]},
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [{id: 'root', component: 'Text', text: 'hello'}],
        },
      },
    ]);
    surface = processor.model.getSurface(SURFACE_ID)!;
    host = new ComponentContextFrameHost(new ComponentContext(surface, 'root'));
  });

  afterEach(() => {
    surface.dispose();
  });

  it('reads and writes absolute paths in the surface data model', () => {
    expect(host.getData('/game/score')).toBe(1);
    expect(host.getData('/missing')).toBeUndefined();

    host.setData('/game/score', 5);

    expect(surface.dataModel.get('/game/score')).toBe(5);
    expect(host.getData('/game')).toEqual({score: 5, player: 'ann'});
  });

  it('resolves relative paths against the component base path', () => {
    const nested = new ComponentContextFrameHost(new ComponentContext(surface, 'root', '/items/0'));

    expect(nested.getData('name')).toBe('first');

    nested.setData('name', 'renamed');

    expect(surface.dataModel.get('/items/0/name')).toBe('renamed');
  });

  it('notifies subscribers synchronously during a write and stops after unsubscribe', () => {
    const seen: unknown[] = [];
    const subscription = host.subscribeData('/game', value => {
      seen.push(value);
    });

    host.setData('/game/score', 2);
    expect(seen).toEqual([{score: 2, player: 'ann'}]);

    surface.dataModel.set('/game/player', 'bob');
    expect(seen.length).toBe(2);

    subscription.unsubscribe();
    host.setData('/game/score', 3);
    expect(seen.length).toBe(2);
  });

  it('invokes catalog functions and unwraps signal results', async () => {
    expect(host.invokeFunction('add', {a: 2, b: 3})).toBe(5);
    expect(host.invokeFunction('reactiveDouble', {n: 21})).toBe(42);
    await expectAsync(
      Promise.resolve(host.invokeFunction('asyncGreeting', {who: 'frame'})),
    ).toBeResolvedTo('hello frame');
  });

  it('rejects unknown functions and invalid arguments through the catalog invoker', () => {
    expect(() => host.invokeFunction('nope', {})).toThrowError(/nope/);
    expect(() => host.invokeFunction('reactiveDouble', {n: 'NaN'})).toThrowError(/Validation/);
  });

  it('dispatches event actions on behalf of the component', async () => {
    await host.dispatchAction('counter_saved', {count: 7});

    expect(actions.length).toBe(1);
    expect(actions[0].name).toBe('counter_saved');
    expect(actions[0].context).toEqual({count: 7});
    expect(actions[0].sourceComponentId).toBe('root');
    expect(actions[0].surfaceId).toBe(SURFACE_ID);
  });
});
