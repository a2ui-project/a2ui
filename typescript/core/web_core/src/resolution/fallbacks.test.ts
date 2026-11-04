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

import assert from 'node:assert';
import {describe, it} from 'node:test';
import {z} from 'zod';
import {Catalog} from '../catalog/types.js';
import {ComponentModel} from '../state/component-model.js';
import {SurfaceModel} from '../state/surface-model.js';
import {ComponentIdSchema} from '../v0_9/schema/common-types.js';
import {getValue, peekValue} from '../reactivity/signals.js';
import type {ComponentNode} from './component-node.js';
import {NodeResolver} from './node-resolver.js';
import {buildFallback, fallbackRequestFor, rootPendingRequest} from './fallbacks.js';

const catalog = new Catalog('test', '0.9', [
  {name: 'Card', schema: z.object({child: ComponentIdSchema.optional()})},
]);

function rootWithChild(childType?: string): {root: ComponentNode; resolver: NodeResolver} {
  const surface = new SurfaceModel('s', catalog);
  surface.componentsModel.addComponent(new ComponentModel('root', 'Card', {child: 'c'}, catalog));
  if (childType) {
    surface.componentsModel.addComponent(
      new ComponentModel('c', childType, childType === 'Card' ? {child: 'root'} : {}, catalog),
    );
  }
  const resolver = new NodeResolver(surface, catalog);
  return {root: getValue(resolver.rootNode)!, resolver};
}

function childOf(root: ComponentNode): ComponentNode {
  return peekValue(root.props)['child'] as ComponentNode;
}

describe('fallbackRequestFor', () => {
  it('maps a pending node to the pending category with its parent type', () => {
    const {root, resolver} = rootWithChild();
    assert.deepStrictEqual(fallbackRequestFor(childOf(root), 'Card'), {
      category: 'pending',
      info: {componentId: 'c', parentComponentType: 'Card'},
    });
    resolver.dispose();
  });

  it('maps an unknown type to an error with the declared type', () => {
    const {root, resolver} = rootWithChild('StarRating');
    assert.deepStrictEqual(fallbackRequestFor(childOf(root), 'Card'), {
      category: 'error',
      info: {
        componentId: 'c',
        parentComponentType: 'Card',
        error: {type: 'unknown-type', componentType: 'StarRating'},
      },
    });
    resolver.dispose();
  });

  it('maps a cycle to an error, and leaves out an absent parent type', () => {
    const {root, resolver} = rootWithChild('Card');
    const cyclic = childOf(childOf(root));
    assert.strictEqual(cyclic.state, 'cyclic');
    assert.deepStrictEqual(fallbackRequestFor(cyclic), {
      category: 'error',
      info: {componentId: 'root', error: {type: 'cyclic'}},
    });
    resolver.dispose();
  });

  it('returns undefined for a resolved or disposed node', () => {
    const {root, resolver} = rootWithChild();
    const pending = childOf(root);
    assert.strictEqual(fallbackRequestFor(root), undefined);
    resolver.dispose();
    assert.strictEqual(fallbackRequestFor(pending, 'Card'), undefined);
  });

  it('builds the root request without a parent type', () => {
    assert.deepStrictEqual(rootPendingRequest('main'), {
      category: 'pending',
      info: {componentId: 'main'},
    });
  });
});

describe('buildFallback', () => {
  const pending = rootPendingRequest('root');
  const error = {
    category: 'error' as const,
    info: {componentId: 'x', error: {type: 'cyclic'}},
  };

  it('runs the builder of the request category with its info', () => {
    const fallbacks = {
      pending: (info: {componentId: string}) => `pending ${info.componentId}`,
      error: (info: {error: {type: string}}) => `error ${info.error.type}`,
    };
    assert.strictEqual(buildFallback(fallbacks, pending), 'pending root');
    assert.strictEqual(buildFallback(fallbacks, error), 'error cyclic');
  });

  it('returns undefined for missing fallbacks, a missing category, or a null result', () => {
    assert.strictEqual(buildFallback(undefined, pending), undefined);
    assert.strictEqual(buildFallback({error: () => 'e'}, pending), undefined);
    assert.strictEqual(buildFallback({pending: () => null}, pending), undefined);
  });

  it('logs a builder that throws and returns undefined', () => {
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const result = buildFallback(
        {
          pending: () => {
            throw new Error('boom');
          },
        },
        pending,
      );
      assert.strictEqual(result, undefined);
    } finally {
      console.error = originalError;
    }
    assert.strictEqual(logged.length, 1);
    assert.match(String(logged[0][0]), /pending fallback for 'root'/);
  });
});
