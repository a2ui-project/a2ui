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

import {
  FORBIDDEN_PROTOTYPE_KEYS,
  MAX_PAYLOAD_NESTING_DEPTH,
  MAX_PAYLOAD_SIZE_BYTES,
  validateMessageSecurity,
} from './security.js';

describe('validateMessageSecurity', () => {
  describe('null, undefined and primitive values', () => {
    it('allows null and undefined inputs', () => {
      expect(validateMessageSecurity(null)).toEqual({valid: true});
      expect(validateMessageSecurity(undefined)).toEqual({valid: true});
    });

    it('allows safe primitives', () => {
      expect(validateMessageSecurity('hello world')).toEqual({valid: true});
      expect(validateMessageSecurity(42)).toEqual({valid: true});
      expect(validateMessageSecurity(true)).toEqual({valid: true});
      expect(validateMessageSecurity(false)).toEqual({valid: true});
    });
  });

  describe('safe objects and arrays', () => {
    it('allows shallow valid objects', () => {
      const payload = {
        type: 'a2ui_action',
        action: 'click',
        data: {value: 123, label: 'test'},
      };
      expect(validateMessageSecurity(payload)).toEqual({valid: true});
    });

    it('allows empty objects and empty arrays', () => {
      expect(validateMessageSecurity({})).toEqual({valid: true});
      expect(validateMessageSecurity([])).toEqual({valid: true});
    });

    it('allows nested arrays and mixed object structures within the safe depth', () => {
      const payload = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
        nested: {
          level1: {
            level2: {
              level3: 'deep enough but safe',
            },
          },
        },
      };
      expect(validateMessageSecurity(payload)).toEqual({valid: true});
    });
  });

  describe('prototype pollution defense', () => {
    it('lists the three forbidden keys', () => {
      expect([...FORBIDDEN_PROTOTYPE_KEYS]).toEqual(['__proto__', 'constructor', 'prototype']);
    });

    it('rejects an object with an own "__proto__" property', () => {
      const payload = JSON.parse('{"__proto__": {"admin": true}}');
      const result = validateMessageSecurity(payload);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain(
        'Detected forbidden prototype pollution property key: "__proto__"',
      );
    });

    it('rejects an object with a "constructor" property', () => {
      const payload = {
        type: 'a2ui_action',
        constructor: {name: 'polluted'},
      };
      const result = validateMessageSecurity(payload);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain(
        'Detected forbidden prototype pollution property key: "constructor"',
      );
    });

    it('rejects an object with a "prototype" property', () => {
      const payload = {
        type: 'a2ui_action',
        prototype: {isAdmin: true},
      };
      const result = validateMessageSecurity(payload);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain(
        'Detected forbidden prototype pollution property key: "prototype"',
      );
    });

    it('rejects prototype pollution keys in deeply nested objects', () => {
      const payload = {
        data: {
          user: {
            settings: {
              constructor: 'evil',
            },
          },
        },
      };
      const result = validateMessageSecurity(payload);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain(
        'Detected forbidden prototype pollution property key: "constructor"',
      );
    });

    it('rejects prototype pollution keys nested inside arrays', () => {
      const payload = {
        items: [
          {id: 1, name: 'item1'},
          {id: 2, prototype: {polluted: true}},
        ],
      };
      const result = validateMessageSecurity(payload);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain(
        'Detected forbidden prototype pollution property key: "prototype"',
      );
    });
  });

  describe('nesting depth enforcement', () => {
    function nestObjects(levels: number): unknown {
      let value: unknown = 'leaf value';
      for (let i = 0; i < levels; i++) {
        value = {nest: value};
      }
      return value;
    }

    it('allows objects nested up to exactly the maximum depth', () => {
      expect(MAX_PAYLOAD_NESTING_DEPTH).toBe(10);
      const result = validateMessageSecurity(nestObjects(MAX_PAYLOAD_NESTING_DEPTH));
      expect(result.valid).toBeTrue();
    });

    it('rejects objects nested one level past the maximum depth', () => {
      const result = validateMessageSecurity(nestObjects(MAX_PAYLOAD_NESTING_DEPTH + 1));
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain('Exceeded maximum allowed nesting depth of 10 levels');
    });

    it('rejects arrays nested past the maximum depth', () => {
      let tooDeepArray: unknown = 'leaf value';
      for (let i = 0; i < MAX_PAYLOAD_NESTING_DEPTH + 1; i++) {
        tooDeepArray = [tooDeepArray];
      }
      const result = validateMessageSecurity(tooDeepArray);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain('Exceeded maximum allowed nesting depth of 10 levels');
    });

    it('rejects alternating object and array structures exceeding the maximum depth', () => {
      let tooDeepMixed: unknown = 'leaf value';
      // Six iterations of array plus object give twelve levels of depth.
      for (let i = 0; i < 6; i++) {
        tooDeepMixed = [{nest: tooDeepMixed}];
      }
      const result = validateMessageSecurity(tooDeepMixed);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain('Exceeded maximum allowed nesting depth of 10 levels');
    });
  });

  describe('payload size enforcement', () => {
    const prefix = '{"type":"a2ui_action","data":"';
    const suffix = '"}';

    it('allows payloads under 64 KB', () => {
      const payload = {
        type: 'a2ui_action',
        data: 'x'.repeat(1000),
      };
      expect(validateMessageSecurity(payload)).toEqual({valid: true});
    });

    it('allows payloads of exactly 64 KB (65,536 bytes)', () => {
      const paddingNeeded = MAX_PAYLOAD_SIZE_BYTES - prefix.length - suffix.length;
      const exactPayload = {
        type: 'a2ui_action',
        data: 'A'.repeat(paddingNeeded),
      };
      expect(JSON.stringify(exactPayload).length).toBe(MAX_PAYLOAD_SIZE_BYTES);
      expect(validateMessageSecurity(exactPayload)).toEqual({valid: true});
    });

    it('rejects payloads exceeding 64 KB (65,536 bytes)', () => {
      const paddingNeeded = MAX_PAYLOAD_SIZE_BYTES + 1 - prefix.length - suffix.length;
      const oversizedPayload = {
        type: 'a2ui_action',
        data: 'A'.repeat(paddingNeeded),
      };
      expect(JSON.stringify(oversizedPayload).length).toBe(MAX_PAYLOAD_SIZE_BYTES + 1);

      const result = validateMessageSecurity(oversizedPayload);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain(
        'Message payload exceeds maximum allowed size of 65536 bytes (65537 bytes)',
      );
    });
  });

  describe('serialization failure handling', () => {
    it('rejects non-serializable payloads containing BigInt values', () => {
      const payload = {
        type: 'a2ui_action',
        value: BigInt(9007199254740991),
      };
      const result = validateMessageSecurity(payload);
      expect(result.valid).toBeFalse();
      expect(result.reason).toBe('Failed to serialize message payload for size inspection');
    });

    it('rejects circular references through the nesting depth limit', () => {
      const circular: {type: string; self?: unknown} = {type: 'a2ui_action'};
      circular.self = circular;
      const result = validateMessageSecurity(circular);
      expect(result.valid).toBeFalse();
      expect(result.reason).toContain('Exceeded maximum allowed nesting depth of 10 levels');
    });
  });
});
