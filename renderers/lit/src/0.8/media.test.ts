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

import {setupTestDom, teardownTestDom, asyncUpdate} from '../tests/dom-setup.js';
import assert from 'node:assert';
import {describe, it, after, before, afterEach} from 'node:test';
import type {Theme} from '@a2ui/web_core/types/types';
import type {Image} from './ui/image.js';
import type {Video} from './ui/video.js';
import type {Audio} from './ui/audio.js';

const mockTheme = {
  components: {
    Image: {
      all: {},
      icon: {},
      avatar: {},
      smallFeature: {},
      mediumFeature: {},
      largeFeature: {},
      header: {},
    },
    Video: {},
    AudioPlayer: {},
  },
} as unknown as Theme;

describe('0.8 Media Components URL Scheme Validation', () => {
  const mountedElements: HTMLElement[] = [];

  before(async () => {
    setupTestDom();
    await import('./ui/image.js');
    await import('./ui/video.js');
    await import('./ui/audio.js');
  });

  afterEach(() => {
    while (mountedElements.length > 0) {
      mountedElements.pop()?.remove();
    }
  });

  after(teardownTestDom);

  it('allows http and https URLs on Image, Video, and Audio', async () => {
    const imgEl = document.createElement('a2ui-image') as Image;
    imgEl.theme = mockTheme;
    mountedElements.push(imgEl);
    document.body.appendChild(imgEl);
    await asyncUpdate(imgEl, (e: Image) => {
      e.url = {literalString: 'https://example.com/photo.png'};
    });
    assert.strictEqual(
      imgEl.shadowRoot?.querySelector('img')?.getAttribute('src'),
      'https://example.com/photo.png',
    );

    const vidEl = document.createElement('a2ui-video') as Video;
    vidEl.theme = mockTheme;
    mountedElements.push(vidEl);
    document.body.appendChild(vidEl);
    await asyncUpdate(vidEl, (e: Video) => {
      e.url = {literalString: 'https://example.com/clip.mp4'};
    });
    assert.strictEqual(
      vidEl.shadowRoot?.querySelector('video')?.getAttribute('src'),
      'https://example.com/clip.mp4',
    );

    const audEl = document.createElement('a2ui-audioplayer') as Audio;
    audEl.theme = mockTheme;
    mountedElements.push(audEl);
    document.body.appendChild(audEl);
    await asyncUpdate(audEl, (e: Audio) => {
      e.url = {literalString: 'http://example.com/track.mp3'};
    });
    assert.strictEqual(
      audEl.shadowRoot?.querySelector('audio')?.getAttribute('src'),
      'http://example.com/track.mp3',
    );
  });

  it('blocks disallowed URL schemes on Image, Video, and Audio', async () => {
    const disallowedUrls = [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      'file:///etc/passwd',
      'blob:https://example.com/123',
      '//evil.example.com/resource',
    ];

    const imgEl = document.createElement('a2ui-image') as Image;
    imgEl.theme = mockTheme;
    mountedElements.push(imgEl);
    document.body.appendChild(imgEl);

    const vidEl = document.createElement('a2ui-video') as Video;
    vidEl.theme = mockTheme;
    mountedElements.push(vidEl);
    document.body.appendChild(vidEl);

    const audEl = document.createElement('a2ui-audioplayer') as Audio;
    audEl.theme = mockTheme;
    mountedElements.push(audEl);
    document.body.appendChild(audEl);

    for (const badUrl of disallowedUrls) {
      await asyncUpdate(imgEl, (e: Image) => {
        e.url = {literalString: badUrl};
      });
      assert.strictEqual(imgEl.shadowRoot?.querySelector('img'), null);

      await asyncUpdate(vidEl, (e: Video) => {
        e.url = {literalString: badUrl};
      });
      assert.strictEqual(vidEl.shadowRoot?.querySelector('video'), null);

      await asyncUpdate(audEl, (e: Audio) => {
        e.url = {literalString: badUrl};
      });
      assert.strictEqual(audEl.shadowRoot?.querySelector('audio'), null);
    }
  });
});
