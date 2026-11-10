/*
 * Copyright 2026 Google LLC
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

import {z} from 'zod';

import {basicCatalog} from '../catalogs/basic/v1/catalog.js';
import {
  A2uiExpressionError,
  AllowlistUrlSecurityPolicy,
  Catalog,
  ComponentContext,
  ComponentModel,
  createFunctionImplementation,
  DataContext,
  DataModel,
  GenericBinder,
  mediaUrl,
  MessageProcessor,
  PermissiveUrlSecurityPolicy,
  SurfaceModel,
  type A2uiErrorPayload,
  type A2uiWarningPayload,
  type ComponentApi,
  type UrlCheckInfo,
  type UrlContext,
  type UrlSecurityPolicy,
} from '../index.js';
import {basicCatalog as v09BasicCatalog} from '../v0_9/basic_catalog/catalog.js';
import {executeOpenUrl} from '../common/basic_functions.js';

const BASIC_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const CUSTOM_ID = 'https://example.com/custom/catalog.json';

const ProductCardApi = {
  name: 'ProductCard',
  schema: z.object({
    title: z.string().optional(),
    imageUrl: mediaUrl('Product photo.'),
    items: z.array(z.object({thumbUrl: mediaUrl(), label: z.string()})).optional(),
    tileUrl: z.string().optional(),
  }),
} satisfies ComponentApi;

const customCatalog = new Catalog(CUSTOM_ID, '1.0', [ProductCardApi]);

/** A policy that records what it sees and allows only `cdn.example.com`. */
class RecordingPolicy implements UrlSecurityPolicy {
  readonly calls: Array<{url: string; context: UrlContext; info?: UrlCheckInfo}> = [];
  private readonly inner = new AllowlistUrlSecurityPolicy({media: ['cdn.example.com']});
  constructor(readonly urlProperties?: UrlSecurityPolicy['urlProperties']) {}
  sanitizeUrl(url: string, context: UrlContext, info?: UrlCheckInfo) {
    this.calls.push({url, context, info});
    return this.inner.sanitizeUrl(url, context, info);
  }
}

function createProcessor(urlSecurityPolicy?: UrlSecurityPolicy, extra = {}) {
  const errors: A2uiErrorPayload[] = [];
  const processor = new MessageProcessor([basicCatalog, customCatalog], undefined, {
    urlSecurityPolicy,
    ...extra,
  });
  return {processor, errors};
}

function createSurface(
  processor: MessageProcessor,
  components: Array<Record<string, unknown>>,
  options: {catalogId?: string; dataModel?: Record<string, unknown>} = {},
) {
  processor.processMessages([
    {
      version: '1.0',
      createSurface: {surfaceId: 's1', catalogId: options.catalogId ?? BASIC_ID},
    },
    {version: '1.0', updateComponents: {surfaceId: 's1', components}},
    ...(options.dataModel
      ? [{version: '1.0', updateDataModel: {surfaceId: 's1', path: '/', value: options.dataModel}}]
      : []),
  ] as never);
  const surface = processor.model.getSurface('s1')!;
  const warnings: A2uiWarningPayload[] = [];
  const errors: A2uiErrorPayload[] = [];
  surface.onWarning.subscribe(w => {
    warnings.push(w);
  });
  surface.onError.subscribe(e => {
    errors.push(e);
  });
  return {surface, warnings, errors};
}

function bind(surface: SurfaceModel<any>, componentId: string) {
  const model = surface.componentsModel.get(componentId)!;
  const api = model.catalog.components.get(model.type)!;
  const binder = new GenericBinder<any>(new ComponentContext(surface, componentId), api.schema);
  binder.subscribe(() => {});
  return binder;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('URL security policy plumbing', () => {
  it('gives every surface the processor policy and handler', () => {
    const policy = new RecordingPolicy();
    const handler = () => {};
    const {processor} = createProcessor(policy, {openUrlHandler: handler});
    const {surface} = createSurface(processor, [{id: 'root', component: 'Text', text: 'hi'}]);
    assert.strictEqual(surface.urlSecurityPolicy, policy);
    assert.strictEqual(surface.openUrlHandler, handler);
  });

  it('defaults to the permissive policy', () => {
    const {processor} = createProcessor();
    const {surface} = createSurface(processor, [{id: 'root', component: 'Text', text: 'hi'}]);
    assert.ok(surface.urlSecurityPolicy instanceof PermissiveUrlSecurityPolicy);
    const standalone = new SurfaceModel('x', basicCatalog);
    assert.ok(standalone.urlSecurityPolicy instanceof PermissiveUrlSecurityPolicy);
    assert.strictEqual(
      standalone.sanitizeUrl('https://any.example/', 'media'),
      'https://any.example/',
    );
    assert.strictEqual(standalone.sanitizeUrl('javascript:alert(1)', 'navigation'), undefined);
  });

  it('fills in the component details on ComponentContext.sanitizeUrl', () => {
    const policy = new RecordingPolicy();
    const {processor} = createProcessor(policy);
    const {surface} = createSurface(processor, [{id: 'root', component: 'Text', text: 'hi'}]);
    const context = new ComponentContext(surface, 'root');
    assert.strictEqual(
      context.sanitizeUrl('https://cdn.example.com/t.png', 'media', {propertyName: 'tile'}),
      'https://cdn.example.com/t.png',
    );
    assert.deepStrictEqual(policy.calls.at(-1), {
      url: 'https://cdn.example.com/t.png',
      context: 'media',
      info: {
        catalogId: BASIC_ID,
        componentType: 'Text',
        componentId: 'root',
        propertyName: 'tile',
        surfaceId: 's1',
      },
    });
  });

  it('applies the default policy on a DataContext without a surface', () => {
    const ctx = new DataContext(new DataModel({}), '/');
    assert.strictEqual(
      ctx.sanitizeUrl('https://any.example/', 'navigation'),
      'https://any.example/',
    );
    assert.strictEqual(ctx.sanitizeUrl('javascript:alert(1)', 'navigation'), undefined);
  });

  it('reports a blocked URL once as a URL_BLOCKED warning', async () => {
    const {processor} = createProcessor(new RecordingPolicy());
    const {surface, warnings} = createSurface(processor, [
      {id: 'root', component: 'Text', text: 'hi'},
    ]);
    const context = new ComponentContext(surface, 'root');
    context.sanitizeUrl('https://evil.example/a.png', 'media', {propertyName: 'p'});
    context.sanitizeUrl('https://evil.example/a.png', 'media', {propertyName: 'p'});
    await flush();
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].code, 'URL_BLOCKED');
    assert.strictEqual(warnings[0]['url'], 'https://evil.example/a.png');
    assert.strictEqual(warnings[0]['componentId'], 'root');
    assert.strictEqual(warnings[0].surfaceId, 's1');
  });

  it('drops a blocked basic theme iconUrl and warns', async () => {
    const policy = new AllowlistUrlSecurityPolicy({media: ['cdn.example.com']});
    const processor = new MessageProcessor([v09BasicCatalog], undefined, {
      urlSecurityPolicy: policy,
    });
    const warnings: A2uiWarningPayload[] = [];
    processor.model.onSurfaceCreated.subscribe(s => {
      s.onWarning.subscribe(w => {
        warnings.push(w);
      });
    });
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'blocked',
          catalogId: v09BasicCatalog.id,
          theme: {iconUrl: 'https://evil.example/i.png', agentDisplayName: 'A'},
        },
      },
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'allowed',
          catalogId: v09BasicCatalog.id,
          theme: {iconUrl: 'https://cdn.example.com/i.png'},
        },
      },
    ] as never);
    await flush();
    assert.deepStrictEqual(processor.model.getSurface('blocked')!.theme, {agentDisplayName: 'A'});
    assert.deepStrictEqual(processor.model.getSurface('allowed')!.theme, {
      iconUrl: 'https://cdn.example.com/i.png',
    });
    assert.deepStrictEqual(
      warnings.map(w => [w.code, w.surfaceId, w['propertyName']]),
      [['URL_BLOCKED', 'blocked', 'theme.iconUrl']],
    );
  });
});

describe('URL property resolution', () => {
  it('filters basic catalog media props through the policy', () => {
    const {processor} = createProcessor(new RecordingPolicy());
    const {surface} = createSurface(processor, [
      {id: 'root', component: 'Column', children: ['ok', 'bad', 'video', 'audio']},
      {id: 'ok', component: 'Image', url: 'https://cdn.example.com/a.png'},
      {id: 'bad', component: 'Image', url: 'https://evil.example/a.png'},
      {
        id: 'video',
        component: 'Video',
        url: 'https://evil.example/v.mp4',
        posterUrl: 'https://cdn.example.com/p.png',
      },
      {id: 'audio', component: 'AudioPlayer', url: 'https://evil.example/a.mp3'},
    ]);
    assert.strictEqual(bind(surface, 'ok').snapshot.url, 'https://cdn.example.com/a.png');
    assert.strictEqual(bind(surface, 'bad').snapshot.url, undefined);
    const video = bind(surface, 'video').snapshot;
    assert.strictEqual(video.url, undefined);
    assert.strictEqual(video.posterUrl, 'https://cdn.example.com/p.png');
    assert.strictEqual(bind(surface, 'audio').snapshot.url, undefined);
  });

  it('filters the basic media props of a catalog with another ID', () => {
    const demo = new Catalog(CUSTOM_ID, '1.0', [...basicCatalog.components.values()]);
    const processor = new MessageProcessor([demo], undefined, {
      urlSecurityPolicy: new RecordingPolicy(),
    });
    const {surface} = createSurface(
      processor,
      [{id: 'root', component: 'Image', url: 'https://evil.example/a.png'}],
      {catalogId: CUSTOM_ID},
    );
    assert.strictEqual(bind(surface, 'root').snapshot.url, undefined);
  });

  it('filters the media props of the basic catalog loaded from its JSON document', () => {
    const loaded = Catalog.fromJson(basicCatalog.toJson());
    const processor = new MessageProcessor(
      [loaded as unknown as Catalog<ComponentApi>],
      undefined,
      {
        urlSecurityPolicy: new RecordingPolicy(),
      },
    );
    const {surface} = createSurface(processor, [
      {id: 'root', component: 'Image', url: 'https://evil.example/a.png'},
    ]);
    assert.strictEqual(bind(surface, 'root').snapshot.url, undefined);
  });

  it('filters data-bound values and recomputes them when the data changes', async () => {
    const {processor} = createProcessor(new RecordingPolicy());
    const {surface, warnings} = createSurface(
      processor,
      [{id: 'root', component: 'Image', url: {'@path': '/photo'}}],
      {dataModel: {photo: 'https://cdn.example.com/a.png'}},
    );
    const binder = bind(surface, 'root');
    assert.strictEqual(binder.snapshot.url, 'https://cdn.example.com/a.png');

    surface.dataModel.set('/photo', 'https://evil.example/?d=secret');
    await flush();
    assert.strictEqual(binder.snapshot.url, undefined);
    assert.deepStrictEqual(
      warnings.map(w => [w.code, w['componentId'], w['propertyName'], w['context']]),
      [['URL_BLOCKED', 'root', 'url', 'media']],
    );

    surface.dataModel.set('/photo', 'https://cdn.example.com/b.png');
    await flush();
    assert.strictEqual(binder.snapshot.url, 'https://cdn.example.com/b.png');
  });

  it('filters formatString results after they resolve', async () => {
    const {processor} = createProcessor(new RecordingPolicy());
    const {surface} = createSurface(
      processor,
      [
        {
          id: 'root',
          component: 'Image',
          url: {'@call': 'formatString', args: {value: 'https://${/host}/x.png?d=${/secret}'}},
        },
      ],
      {dataModel: {host: 'cdn.example.com', secret: 's3cr3t'}},
    );
    const binder = bind(surface, 'root');
    assert.strictEqual(binder.snapshot.url, 'https://cdn.example.com/x.png?d=s3cr3t');
    surface.dataModel.set('/host', 'evil.example');
    await flush();
    assert.strictEqual(binder.snapshot.url, undefined);
  });

  it('filters annotated props of custom components, including nested ones', () => {
    const policy = new RecordingPolicy();
    const {processor} = createProcessor(policy);
    const {surface} = createSurface(
      processor,
      [
        {
          id: 'root',
          component: 'ProductCard',
          imageUrl: 'https://evil.example/a.png',
          items: [
            {thumbUrl: 'https://cdn.example.com/1.png', label: 'one'},
            {thumbUrl: 'https://evil.example/2.png', label: 'two'},
          ],
          tileUrl: 'https://evil.example/tile.png',
        },
      ],
      {catalogId: CUSTOM_ID},
    );
    const props = bind(surface, 'root').snapshot;
    assert.strictEqual(props.imageUrl, undefined);
    assert.deepStrictEqual(
      props.items.map((i: {thumbUrl?: string}) => i.thumbUrl),
      ['https://cdn.example.com/1.png', undefined],
    );
    // `tileUrl` is not annotated, so it is not a URL as far as the resolver knows.
    assert.strictEqual(props.tileUrl, 'https://evil.example/tile.png');
    assert.ok(
      policy.calls.some(c => c.info?.propertyName === 'items[].thumbUrl'),
      JSON.stringify(policy.calls.map(c => c.info?.propertyName)),
    );
  });

  it('marks props of catalogs the host can not edit through urlProperties', () => {
    const policy = new RecordingPolicy({
      [CUSTOM_ID]: {ProductCard: {tileUrl: 'media', imageUrl: 'none'}},
    });
    const {processor} = createProcessor(policy);
    const {surface} = createSurface(
      processor,
      [
        {
          id: 'root',
          component: 'ProductCard',
          imageUrl: 'https://evil.example/a.png',
          tileUrl: 'https://evil.example/tile.png',
        },
      ],
      {catalogId: CUSTOM_ID},
    );
    const props = bind(surface, 'root').snapshot;
    assert.strictEqual(props.tileUrl, undefined);
    // The host's `none` wins over the catalog's annotation.
    assert.strictEqual(props.imageUrl, 'https://evil.example/a.png');
  });

  it('checks each resolved value once, so a rewritten URL is not checked again', () => {
    const policy = new AllowlistUrlSecurityPolicy({
      media: ['cdn.other.com'],
      rewrite: {media: url => `https://proxy.example.com/?u=${encodeURIComponent(url)}`},
    });
    const calls: string[] = [];
    const recording: UrlSecurityPolicy = {
      sanitizeUrl: (url, context, info) => {
        calls.push(url);
        return policy.sanitizeUrl(url, context, info);
      },
    };
    const {processor} = createProcessor(recording);
    const {surface} = createSurface(processor, [
      {id: 'root', component: 'Image', url: 'https://cdn.other.com/a.png'},
    ]);
    const binder = bind(surface, 'root');
    assert.strictEqual(
      binder.snapshot.url,
      'https://proxy.example.com/?u=https%3A%2F%2Fcdn.other.com%2Fa.png',
    );
    assert.ok(
      calls.every(url => url === 'https://cdn.other.com/a.png'),
      JSON.stringify(calls),
    );
  });

  it('leaves components outside any annotation untouched without a policy', () => {
    const {processor} = createProcessor();
    const {surface} = createSurface(processor, [
      {id: 'root', component: 'Image', url: 'https://any.example/a.png'},
    ]);
    assert.strictEqual(bind(surface, 'root').snapshot.url, 'https://any.example/a.png');
  });

  it('applies the baseline without a policy', () => {
    const {processor} = createProcessor();
    const {surface} = createSurface(processor, [
      {id: 'root', component: 'Image', url: 'javascript:alert(1)'},
    ]);
    assert.strictEqual(bind(surface, 'root').snapshot.url, undefined);
  });

  it('works on a standalone surface built without a processor', () => {
    const surface = new SurfaceModel('s', customCatalog);
    surface.componentsModel.addComponent(
      new ComponentModel(
        'c',
        'ProductCard',
        {imageUrl: 'https://evil.example/a.png'},
        customCatalog,
      ),
    );
    assert.strictEqual(bind(surface, 'c').snapshot.imageUrl, 'https://evil.example/a.png');
    surface.urlSecurityPolicy = new AllowlistUrlSecurityPolicy({media: ['cdn.example.com']});
    assert.strictEqual(bind(surface, 'c').snapshot.imageUrl, undefined);
  });
});

describe('openUrl and the URL security policy', () => {
  function withWindow<T>(fn: (opened: string[]) => T): T {
    const original = (globalThis as {window?: unknown}).window;
    const opened: string[] = [];
    (globalThis as {window?: unknown}).window = {
      location: {href: 'https://host.example/page'},
      open: (url: string) => {
        opened.push(url);
      },
    };
    try {
      return fn(opened);
    } finally {
      (globalThis as {window?: unknown}).window = original;
    }
  }

  function surfaceWithButton(url: string, extra = {}) {
    const {processor} = createProcessor(
      new AllowlistUrlSecurityPolicy({navigation: ['*.example.com']}),
      extra,
    );
    return createSurface(processor, [
      {
        id: 'root',
        component: 'Button',
        child: 'label',
        action: {functionCall: {'@call': 'openUrl', args: {url}}},
      },
      {id: 'label', component: 'Text', text: 'Go'},
    ]);
  }

  it('opens an allowed URL', async () => {
    await withWindow(async opened => {
      const {surface, errors} = surfaceWithButton('https://shop.example.com/p/1');
      await bind(surface, 'root').snapshot.action();
      assert.deepStrictEqual(opened, ['https://shop.example.com/p/1']);
      assert.deepStrictEqual(errors, []);
    });
  });

  it('reports a blocked URL as URL_BLOCKED and never opens it', async () => {
    await withWindow(async opened => {
      const {surface, errors} = surfaceWithButton('https://evil.example/?d=1');
      await bind(surface, 'root').snapshot.action();
      await flush();
      assert.deepStrictEqual(opened, []);
      assert.deepStrictEqual(
        errors.map(e => [e.code, e.surfaceId]),
        [['URL_BLOCKED', 's1']],
      );
    });
  });

  it('hands allowed URLs to the host handler instead of window.open', async () => {
    await withWindow(async opened => {
      const handled: Array<[string, UrlCheckInfo]> = [];
      const openUrlHandler = (url: string, info: UrlCheckInfo) => {
        handled.push([url, info]);
      };
      const allowed = surfaceWithButton('https://shop.example.com/p/1', {openUrlHandler});
      await bind(allowed.surface, 'root').snapshot.action();
      const blocked = surfaceWithButton('https://evil.example/', {openUrlHandler});
      await bind(blocked.surface, 'root').snapshot.action();
      assert.deepStrictEqual(opened, []);
      assert.deepStrictEqual(handled, [
        ['https://shop.example.com/p/1', {functionName: 'openUrl', surfaceId: 's1'}],
      ]);
    });
  });

  it('keeps the user activation rule', () => {
    withWindow(opened => {
      assert.throws(
        () =>
          basicCatalog.invoker('openUrl', {url: 'https://shop.example.com/'}, {
            isPassiveEvaluation: true,
          } as never),
        (err: unknown) =>
          err instanceof A2uiExpressionError && /requires user activation/.test(err.message),
      );
      assert.deepStrictEqual(opened, []);
    });
  });

  it('throws URL_BLOCKED from executeOpenUrl', () => {
    withWindow(opened => {
      const surface = new SurfaceModel('s', basicCatalog);
      surface.urlSecurityPolicy = new AllowlistUrlSecurityPolicy({navigation: []});
      assert.throws(
        () => executeOpenUrl('https://example.com/', new DataContext(surface, '/')),
        (err: unknown) => err instanceof A2uiExpressionError && err.code === 'URL_BLOCKED',
      );
      assert.deepStrictEqual(opened, []);
    });
  });

  it('lets a custom function check a URL with one call on its DataContext', () => {
    const shared: string[] = [];
    const ShareApi = {
      name: 'share',
      returnType: 'void' as const,
      schema: z.object({url: z.string()}),
    };
    const share = createFunctionImplementation(ShareApi, (args, context) => {
      const url = context.sanitizeUrl(args.url, 'navigation', {functionName: 'share'});
      if (url !== undefined) shared.push(url);
    });
    const surface = new SurfaceModel('s', basicCatalog);
    surface.urlSecurityPolicy = new AllowlistUrlSecurityPolicy({navigation: ['*.example.com']});
    const ctx = new DataContext(surface, '/');
    share.execute({url: 'https://a.example.com/'}, ctx);
    share.execute({url: 'https://evil.example/'}, ctx);
    assert.deepStrictEqual(shared, ['https://a.example.com/']);
  });
});
