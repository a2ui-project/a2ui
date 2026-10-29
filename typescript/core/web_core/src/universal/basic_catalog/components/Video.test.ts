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
import {describe, it, before, after, beforeEach, afterEach} from 'node:test';
import {setupTestDom, teardownTestDom, asyncUpdate} from '../../../test/dom-setup.js';
import {
  ComponentContext,
  MessageProcessor,
  Catalog,
  SurfaceModel,
  Subscription,
} from '../../../v0_9/index.js';
import {
  type A2uiWebComponentElement,
  registerUniversalElement,
  type WebComponentImplementation,
} from '../../index.js';

describe('Video Component', () => {
  let basicCatalog: Catalog<WebComponentImplementation>;
  let v1BasicCatalog: Catalog<WebComponentImplementation>;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../../v0_9/basic_catalog/index.js')).basicCatalog;
    v1BasicCatalog = (await import('../../../catalogs/basic/v1/index.js')).basicCatalog;
    basicCatalog.components.forEach(c => registerUniversalElement(c));
  });

  after(teardownTestDom);

  let processor: MessageProcessor<WebComponentImplementation>;
  let surface: SurfaceModel;
  let element: A2uiWebComponentElement | null = null;
  let subscription: Subscription | null = null;

  beforeEach(() => {
    processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'test-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp1',
              component: 'Video',
              url: 'http://example.com/video.mp4',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
    if (element) {
      element.remove();
      element = null;
    }
  });

  it('should render and attach url correctly', async () => {
    const el = document.createElement('a2ui-video') as A2uiWebComponentElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    assert.notStrictEqual(el, null);
    const video = el.querySelector('video');
    assert.notStrictEqual(video, null);
    assert.strictEqual(video?.getAttribute('src'), 'http://example.com/video.mp4');
    assert.strictEqual(video?.classList.contains('a2ui-video'), true);
  });

  it('should allow data: URLs on Video', async () => {
    const dataUrl = 'data:video/mp4;base64,AAAA';
    processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'test-surface',
          components: [
            {
              id: 'comp1',
              component: 'Video',
              url: dataUrl,
            },
          ],
        },
      },
    ]);

    const el = document.createElement('a2ui-video') as A2uiWebComponentElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const video = el.querySelector('video');
    assert.notStrictEqual(video, null);
    assert.strictEqual(video?.getAttribute('src'), dataUrl);
  });

  it('should omit src when url uses a disallowed scheme', async () => {
    const disallowedUrls = [
      'javascript:alert(1)',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.com/123',
      '//evil.example.com/video.mp4',
      '/\\evil.example.com/video.mp4',
      '/\t/evil.example.com/video.mp4',
      'http:evil.example.com/video.mp4',
      'https:evil.example.com/video.mp4',
    ];

    const el = document.createElement('a2ui-video') as A2uiWebComponentElement;
    element = el;
    document.body.appendChild(el);

    for (const badUrl of disallowedUrls) {
      processor.processMessages([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'test-surface',
            components: [
              {
                id: 'comp1',
                component: 'Video',
                url: badUrl,
              },
            ],
          },
        },
      ]);

      const context = new ComponentContext(surface, 'comp1');
      await asyncUpdate(el, e => {
        e.context = context;
      });

      const video = el.querySelector('video');
      assert.notStrictEqual(video, null);
      assert.strictEqual(
        video?.getAttribute('src'),
        null,
        `Expected src to be omitted for ${badUrl}`,
      );
    }
  });

  it('should sanitize posterUrl on a v1.0 Video surface', async () => {
    const v1Processor = new MessageProcessor([v1BasicCatalog]);
    v1Processor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'v1-video-surface',
          catalogId: v1BasicCatalog.id,
        },
      },
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'v1-video-surface',
          components: [
            {
              id: 'comp1',
              component: 'Video',
              url: 'https://example.com/video.mp4',
              posterUrl: 'https://example.com/poster.png',
            },
          ],
        },
      },
    ]);

    const v1Surface = v1Processor.model.getSurface('v1-video-surface')!;
    const el = document.createElement('a2ui-video') as A2uiWebComponentElement;
    element = el;
    document.body.appendChild(el);

    const context = new ComponentContext(v1Surface, 'comp1');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    let video = el.querySelector('video');
    assert.notStrictEqual(video, null);
    assert.strictEqual(video?.getAttribute('poster'), 'https://example.com/poster.png');

    const dataPoster = 'data:image/png;base64,AAAA';
    v1Processor.processMessages([
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'v1-video-surface',
          components: [
            {
              id: 'comp1',
              component: 'Video',
              url: 'https://example.com/video.mp4',
              posterUrl: dataPoster,
            },
          ],
        },
      },
    ]);

    await asyncUpdate(el, e => {
      e.context = new ComponentContext(v1Surface, 'comp1');
    });
    video = el.querySelector('video');
    assert.strictEqual(video?.getAttribute('poster'), dataPoster);

    const disallowedPosterUrls = [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'blob:https://example.com/123',
      '//evil.example.com/poster.png',
      '/\\evil.example.com/poster.png',
      '/\t/evil.example.com/poster.png',
      'http:evil.example.com/poster.png',
      'https:evil.example.com/poster.png',
    ];

    for (const badPoster of disallowedPosterUrls) {
      v1Processor.processMessages([
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'v1-video-surface',
            components: [
              {
                id: 'comp1',
                component: 'Video',
                url: 'https://example.com/video.mp4',
                posterUrl: badPoster,
              },
            ],
          },
        },
      ]);

      await asyncUpdate(el, e => {
        e.context = new ComponentContext(v1Surface, 'comp1');
      });

      video = el.querySelector('video');
      assert.strictEqual(
        video?.getAttribute('poster'),
        null,
        `Expected poster to be omitted for ${badPoster}`,
      );
    }
  });
});
