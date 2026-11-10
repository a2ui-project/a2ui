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
  AllowlistUrlSecurityPolicy,
  checkPayloadUrls,
  InMemoryCatalogProvider,
  type UrlCheckInfo,
  type UrlContext,
  type UrlSecurityPolicy,
} from '../../../src/index.js';
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

type Message = Record<string, unknown>;

const BASIC_V10 = loadBasicCatalog('1.0');
const BASIC_V09 = loadBasicCatalog('v0.9');
const CDN_ONLY = new AllowlistUrlSecurityPolicy({media: ['cdn.example.com']});
const PRODUCT_CATALOG_ID = 'https://example.com/product/catalog.json';

/** A v1.0 catalog whose `ProductCard` marks its URL props, including a nested one. */
const PRODUCT_CATALOG = new InMemoryCatalogProvider({
  catalogId: PRODUCT_CATALOG_ID,
  protocolVersion: '1.0',
  components: {
    ProductCard: {
      type: 'object',
      properties: {
        component: {const: 'ProductCard'},
        title: {$ref: 'common_types.json#/$defs/DynamicString'},
        imageUrl: {
          $ref: 'common_types.json#/$defs/DynamicString',
          'x-a2ui-url-context': 'media',
        },
        pageUrl: {
          $ref: 'common_types.json#/$defs/DynamicString',
          'x-a2ui-url-context': 'navigation',
        },
        labelUrl: {type: 'string', 'x-a2ui-url-context': 'none'},
        gallery: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              thumbnailUrl: {type: 'string', 'x-a2ui-url-context': 'media'},
            },
          },
        },
      },
      required: ['component'],
    },
  },
}).load();

function v10(body: Message): Message {
  return {version: '1.0', ...body};
}

function createV10(catalogId: string, extra: Message = {}): Message {
  return v10({createSurface: {surfaceId: 's', catalogId, ...extra}});
}

function updateV10(...components: Message[]): Message {
  return v10({updateComponents: {surfaceId: 's', components}});
}

describe('checkPayloadUrls', () => {
  it('passes every URL through the baseline by default', () => {
    const payload = [
      createV10(BASIC_CATALOG_IDS['1.0']),
      updateV10(
        {id: 'root', component: 'Image', url: 'https://any.example/a.png'},
        {id: 'bad', component: 'Image', url: 'javascript:alert(1)'},
      ),
    ];
    const result = checkPayloadUrls([BASIC_V10], payload);
    expect(result.blocked).toEqual([
      {
        messageIndex: 1,
        surfaceId: 's',
        catalogId: BASIC_CATALOG_IDS['1.0'],
        componentId: 'bad',
        componentType: 'Image',
        propertyName: 'url',
        context: 'media',
        redactedUrl: 'javascript:',
      },
    ]);
    // Reporting leaves the payload's own messages in place.
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toBe(payload[0]);
    expect(result.messages[1]).toBe(payload[1]);
  });

  it('checks the basic catalog media props against the policy and redacts the report', () => {
    const result = checkPayloadUrls(
      [BASIC_V10],
      [
        createV10(BASIC_CATALOG_IDS['1.0']),
        updateV10(
          {id: 'root', component: 'Image', url: 'https://cdn.example.com/a.png'},
          {
            id: 'v',
            component: 'Video',
            url: 'https://cdn.example.com/v.mp4',
            posterUrl: 'https://attacker.example/p.png?secret=42',
          },
          {id: 'a', component: 'AudioPlayer', url: 'https://attacker.example/a.mp3'},
          {id: 't', component: 'Text', text: 'https://attacker.example/not-a-url-prop'},
        ),
      ],
      {policy: CDN_ONLY},
    );
    expect(result.blocked.map(b => [b.componentId, b.propertyName, b.redactedUrl])).toEqual([
      ['v', 'posterUrl', 'https://attacker.example'],
      ['a', 'url', 'https://attacker.example'],
    ]);
    expect(JSON.stringify(result.blocked)).not.toContain('secret');
  });

  it('reads marks from a custom catalog, including nested props and none', () => {
    const result = checkPayloadUrls(
      [PRODUCT_CATALOG],
      [
        createV10(PRODUCT_CATALOG_ID),
        updateV10({
          id: 'root',
          component: 'ProductCard',
          title: 'Shoe',
          imageUrl: 'https://attacker.example/i.png',
          pageUrl: 'https://anywhere.example/p',
          labelUrl: 'javascript:not-checked',
          gallery: [
            {thumbnailUrl: 'https://cdn.example.com/1.png'},
            {thumbnailUrl: 'https://attacker.example/2.png'},
          ],
        }),
      ],
      {policy: CDN_ONLY},
    );
    expect(result.blocked.map(b => [b.propertyName, b.context])).toEqual([
      ['imageUrl', 'media'],
      ['gallery[].thumbnailUrl', 'media'],
    ]);
  });

  it('passes where the URL comes from to the policy', () => {
    const calls: [string, UrlContext, UrlCheckInfo | undefined][] = [];
    const policy: UrlSecurityPolicy = {
      sanitizeUrl(url, context, info) {
        calls.push([url, context, info]);
        return url;
      },
    };
    checkPayloadUrls(
      [PRODUCT_CATALOG],
      [
        createV10(PRODUCT_CATALOG_ID),
        updateV10({id: 'root', component: 'ProductCard', pageUrl: 'https://shop.example/p'}),
      ],
      {policy},
    );
    expect(calls).toEqual([
      [
        'https://shop.example/p',
        'navigation',
        {
          surfaceId: 's',
          catalogId: PRODUCT_CATALOG_ID,
          componentType: 'ProductCard',
          componentId: 'root',
          propertyName: 'pageUrl',
        },
      ],
    ]);
  });

  it('checks absolute bindings against the data the payload sets', () => {
    const result = checkPayloadUrls(
      [BASIC_V10],
      [
        createV10(BASIC_CATALOG_IDS['1.0'], {
          dataModel: {photos: {ok: 'https://cdn.example.com/ok.png'}},
        }),
        v10({
          updateDataModel: {
            surfaceId: 's',
            path: '/photos/leak',
            value: 'https://attacker.example/?d=secret',
          },
        }),
        updateV10(
          {id: 'root', component: 'Image', url: {'@path': '/photos/ok'}},
          {id: 'leak', component: 'Image', url: {'@path': '/photos/leak'}},
          {id: 'unset', component: 'Image', url: {'@path': '/photos/unset'}},
          {id: 'relative', component: 'Image', url: {'@path': 'photo'}},
          {
            id: 'call',
            component: 'Image',
            url: {'@call': 'formatString', args: {value: 'https://attacker.example/${/x}'}},
          },
        ),
      ],
      {policy: CDN_ONLY},
    );
    expect(result.blocked).toEqual([
      expect.objectContaining({
        messageIndex: 2,
        componentId: 'leak',
        dataPath: '/photos/leak',
        redactedUrl: 'https://attacker.example',
      }),
    ]);
  });

  it('applies data model updates in order, including removals', () => {
    const image = updateV10({id: 'root', component: 'Image', url: {'@path': '/photo'}});
    const set = (value: string) => v10({updateDataModel: {surfaceId: 's', path: '/photo', value}});
    const remove = v10({updateDataModel: {surfaceId: 's', path: '/photo'}});
    const create = createV10(BASIC_CATALOG_IDS['1.0']);
    const blockedIds = (...messages: Message[]) =>
      checkPayloadUrls([BASIC_V10], messages, {policy: CDN_ONLY}).blocked.length;

    expect(blockedIds(create, set('https://attacker.example/'), image)).toBe(1);
    expect(
      blockedIds(create, set('https://attacker.example/'), set('https://cdn.example.com/'), image),
    ).toBe(0);
    expect(blockedIds(create, set('https://attacker.example/'), remove, image)).toBe(0);
    expect(
      blockedIds(
        create,
        v10({updateDataModel: {surfaceId: 's', value: {photo: 'https://attacker.example/'}}}),
        image,
      ),
    ).toBe(1);
  });

  it('reads bindings into lists the payload creates or updates', () => {
    const result = checkPayloadUrls(
      [BASIC_V10],
      [
        createV10(BASIC_CATALOG_IDS['1.0'], {
          dataModel: {items: [{url: 'https://cdn.example.com/0.png'}]},
        }),
        v10({
          updateDataModel: {
            surfaceId: 's',
            path: '/items/1/url',
            value: 'https://attacker.example/',
          },
        }),
        v10({
          updateDataModel: {
            surfaceId: 's',
            path: '/fresh/0/url',
            value: 'https://attacker.example/',
          },
        }),
        updateV10(
          {id: 'root', component: 'Image', url: {'@path': '/items/0/url'}},
          {id: 'second', component: 'Image', url: {'@path': '/items/1/url'}},
          {id: 'fresh', component: 'Image', url: {'@path': '/fresh/0/url'}},
        ),
      ],
      {policy: CDN_ONLY},
    );
    expect(result.blocked.map(b => b.componentId)).toEqual(['second', 'fresh']);
  });

  it('strips blocked values from copies of the messages', () => {
    const payload = [
      createV10(BASIC_CATALOG_IDS['1.0'], {dataModel: {leak: 'https://attacker.example/'}}),
      updateV10(
        {id: 'root', component: 'Image', url: 'https://cdn.example.com/a.png'},
        {id: 'lit', component: 'Image', url: 'https://attacker.example/a.png'},
        {id: 'bound', component: 'Image', url: {'@path': '/leak'}},
      ),
    ];
    const before = structuredClone(payload);
    const result = checkPayloadUrls([BASIC_V10], payload, {policy: CDN_ONLY, onBlocked: 'strip'});
    expect(result.blocked).toHaveLength(2);
    expect(result.messages[0]).toBe(payload[0]);
    expect(result.messages[1]).toEqual(
      updateV10(
        {id: 'root', component: 'Image', url: 'https://cdn.example.com/a.png'},
        {id: 'lit', component: 'Image', url: ''},
        {id: 'bound', component: 'Image', url: ''},
      ),
    );
    // The caller's payload is not changed.
    expect(payload).toEqual(before);
  });

  it('strips nested values and leaves messages without blocked URLs alone', () => {
    const payload = [
      createV10(PRODUCT_CATALOG_ID),
      updateV10({
        id: 'root',
        component: 'ProductCard',
        gallery: [
          {thumbnailUrl: 'https://attacker.example/1.png'},
          {thumbnailUrl: 'https://cdn.example.com/2.png'},
        ],
      }),
    ];
    const result = checkPayloadUrls([PRODUCT_CATALOG], payload, {
      policy: CDN_ONLY,
      onBlocked: 'strip',
    });
    expect(result.messages[0]).toBe(payload[0]);
    expect((result.messages[1] as Message).updateComponents).toEqual({
      surfaceId: 's',
      components: [
        {
          id: 'root',
          component: 'ProductCard',
          gallery: [{thumbnailUrl: ''}, {thumbnailUrl: 'https://cdn.example.com/2.png'}],
        },
      ],
    });
  });

  it('checks components inlined in a v1.0 createSurface', () => {
    const result = checkPayloadUrls(
      [BASIC_V10],
      [
        createV10(BASIC_CATALOG_IDS['1.0'], {
          components: [{id: 'root', component: 'Image', url: 'https://attacker.example/a.png'}],
        }),
      ],
      {policy: CDN_ONLY, onBlocked: 'strip'},
    );
    expect(result.blocked).toEqual([
      expect.objectContaining({messageIndex: 0, componentId: 'root', propertyName: 'url'}),
    ]);
    expect(
      ((result.messages[0] as Message).createSurface as {components: Message[]}).components[0],
    ).toEqual({id: 'root', component: 'Image', url: ''});
  });

  it('checks v0.9 payloads, including theme.iconUrl', () => {
    const result = checkPayloadUrls(
      [BASIC_V09],
      [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 's',
            catalogId: BASIC_CATALOG_IDS['v0.9'],
            theme: {iconUrl: 'https://attacker.example/icon.png'},
          },
        },
        {
          version: 'v0.9',
          updateDataModel: {surfaceId: 's', path: '/p', value: 'https://attacker.example/x'},
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{id: 'root', component: 'Image', url: {path: '/p'}}],
          },
        },
      ],
      {policy: CDN_ONLY, onBlocked: 'strip'},
    );
    expect(result.blocked.map(b => [b.messageIndex, b.propertyName, b.dataPath])).toEqual([
      [0, 'theme.iconUrl', undefined],
      [2, 'url', '/p'],
    ]);
    expect(
      (result.messages[0] as unknown as {createSurface: {theme: Message}}).createSurface.theme,
    ).toEqual({iconUrl: ''});
  });

  it("uses the host's urlProperties map, which wins over the catalog", () => {
    const policy = new AllowlistUrlSecurityPolicy({
      media: ['cdn.example.com'],
      urlProperties: {
        [PRODUCT_CATALOG_ID]: {ProductCard: {title: 'media', imageUrl: 'none'}},
      },
    });
    const result = checkPayloadUrls(
      [PRODUCT_CATALOG],
      [
        createV10(PRODUCT_CATALOG_ID),
        updateV10({
          id: 'root',
          component: 'ProductCard',
          title: 'https://attacker.example/t.png',
          imageUrl: 'https://attacker.example/i.png',
        }),
      ],
      {policy},
    );
    expect(result.blocked.map(b => b.propertyName)).toEqual(['title']);
  });

  it('checks a surface the payload only updates against the first catalog with the type', () => {
    const result = checkPayloadUrls(
      [PRODUCT_CATALOG, BASIC_V10],
      updateV10({id: 'img', component: 'Image', url: 'https://attacker.example/a.png'}),
      {policy: CDN_ONLY},
    );
    expect(result.blocked).toEqual([
      expect.objectContaining({catalogId: BASIC_CATALOG_IDS['1.0'], componentId: 'img'}),
    ]);
  });

  it('never borrows another schema for a named catalog the agent lacks', () => {
    const otherId = 'https://example.com/other/catalog.json';
    const card = {
      id: 'card',
      component: 'ProductCard',
      imageUrl: 'https://attacker.example/i.png',
      title: 'https://attacker.example/t.png',
    };
    const image = {id: 'img', component: 'Image', url: 'https://attacker.example/a'};
    // The product catalog's marks don't apply to a surface of another catalog.
    expect(
      checkPayloadUrls([PRODUCT_CATALOG], [createV10(otherId), updateV10(card)], {
        policy: CDN_ONLY,
      }).blocked,
    ).toEqual([]);
    // The policy's urlProperties for that catalog ID still apply.
    const policy = new AllowlistUrlSecurityPolicy({
      media: ['cdn.example.com'],
      urlProperties: {[otherId]: {ProductCard: {title: 'media'}}},
    });
    expect(
      checkPayloadUrls([PRODUCT_CATALOG], [createV10(otherId), updateV10(card)], {
        policy,
      }).blocked.map(b => [b.catalogId, b.propertyName]),
    ).toEqual([[otherId, 'title']]);
    // So does the built-in list of a basic catalog the agent doesn't hold.
    expect(
      checkPayloadUrls([PRODUCT_CATALOG], [createV10(BASIC_CATALOG_IDS['1.0']), updateV10(image)], {
        policy: CDN_ONLY,
      }).blocked.map(b => [b.catalogId, b.propertyName]),
    ).toEqual([[BASIC_CATALOG_IDS['1.0'], 'url']]);
  });

  it('ignores data updates past the maximum list index', () => {
    const data = (path: string) =>
      v10({updateDataModel: {surfaceId: 's', path, value: 'https://attacker.example/'}});
    const result = checkPayloadUrls(
      [BASIC_V10],
      [
        createV10(BASIC_CATALOG_IDS['1.0'], {dataModel: {items: []}}),
        data('/items/10000/url'),
        data('/items/1000000000/url'),
        data('/fresh/1000000000'),
        updateV10(
          {id: 'edge', component: 'Image', url: {'@path': '/items/10000/url'}},
          {id: 'huge', component: 'Image', url: {'@path': '/items/1000000000/url'}},
          {id: 'fresh', component: 'Image', url: {'@path': '/fresh/1000000000'}},
        ),
      ],
      {policy: CDN_ONLY},
    );
    // The renderer rejects the updates past the maximum index, so the bindings to them resolve
    // to nothing there either.
    expect(result.blocked.map(b => b.componentId)).toEqual(['edge']);
  });

  it('passes unknown messages and components through unchecked', () => {
    const payload = [
      {version: '1.0', deleteSurface: {surfaceId: 's'}},
      'not a message',
      updateV10({id: 'x', component: 'Unknown', url: 'javascript:alert(1)'}),
    ];
    const result = checkPayloadUrls([BASIC_V10], payload, {onBlocked: 'strip'});
    expect(result.blocked).toEqual([]);
    expect(result.messages).toEqual(payload);
  });

  it('blocks a URL when the policy throws', () => {
    const policy: UrlSecurityPolicy = {
      sanitizeUrl() {
        throw new Error('policy failure');
      },
    };
    const result = checkPayloadUrls(
      [BASIC_V10],
      [
        createV10(BASIC_CATALOG_IDS['1.0']),
        updateV10({id: 'root', component: 'Image', url: 'https://cdn.example.com/a.png'}),
      ],
      {policy},
    );
    expect(result.blocked).toHaveLength(1);
  });
});
