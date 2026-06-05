/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect} from 'vitest';
import {processExampleModules, getMessages} from '../../a2ui_explorer/src/examples';

describe('examples.ts (Sample Loading Logic)', () => {
  describe('processExampleModules', () => {
    it('should correctly parse and sort modules', () => {
      const mockModules = {
        '../../../../specification/v0_9/catalogs/minimal/examples/1_simple.json': {
          name: 'Simple',
        },
        '../../../../specification/v0_9/catalogs/basic/examples/01_card.json': {
          default: {name: 'Card'},
        },
        '../../../../specification/v0_9/catalogs/minimal/examples/2_row.json': {name: 'Row'},
      };

      const result = processExampleModules(mockModules);

      expect(result).toHaveLength(3);

      // Sorted by catalog (Basic first), then by key
      expect(result[0]!.catalog).toBe('Basic');
      expect(result[0]!.key).toBe('basic_01_card');
      expect(result[0]!.data).toEqual({name: 'Card'});

      expect(result[1]!.catalog).toBe('Minimal');
      expect(result[1]!.key).toBe('minimal_1_simple');
      expect(result[1]!.data).toEqual({name: 'Simple'});

      expect(result[2]!.catalog).toBe('Minimal');
      expect(result[2]!.key).toBe('minimal_2_row');
      expect(result[2]!.data).toEqual({name: 'Row'});
    });

    it('should handle modules with default export', () => {
      const mockModules = {
        'catalogs/basic/examples/01_test.json': {default: {foo: 'bar'}},
      };
      const result = processExampleModules(mockModules);
      expect(result[0]!.data).toEqual({foo: 'bar'});
    });

    it('should handle modules without default export', () => {
      const mockModules = {
        'catalogs/basic/examples/01_test.json': {foo: 'bar'},
      };
      const result = processExampleModules(mockModules);
      expect(result[0]!.data).toEqual({foo: 'bar'});
    });
  });

  describe('getMessages', () => {
    it('should return array if input is array', () => {
      const msgs = [{type: 'v0_9/a2ui/surface/create', surfaceId: 's1'}] as any;
      expect(getMessages(msgs)).toBe(msgs);
    });

    it('should return messages property if input has it', () => {
      const msgs = [{type: 'v0_9/a2ui/surface/create', surfaceId: 's1'}] as any;
      expect(getMessages({messages: msgs} as any)).toBe(msgs);
    });

    it('should return undefined for empty or invalid input', () => {
      expect(getMessages(undefined)).toBeUndefined();
      expect(getMessages({} as any)).toBeUndefined();
    });
  });
});
