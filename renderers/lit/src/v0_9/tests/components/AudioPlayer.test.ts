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

import {setupTestDom, teardownTestDom, asyncUpdate} from '../dom-setup.js';
import assert from 'node:assert';
import {describe, it, beforeEach, after, before} from 'node:test';
import {ComponentContext, MessageProcessor} from '@a2ui/web_core/v0_9';

describe('AudioPlayer Component', () => {
  let basicCatalog: any;

  before(async () => {
    setupTestDom();
    basicCatalog = (await import('../../catalogs/basic/index.js')).basicCatalog;
    await import('../../catalogs/basic/components/AudioPlayer.js');
  });

  after(teardownTestDom);

  let processor: MessageProcessor<any>;
  let surface: any;

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
              id: 'audio_test',
              component: 'AudioPlayer',
              url: 'https://example.com/audio.mp3',
              description: 'Sample Audio Description',
            },
          ],
        },
      },
    ]);
    surface = processor.model.getSurface('test-surface')!;
  });

  it('should render audio player with description linked by aria-describedby', async () => {
    const el = document.createElement('a2ui-audioplayer') as any;
    document.body.appendChild(el);

    const context = new ComponentContext(surface, 'audio_test');
    await asyncUpdate(el, e => {
      e.context = context;
    });

    const desc = el.shadowRoot.querySelector('.a2ui-audio-description');
    assert.ok(desc);
    assert.strictEqual(desc.textContent.trim(), 'Sample Audio Description');
    assert.strictEqual(desc.getAttribute('id'), 'audio_test-desc');

    const audio = el.shadowRoot.querySelector('audio');
    assert.ok(audio);
    assert.strictEqual(audio.getAttribute('src'), 'https://example.com/audio.mp3');
    assert.strictEqual(audio.getAttribute('aria-describedby'), 'audio_test-desc');

    document.body.removeChild(el);
  });
});
