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

import {describe, expect, it} from 'vitest';
import {parseEvent} from './agent_client';
import {BridgeLog, writtenPaths} from './bridge_log';
import {highlightExpress} from './highlight';

describe('parseEvent', () => {
  it('reads the event name and JSON data', () => {
    expect(parseEvent('event: timing\ndata: {"checkpoint": "firstToken", "at": 12}')).toEqual({
      type: 'timing',
      data: {checkpoint: 'firstToken', at: 12},
    });
  });

  it('ignores blocks without data', () => {
    expect(parseEvent(': keep-alive')).toBeNull();
  });
});

describe('BridgeLog', () => {
  it('pairs responses with their requests and times them', () => {
    const log = new BridgeLog();
    log.record({
      type: 'message',
      direction: 'in',
      message: {jsonrpc: '2.0', id: 7, method: 'function/call', params: {name: 'querySales'}},
      time: 100,
    });
    const response = log.record({
      type: 'message',
      direction: 'out',
      message: {jsonrpc: '2.0', id: 7, result: {value: []}},
      time: 142,
    });

    expect(response.direction).toBe('host→app');
    expect(response.request).toEqual({method: 'function/call', durationMs: 42});
    expect(log.getEntries()).toHaveLength(2);
  });

  it('lists the paths the app wrote, once each', () => {
    const log = new BridgeLog();
    for (const [id, path] of [
      [1, '/trip/stops'],
      [2, '/trip/summary'],
      [3, '/trip/stops'],
    ] as const) {
      log.record({
        type: 'message',
        direction: 'in',
        message: {jsonrpc: '2.0', id, method: 'data/set', params: {path, value: 1}},
        time: id,
      });
    }

    expect(writtenPaths(log.getEntries())).toEqual(['/trip/stops', '/trip/summary']);
  });

  it('notifies subscribers', () => {
    const log = new BridgeLog();
    let calls = 0;
    const stop = log.subscribe(() => calls++);
    log.record({type: 'ready', time: 1});
    stop();
    log.record({type: 'ready', time: 2});

    expect(calls).toBe(1);
  });
});

describe('highlightExpress', () => {
  it('keeps prose apart and folds raw strings into one token', () => {
    const tokens = highlightExpress(
      'Here you go.\n<a2ui>\napp = ReactApp(source=r"""\nexport default function App() {}\n""")\n</a2ui>',
    );

    expect(tokens[0]).toEqual({kind: 'prose', text: 'Here you go.\n'});
    expect(tokens.find(t => t.kind === 'component')?.text).toBe('ReactApp');
    const raw = tokens.filter(t => t.kind === 'raw-block');
    expect(raw).toHaveLength(1);
    expect(raw[0]!.text).toContain('export default function App');
    expect(tokens.map(t => t.text).join('')).toContain('</a2ui>');
  });
});
