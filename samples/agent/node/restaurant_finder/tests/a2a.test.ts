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

// readInboundMessage takes the text, the UI action and the streaming preference out of
// an inbound A2A message without interpreting them.

import type {Message, Part} from '@a2a-js/sdk';
import {describe, expect, it} from 'vitest';

import {readInboundMessage} from '../src/a2a.js';

function message(...parts: Part[]): Message {
  return {kind: 'message', messageId: 'message-1', role: 'user', parts};
}

describe('readInboundMessage', () => {
  it('joins the text parts and streams by default', () => {
    const inbound = readInboundMessage(
      message({kind: 'text', text: 'Top 5 '}, {kind: 'text', text: 'Chinese restaurants'}),
      'v0.9',
    );
    expect(inbound).toEqual({text: 'Top 5 Chinese restaurants', useStreaming: true});
  });

  it('reads an action labeled with the agent version', () => {
    const inbound = readInboundMessage(
      message({
        kind: 'data',
        data: {version: 'v1.0', action: {name: 'book_restaurant', context: {address: 'Main St'}}},
      }),
      'v1.0',
    );
    expect(inbound.action).toEqual({name: 'book_restaurant', context: {address: 'Main St'}});
  });

  it('ignores an action labeled with another version, but reads a legacy userAction', () => {
    const otherVersion = readInboundMessage(
      message({kind: 'data', data: {version: 'v1.0', action: {name: 'book_restaurant'}}}),
      'v0.9',
    );
    expect(otherVersion.action).toBeUndefined();

    const legacy = readInboundMessage(
      message({kind: 'data', data: {userAction: {name: 'submit_booking'}}}),
      'v0.9',
    );
    expect(legacy.action).toEqual({name: 'submit_booking', context: {}});
  });

  it('reads the streaming preference from a data part', () => {
    const inbound = readInboundMessage(
      message({kind: 'text', text: 'hi'}, {kind: 'data', data: {useStreaming: false}}),
      'v0.9',
    );
    expect(inbound).toEqual({text: 'hi', useStreaming: false});
  });
});
