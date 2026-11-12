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

import {renderHook, act} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {useA2UISurface} from './useA2UISurface';
import {useStreamingPlayer} from './useStreamingPlayer';

describe('useA2UISurface', () => {
  it('merges incremental updateComponents by id and applies root/path updateDataModel', () => {
    const messages = [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {id: 'root', component: 'Column', children: ['title']},
            {id: 'title', component: 'Text', text: 'Initial'},
          ],
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {id: 'root', component: 'Column', children: ['title', 'subtitle']},
            {id: 'subtitle', component: 'Text', text: {path: '/user/role'}},
          ],
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          value: {user: {name: 'Alice'}, items: ['a', 'b']},
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          path: '/user/role',
          value: 'Admin',
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          path: '/items/1',
          value: 'b-updated',
        },
      },
    ];

    const {result} = renderHook(() => useA2UISurface(messages));
    expect(result.current.root).toBe('root');
    expect(result.current.components).toEqual([
      {id: 'root', component: 'Column', children: ['title', 'subtitle']},
      {id: 'title', component: 'Text', text: 'Initial'},
      {id: 'subtitle', component: 'Text', text: {path: '/user/role'}},
    ]);
    expect(result.current.data).toEqual({
      user: {name: 'Alice', role: 'Admin'},
      items: ['a', 'b-updated'],
    });
  });

  it('supports key deletion via updateDataModel with undefined value, root replacement/clear, and resets on deleteSurface', () => {
    const messagesWithDeleteKey: Array<Record<string, unknown>> = [
      {
        version: 'v0.9',
        createSurface: {surfaceId: 's1'},
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          value: {staleKey: 99},
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          value: {keep: 1, removeMe: 2, list: ['x', 'y']},
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          path: '/removeMe',
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's1',
          path: '/list/0',
        },
      },
    ];

    const {result, rerender} = renderHook(({msgs}) => useA2UISurface(msgs), {
      initialProps: {msgs: messagesWithDeleteKey},
    });
    expect(result.current.data).toEqual({keep: 1, list: ['y']});

    rerender({
      msgs: [
        ...messagesWithDeleteKey,
        {
          version: 'v0.9',
          updateDataModel: {surfaceId: 's1', path: '/'},
        },
      ],
    });
    expect(result.current.data).toEqual({});

    rerender({
      msgs: [
        ...messagesWithDeleteKey,
        {
          version: 'v0.9',
          deleteSurface: {surfaceId: 's1'},
        },
      ],
    });
    expect(result.current.components).toEqual([]);
    expect(result.current.data).toEqual({});
  });
});

describe('useStreamingPlayer', () => {
  it('generates stream chunks and lifecycle events for v0.9 messages', () => {
    const messages = [
      {
        version: 'v0.9',
        createSurface: {surfaceId: 'main'},
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'main',
          components: [{id: 'root', component: 'Text', text: 'Hello'}],
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'main',
          value: {status: 'ok'},
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'main',
          path: '/items',
          value: ['one', 'two'],
        },
      },
      {
        version: 'v0.9',
        action: {name: 'submit'},
      },
      {
        version: 'v0.9',
        deleteSurface: {surfaceId: 'main'},
      },
    ];

    const {result} = renderHook(() => useStreamingPlayer(messages));

    expect(result.current.totalChunks).toBe(6);
    expect(result.current.chunks.map(c => c.isClient)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(result.current.lifecycleEvents).toEqual([
      {chunkIndex: 0, summary: 'Surface "main" created', type: 'surface'},
      {chunkIndex: 1, summary: '1 components updated', type: 'components'},
      {chunkIndex: 2, summary: 'Data model: status', type: 'data'},
      {chunkIndex: 3, summary: 'Data model: /items', type: 'data'},
      {chunkIndex: 4, summary: 'User action: submit', type: 'action'},
      {chunkIndex: 5, summary: 'Surface "main" deleted', type: 'delete'},
    ]);

    act(() => {
      result.current.seek(4);
    });
    expect(result.current.progress).toBe(4);
    expect(result.current.activeMessages).toHaveLength(4);
    expect(result.current.visibleEvents).toHaveLength(4);
  });
});
