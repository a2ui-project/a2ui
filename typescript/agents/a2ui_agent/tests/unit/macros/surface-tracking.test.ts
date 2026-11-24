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

import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  type AgentToRendererMessage,
  type ComponentNode,
  defineMacro,
  MacroExpander,
} from '../../../src/index.js';
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const BASIC = BASIC_CATALOG_IDS['1.0'];

/** A macro named like the basic `Text`: it expands only where `Text` isn't the basic one. */
const Text = defineMacro({
  name: 'Text',
  render: (): ComponentNode => ({component: 'Card', child: 'content'}),
});

function expander(): MacroExpander {
  return new MacroExpander([Text], {baseCatalogs: [loadBasicCatalog('1.0')]});
}

function created(surfaceId: string): unknown {
  return {version: 'v1.0', createSurface: {surfaceId, catalogId: BASIC}};
}

function textUpdate(surfaceId: string): unknown {
  return {
    version: 'v1.0',
    updateComponents: {surfaceId, components: [{component: 'Text', id: 't'}]},
  };
}

/** Whether `Text` is lowered there: only on a surface the expander doesn't know. */
function lowersText(
  target: MacroExpander,
  surfaceId: string,
  options?: Parameters<MacroExpander['transformToTransport']>[1],
): boolean {
  const [message] = target.transformToTransport(
    [textUpdate(surfaceId)] as AgentToRendererMessage[],
    options,
  ) as unknown as Array<{updateComponents: {components: Array<{component: string}>}}>;
  return message.updateComponents.components[0].component === 'Card';
}

describe('MacroExpander surface tracking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forgets the default catalog of a deleted surface', () => {
    const target = expander();
    target.transformToTransport([created('s')] as AgentToRendererMessage[]);
    expect(lowersText(target, 's')).toBe(false);

    target.transformToTransport([
      {version: 'v1.0', deleteSurface: {surfaceId: 's'}},
    ] as unknown as AgentToRendererMessage[]);

    expect(lowersText(target, 's')).toBe(true);
  });

  it('uses surfaceCatalogs instead of its own record, and leaves the record unchanged', () => {
    const target = expander();

    expect(lowersText(target, 's', {surfaceCatalogs: {s: BASIC}})).toBe(false);
    target.transformToTransport([created('other')] as AgentToRendererMessage[], {
      surfaceCatalogs: {},
    });

    expect(lowersText(target, 's')).toBe(true);
    expect(lowersText(target, 'other')).toBe(true);
  });

  it('forgets the oldest surface beyond 256 and warns', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const target = expander();
    const surfaces = Array.from({length: 257}, (_, index) => created(`s${index}`));

    target.transformToTransport(surfaces as AgentToRendererMessage[]);

    expect(warned).toHaveBeenCalledTimes(1);
    expect(lowersText(target, 's0')).toBe(true);
    expect(lowersText(target, 's1')).toBe(false);
    expect(lowersText(target, 's256')).toBe(false);
  });
});
