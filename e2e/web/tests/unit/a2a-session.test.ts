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

import {ClientFactory} from '@a2a-js/sdk/client';
import {type ComponentApi} from '@a2ui/web_core';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {A2aSession} from '../../src/a2a-session.js';
import {rendererCatalogs} from '../../src/shell-common.js';

describe('A2aSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards rejected automatic outbound turns to onFailure without unhandled rejections', async () => {
    const failure = new Error('agent offline');
    vi.spyOn(ClientFactory.prototype, 'createFromUrl').mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFailure = vi.fn();

    const session = new A2aSession<ComponentApi>({
      agentUrl: 'http://127.0.0.1:10201/',
      version: '1.0',
      capabilities: 'v1_0',
      catalogs: rendererCatalogs<ComponentApi>('1.0'),
      onText: () => {},
      onSurfaces: () => {},
      onProgress: () => {},
      onFailure,
    });

    session.processor.processMessagesWithErrors([
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 'missing-surface',
          path: '/value',
          value: 1,
        },
      },
    ]);

    await expect.poll(() => onFailure.mock.calls.length).toBe(1);
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(consoleError).toHaveBeenCalledWith('Automatic A2A turn failed:', failure);
  });
});
