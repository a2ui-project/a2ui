/*
 * Copyright 2025 Google LLC
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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {merge, appendToAll, createThemeStyles, toProp} from './utils.js';

describe('Styles Utils', () => {
  describe('merge', () => {
    it('merges multiple class objects', () => {
      const cls1 = {'text-red': true, 'bg-blue': true};
      const cls2 = {'text-green': true};
      const result = merge(cls1, cls2);

      // text-red should be removed because text-green shares prefix 'text-'
      assert.strictEqual(result['text-red'], undefined);
      assert.strictEqual(result['text-green'], true);
      assert.strictEqual(result['bg-blue'], true);
    });

    it('handles complex prefixes', () => {
      const result = merge({'border-t-2': true}, {'border-t-4': true});
      assert.strictEqual(result['border-t-2'], undefined);
      assert.strictEqual(result['border-t-4'], true);
    });
  });

  describe('appendToAll', () => {
    it('appends classes to target', () => {
      const target = {
        div: ['base-class'],
        span: ['other-class'],
      };

      const result = appendToAll(target, [], {'text-red': true});

      assert.deepStrictEqual(result['div'], ['base-class', 'text-red']);
      assert.deepStrictEqual(result['span'], ['other-class', 'text-red']);
    });

    it('replaces classes with same prefix', () => {
      const target = {
        div: ['text-blue'],
      };

      const result = appendToAll(target, [], {'text-red': true});

      assert.deepStrictEqual(result['div'], ['text-red']);
    });

    it('respects exclusions', () => {
      const target = {
        div: ['base'],
        excluded: ['base'],
      };

      const result = appendToAll(target, ['excluded'], {'new-class': true});

      assert.deepStrictEqual(result['div'], ['base', 'new-class']);
      assert.deepStrictEqual(result['excluded'], ['base']);
    });
  });

  describe('toProp', () => {
    it('converts nv- keys', () => {
      assert.strictEqual(toProp('nv10'), '--nv-10');
    });

    it('converts other keys', () => {
      // p20 -> --p-20
      assert.strictEqual(toProp('p20'), '--p-20');
    });
  });

  describe('createThemeStyles', () => {
    it('creates css variables from palette', () => {
      const palette = {
        primary: {
          nv10: 'red',
          p20: 'blue',
        },
      };

      const styles = createThemeStyles(palette as any);
      assert.strictEqual(styles['--nv-10'], 'red');
      assert.strictEqual(styles['--p-20'], 'blue');
    });
  });
});
