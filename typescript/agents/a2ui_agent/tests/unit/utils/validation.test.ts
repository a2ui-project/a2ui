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
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

type Message = Record<string, unknown>;
type Component = Record<string, unknown>;

const BASIC = loadBasicCatalog('v0.9');
const COLUMN: Component = {id: 'root', component: 'Column', children: ['t']};
const TEXT: Component = {id: 't', component: 'Text', text: 'Hi'};

function create(catalogId: string): Message {
  return {version: 'v0.9', createSurface: {surfaceId: 's', catalogId}};
}

function update(...components: Component[]): Message {
  return {version: 'v0.9', updateComponents: {surfaceId: 's', components}};
}

/** A v0.9 catalog whose components each require a `text` string. */
function catalog(catalogId: string, ...components: string[]) {
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
    'v0.9',
  ).load();
}

/** A v0.9 catalog whose Text has a `size` of the given JSON type. */
function sizedTextCatalog(catalogId: string, sizeType: string) {
  return new InMemoryCatalogProvider(
    {
      catalogId,
      components: {
        Text: {
          type: 'object',
          properties: {
            component: {const: 'Text'},
            text: {type: 'string'},
            size: {type: sizeType},
          },
          required: ['component', 'text'],
        },
      },
    },
    'v0.9',
  ).load();
}

describe('validatePayload', () => {
  const basicId = BASIC_CATALOG_IDS['v0.9'];

  it('accepts a created surface with a complete tree', () => {
    validatePayload([BASIC], [create(basicId), update(COLUMN, TEXT)]);
  });

  it('rejects a dangling reference on a created surface', () => {
    expect(() => validatePayload([BASIC], [create(basicId), update(COLUMN)])).toThrow(
      A2uiIntegrityError,
    );
  });

  it('requires a root on a created surface', () => {
    expect(() => validatePayload([BASIC], [create(basicId), update(TEXT)])).toThrow(
      /Missing root component/,
    );
  });

  it('lets a later message add the children a component names', () => {
    validatePayload([BASIC], [create(basicId), update(COLUMN), update(TEXT)]);
  });

  it('rejects an orphan that a later message adds', () => {
    const orphan = {id: 'orphan', component: 'Text', text: 'Lost'};

    expect(() =>
      validatePayload([BASIC], [create(basicId), update(COLUMN, TEXT), update(orphan)]),
    ).toThrow(/not reachable/);
  });

  it('accepts references to earlier components on an updated surface', () => {
    validatePayload([BASIC], [update(COLUMN)]);
  });

  it('rejects an unknown component on an updated surface', () => {
    expect(() => validatePayload([BASIC], [update({id: 'x', component: 'Unknown'})])).toThrow(
      A2uiValidationError,
    );
  });

  it('rejects an invalid component on an updated surface', () => {
    expect(() => validatePayload([BASIC], [update({id: 't', component: 'Text'})])).toThrow(
      A2uiValidationError,
    );
  });

  it('accepts an empty payload', () => {
    validatePayload([BASIC], []);
  });

  it('accepts one message on its own', () => {
    validatePayload([BASIC], update(COLUMN));
    expect(() => validatePayload([BASIC], update({id: 'x', component: 'Unknown'}))).toThrow(
      A2uiValidationError,
    );
    expect(() => validatePayload([BASIC], {})).toThrow('Message 0 states no version');
    expect(() => validatePayload([BASIC], 'nope')).toThrow('Message 0 is not a JSON object.');
  });

  it('rejects a message that is not an object', () => {
    expect(() => validatePayload([BASIC], ['nope'])).toThrow('Message 0 is not a JSON object.');
  });

  it('rejects a message with another version', () => {
    expect(() => validatePayload([BASIC], [{...update(TEXT), version: 'v1.0'}])).toThrow(
      A2uiValidationError,
    );
  });

  it('checks an updated surface on a catalog that defines its components', () => {
    const catalogs = [catalog('a', 'Text'), catalog('b', 'Text', 'Card')];

    validatePayload(catalogs, [update({id: 'c', component: 'Card', text: 'Hi'})]);
  });

  it('checks an updated surface against the first catalog when none defines it', () => {
    const catalogs = [catalog('a', 'Text'), catalog('b', 'Card')];

    expect(() => validatePayload(catalogs, [update({id: 'x', component: 'Unknown'})])).toThrow(
      A2uiValidationError,
    );
  });

  it('checks an update against the catalog its surface was created with in a state', () => {
    // Checked on its own, an update passes on any catalog that accepts it. A renderer state
    // that saw the surface created checks it against that catalog only.
    const catalogs = [catalog('a', 'Text'), catalog('b', 'Text', 'Card')];
    const cardUpdate = update({id: 'c', component: 'Card', text: 'Hi'});

    validatePayload(catalogs, [cardUpdate]);
    const state = new RendererState(catalogs);
    state.apply(create('a'));
    expect(() => state.apply(cardUpdate)).toThrow(A2uiValidationError);
  });

  it('assumes an updated surface on a catalog that accepts every update to it', () => {
    // Both catalogs accept the first update, and only "b" accepts the second.
    const catalogs = [sizedTextCatalog('a', 'string'), sizedTextCatalog('b', 'number')];

    validatePayload(catalogs, [
      update({id: 't', component: 'Text', text: 'Hi'}),
      update({id: 't', component: 'Text', text: 'Hi', size: 12}),
    ]);
  });

  it('reports the first catalog error when no catalog accepts every update', () => {
    const catalogs = [sizedTextCatalog('a', 'string'), sizedTextCatalog('b', 'number')];

    expect(() =>
      validatePayload(catalogs, [
        update({id: 't', component: 'Text', text: 'Hi', size: 12}),
        update({id: 't', component: 'Text', text: 'Hi', size: 'big'}),
      ]),
    ).toThrow(/size/);
  });

  it('does not assume a surface that an earlier message deleted', () => {
    expect(() =>
      validatePayload(
        [BASIC],
        [
          create(basicId),
          update(COLUMN, TEXT),
          {version: 'v0.9', deleteSurface: {surfaceId: 's'}},
          update(TEXT),
        ],
      ),
    ).toThrow(A2uiValidationError);
  });

  it('does not assume a surface that a later message creates', () => {
    const check = () => validatePayload([BASIC], [update(COLUMN, TEXT), create(basicId)]);

    expect(check).toThrow(A2uiValidationError);
    expect(check).toThrow(/Surface not found/);
  });

  it('accepts a surface recreated after a delete', () => {
    validatePayload(
      [BASIC],
      [
        update(TEXT),
        {version: 'v0.9', deleteSurface: {surfaceId: 's'}},
        create(basicId),
        update(COLUMN, TEXT),
      ],
    );
  });

  it('skips the tree of a surface that a later message of the payload deletes', () => {
    // As in Python: the tree is checked once the payload is applied, and the surface is gone
    // by then. Each component was still checked against the catalog.
    const deleted: Message = {version: 'v0.9', deleteSurface: {surfaceId: 's'}};
    for (const components of [[COLUMN], [{...COLUMN, children: []}, TEXT], [TEXT]]) {
      validatePayload([BASIC], [create(basicId), update(...components), deleted]);
    }
    expect(() =>
      validatePayload(
        [BASIC],
        [create(basicId), update({id: 'root', component: 'Unknown'}), deleted],
      ),
    ).toThrow(A2uiValidationError);
  });

  it('rejects a surface on a catalog it does not hold', () => {
    expect(() => validatePayload([BASIC], [create('missing')])).toThrow(A2uiValidationError);
  });

  it('rejects no catalogs and catalogs of incompatible versions', () => {
    expect(() => validatePayload([], [update(TEXT)])).toThrow(A2uiCatalogError);
    expect(() => validatePayload([BASIC, loadBasicCatalog('v1.0')], [update(TEXT)])).toThrow(
      A2uiCatalogError,
    );
  });

  it('does not change the payload it checks', () => {
    const payload = [create(basicId), update(COLUMN, TEXT)];
    const copy = structuredClone(payload);

    validatePayload([BASIC], payload);

    expect(payload).toEqual(copy);
  });

  it('accepts any iterable of messages', () => {
    function* messages() {
      yield create(basicId);
      yield update(COLUMN, TEXT);
    }

    validatePayload([BASIC], messages());
  });
});
