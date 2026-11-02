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
import {describe, it} from 'node:test';

import {z} from 'zod';

import {getSpecAnnotation, spec, specDef} from './spec_annotations.js';

describe('spec_annotations', () => {
  it('annotates schemas with spec() without mutating the source schema', () => {
    const base = z.object({a: z.string()}).describe('base description');
    const annotated = spec(base, {closure: 'additionalProperties'});

    assert.notStrictEqual(annotated, base);
    assert.strictEqual(getSpecAnnotation(base), undefined);
    assert.deepStrictEqual(getSpecAnnotation(annotated), {
      closure: 'additionalProperties',
    });
    assert.strictEqual(annotated.description, 'base description');
  });

  it('preserves defName across chained describe() and spec() calls on specDef()', () => {
    const base = z.object({a: z.string()});
    const defined = specDef('MyComponent', base);
    const described = defined.describe('first description');
    const redescribed = described.describe('second description');
    const refinedSpec = spec(redescribed, {closure: 'none'});

    assert.strictEqual(getSpecAnnotation(base), undefined);
    assert.strictEqual(getSpecAnnotation(defined)?.defName, 'MyComponent');
    assert.strictEqual(getSpecAnnotation(described)?.defName, 'MyComponent');
    assert.strictEqual(described.description, 'first description');
    assert.strictEqual(getSpecAnnotation(redescribed)?.defName, 'MyComponent');
    assert.strictEqual(redescribed.description, 'second description');
    assert.strictEqual(getSpecAnnotation(refinedSpec)?.defName, 'MyComponent');
    assert.strictEqual(getSpecAnnotation(refinedSpec)?.closure, 'none');
  });

  it('supports Zod 4 schemas where z.ZodType.prototype.describe is undefined', () => {
    const originalPrototypeDescribe = Object.getOwnPropertyDescriptor(
      z.ZodType.prototype,
      'describe',
    );

    // Attach an instance-level describe method before removing prototype.describe,
    // matching Zod 4 where describe lives on schema instances rather than ZodType.prototype.
    function attachInstanceDescribe<T extends z.ZodTypeAny>(source: T): T {
      source.describe = (nextDescription: string) => {
        const cloned = Object.create(Object.getPrototypeOf(source)) as T;
        Object.defineProperty(cloned, 'description', {
          value: nextDescription,
          configurable: true,
        });
        return attachInstanceDescribe(cloned);
      };
      return source;
    }

    const base = attachInstanceDescribe(z.object({a: z.string()}));

    try {
      Object.defineProperty(z.ZodType.prototype, 'describe', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      assert.strictEqual(z.ZodType.prototype.describe, undefined);

      const annotated = spec(base, {closure: 'none'});
      assert.strictEqual(getSpecAnnotation(annotated)?.closure, 'none');

      const defined = specDef('Zod4Model', base);
      assert.strictEqual(getSpecAnnotation(defined)?.defName, 'Zod4Model');

      const described = defined.describe('updated under zod 4');
      assert.strictEqual(described.description, 'updated under zod 4');
      assert.strictEqual(getSpecAnnotation(described)?.defName, 'Zod4Model');

      const reAnnotated = spec(described, {closure: 'additionalProperties'});
      assert.strictEqual(getSpecAnnotation(reAnnotated)?.defName, 'Zod4Model');
      assert.strictEqual(getSpecAnnotation(reAnnotated)?.closure, 'additionalProperties');
    } finally {
      if (originalPrototypeDescribe) {
        Object.defineProperty(z.ZodType.prototype, 'describe', originalPrototypeDescribe);
      }
    }
  });
});
