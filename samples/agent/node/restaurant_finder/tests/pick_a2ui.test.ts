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

// The renderer names its A2UI version and catalogs in the message metadata;
// pickA2ui reads them and falls back to v0.9 when the metadata says nothing.

import type {Message} from '@a2a-js/sdk';
import {describe, expect, it} from 'vitest';

import {pickA2ui} from '../src/pick_a2ui.js';
import {DEFAULT_VERSION, V0_9, V1_0} from '../src/versions.js';

const V0_9_CATALOG = V0_9.basicCatalogId;
const V1_0_CATALOG = V1_0.basicCatalogId;

function message(metadata?: Record<string, unknown>): Message {
  return {
    kind: 'message',
    messageId: 'message-1',
    role: 'user',
    parts: [{kind: 'text', text: 'Top 5 Chinese restaurants in New York.'}],
    metadata,
  };
}

const v0_9Capabilities = {'v0.9': {supportedCatalogIds: [V0_9_CATALOG]}};
const v1_0Capabilities = {'v1.0': {supportedCatalogIds: [V1_0_CATALOG]}};

describe('pickA2ui', () => {
  it('picks v1.0 and its catalogs from a2uiRendererCapabilities', () => {
    expect(pickA2ui(message({a2uiRendererCapabilities: v1_0Capabilities}))).toEqual({
      profile: V1_0,
      catalogIds: [V1_0_CATALOG],
    });
  });

  it('picks v0.9 and its catalogs from a2uiClientCapabilities', () => {
    expect(pickA2ui(message({a2uiClientCapabilities: v0_9Capabilities}))).toEqual({
      profile: V0_9,
      catalogIds: [V0_9_CATALOG],
    });
  });

  it('picks the newest version when the renderer supports both', () => {
    const picked = pickA2ui(
      message({
        a2uiClientCapabilities: v0_9Capabilities,
        a2uiRendererCapabilities: v1_0Capabilities,
      }),
    );
    expect(picked).toEqual({profile: V1_0, catalogIds: [V1_0_CATALOG]});
  });

  it('falls back to the default version and its basic catalog without capabilities', () => {
    expect(pickA2ui(message())).toEqual({profile: DEFAULT_VERSION, catalogIds: [V0_9_CATALOG]});
    expect(DEFAULT_VERSION).toBe(V0_9);
  });

  it('throws when the renderer names only versions this agent does not serve', () => {
    expect(() => pickA2ui(message({a2uiRendererCapabilities: {'v2.0': {}}}))).toThrow();
  });
});
