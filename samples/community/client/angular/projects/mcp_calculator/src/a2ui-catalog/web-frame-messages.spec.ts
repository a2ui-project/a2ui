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

import {describe, it, expect} from 'vitest';
import {
  IncomingWebFrameMessageSchema,
  MAX_PAYLOAD_SIZE_BYTES,
  validateMessageSecurity,
  WebAppFrameBasePropsSchema,
} from './web-frame-messages';

describe('web-frame-messages', () => {
  describe('IncomingWebFrameMessageSchema', () => {
    describe('SandboxProxyReady message', () => {
      it('validates a correct SandboxProxyReady message', () => {
        const payload = {type: 'a2ui_sandbox_proxy_ready'};
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.type).toBe('a2ui_sandbox_proxy_ready');
        }
      });
    });

    describe('AppFrameReady message', () => {
      it('validates a correct AppFrameReady message', () => {
        const payload = {type: 'a2ui_app_frame_ready'};
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.type).toBe('a2ui_app_frame_ready');
        }
      });
    });

    describe('Action message', () => {
      it('validates an Action message without optional data', () => {
        const payload = {
          type: 'a2ui_action',
          action: 'submitForm',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_action') {
          expect(result.data.action).toBe('submitForm');
          expect(result.data.data).toBeUndefined();
        }
      });

      it('validates an Action message with structured data payload', () => {
        const payload = {
          type: 'a2ui_action',
          action: 'calculateMetrics',
          data: {
            inputs: [10, 20, 30],
            operation: 'sum',
          },
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_action') {
          expect(result.data.action).toBe('calculateMetrics');
          expect(result.data.data).toEqual({
            inputs: [10, 20, 30],
            operation: 'sum',
          });
        }
      });

      it('rejects an Action message missing the required action field', () => {
        const payload = {
          type: 'a2ui_action',
          data: {foo: 'bar'},
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });

      it('rejects an Action message with non-string action field', () => {
        const payload = {
          type: 'a2ui_action',
          action: 12345,
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });
    });

    describe('DataModelChange message', () => {
      it('validates a DataModelChange message without optional subpath', () => {
        const payload = {
          type: 'a2ui_data_model_change',
          key: 'userProfile',
          value: {name: 'Alice', score: 100},
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_data_model_change') {
          expect(result.data.key).toBe('userProfile');
          expect(result.data.subpath).toBeUndefined();
          expect(result.data.value).toEqual({name: 'Alice', score: 100});
        }
      });

      it('validates a DataModelChange message with subpath', () => {
        const payload = {
          type: 'a2ui_data_model_change',
          key: 'userProfile',
          subpath: '/score',
          value: 150,
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_data_model_change') {
          expect(result.data.key).toBe('userProfile');
          expect(result.data.subpath).toBe('/score');
          expect(result.data.value).toBe(150);
        }
      });

      it('validates a DataModelChange message with null or boolean values', () => {
        const nullPayload = {
          type: 'a2ui_data_model_change',
          key: 'selectedItem',
          value: null,
        };
        expect(IncomingWebFrameMessageSchema.safeParse(nullPayload).success).toBe(true);

        const boolPayload = {
          type: 'a2ui_data_model_change',
          key: 'isEnabled',
          value: false,
        };
        expect(IncomingWebFrameMessageSchema.safeParse(boolPayload).success).toBe(true);
      });

      it('rejects a DataModelChange message missing the key field', () => {
        const payload = {
          type: 'a2ui_data_model_change',
          value: 'updatedVal',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });

      it('validates a DataModelChange message with undefined value', () => {
        const payload = {
          type: 'a2ui_data_model_change',
          key: 'someKey',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_data_model_change') {
          expect(result.data.value).toBeUndefined();
        }
      });

      it('rejects a DataModelChange message with non-string subpath', () => {
        const payload = {
          type: 'a2ui_data_model_change',
          key: 'someKey',
          subpath: 42,
          value: 'val',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });
    });

    describe('FunctionCall message', () => {
      it('validates a FunctionCall message with string callId and args', () => {
        const payload = {
          type: 'a2ui_function_call',
          call: 'formatCurrency',
          callId: 'req-abc-123',
          args: {amount: 49.99, currency: 'USD'},
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_function_call') {
          expect(result.data.call).toBe('formatCurrency');
          expect(result.data.callId).toBe('req-abc-123');
          expect(result.data.args).toEqual({amount: 49.99, currency: 'USD'});
        }
      });

      it('validates a FunctionCall message with numeric callId and omitted args', () => {
        const payload = {
          type: 'a2ui_function_call',
          call: 'getSystemTime',
          callId: 1001,
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_function_call') {
          expect(result.data.call).toBe('getSystemTime');
          expect(result.data.callId).toBe(1001);
          expect(result.data.args).toBeUndefined();
        }
      });

      it('rejects a FunctionCall message missing the call field', () => {
        const payload = {
          type: 'a2ui_function_call',
          callId: 'req-1',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });

      it('rejects a FunctionCall message missing the callId field', () => {
        const payload = {
          type: 'a2ui_function_call',
          call: 'formatCurrency',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });

      it('rejects a FunctionCall message with invalid callId type (boolean/object)', () => {
        const boolCallIdPayload = {
          type: 'a2ui_function_call',
          call: 'formatCurrency',
          callId: true,
        };
        expect(IncomingWebFrameMessageSchema.safeParse(boolCallIdPayload).success).toBe(false);

        const objCallIdPayload = {
          type: 'a2ui_function_call',
          call: 'formatCurrency',
          callId: {id: 1},
        };
        expect(IncomingWebFrameMessageSchema.safeParse(objCallIdPayload).success).toBe(false);
      });
    });

    describe('SizeChanged message', () => {
      it('validates a SizeChanged message with width and height', () => {
        const payload = {
          type: 'a2ui_size_changed',
          width: 800,
          height: 600,
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success && result.data.type === 'a2ui_size_changed') {
          expect(result.data.width).toBe(800);
          expect(result.data.height).toBe(600);
        }
      });

      it('validates a SizeChanged message with only height or only width', () => {
        const heightOnly = {
          type: 'a2ui_size_changed',
          height: 450,
        };
        const heightResult = IncomingWebFrameMessageSchema.safeParse(heightOnly);
        expect(heightResult.success).toBe(true);
        if (heightResult.success && heightResult.data.type === 'a2ui_size_changed') {
          expect(heightResult.data.height).toBe(450);
          expect(heightResult.data.width).toBeUndefined();
        }

        const widthOnly = {
          type: 'a2ui_size_changed',
          width: 720,
        };
        const widthResult = IncomingWebFrameMessageSchema.safeParse(widthOnly);
        expect(widthResult.success).toBe(true);
        if (widthResult.success && widthResult.data.type === 'a2ui_size_changed') {
          expect(widthResult.data.width).toBe(720);
          expect(widthResult.data.height).toBeUndefined();
        }
      });

      it('validates a SizeChanged message with no dimension fields', () => {
        const payload = {
          type: 'a2ui_size_changed',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(true);
      });

      it('rejects a SizeChanged message with non-numeric dimensions', () => {
        const stringHeightPayload = {
          type: 'a2ui_size_changed',
          height: '600px',
        };
        expect(IncomingWebFrameMessageSchema.safeParse(stringHeightPayload).success).toBe(false);

        const stringWidthPayload = {
          type: 'a2ui_size_changed',
          width: '800px',
        };
        expect(IncomingWebFrameMessageSchema.safeParse(stringWidthPayload).success).toBe(false);
      });
    });

    describe('Unknown / Invalid message structures', () => {
      it('rejects an unsupported message type', () => {
        const payload = {
          type: 'a2ui_unknown_custom_type',
        };
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });

      it('rejects an empty object missing the type discriminator', () => {
        const payload = {};
        const result = IncomingWebFrameMessageSchema.safeParse(payload);
        expect(result.success).toBe(false);
      });

      it('rejects non-object primitives and null/undefined values', () => {
        expect(IncomingWebFrameMessageSchema.safeParse(null).success).toBe(false);
        expect(IncomingWebFrameMessageSchema.safeParse(undefined).success).toBe(false);
        expect(IncomingWebFrameMessageSchema.safeParse('a2ui_action').success).toBe(false);
        expect(IncomingWebFrameMessageSchema.safeParse(12345).success).toBe(false);
        expect(IncomingWebFrameMessageSchema.safeParse(true).success).toBe(false);
      });
    });
  });

  describe('WebAppFrameBasePropsSchema', () => {
    it('validates an empty props object', () => {
      const result = WebAppFrameBasePropsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config).toBeUndefined();
        expect(result.data.data).toBeUndefined();
        expect(result.data.allowedEvents).toBeUndefined();
        expect(result.data.allowedFunctions).toBeUndefined();
        expect(result.data.mutableData).toBeUndefined();
        expect(result.data.disableSchemaValidation).toBeUndefined();
      }
    });

    it('validates a complete and fully populated props object', () => {
      const props = {
        config: {theme: 'dark', apiKey: 'token_xyz'},
        data: {paths: {count: '/data/counter'}},
        allowedEvents: {
          onSubmit: {type: 'object'},
        },
        allowedFunctions: {
          formatCurrency: {type: 'object'},
        },
        mutableData: {
          count: {type: 'number'},
        },
        disableSchemaValidation: true,
      };
      const result = WebAppFrameBasePropsSchema.safeParse(props);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config).toEqual({theme: 'dark', apiKey: 'token_xyz'});
        expect(result.data.disableSchemaValidation).toBe(true);
        expect(result.data.mutableData).toEqual({count: {type: 'number'}});
      }
    });

    it('rejects invalid property types', () => {
      expect(
        WebAppFrameBasePropsSchema.safeParse({
          disableSchemaValidation: 'true', // string instead of boolean
        }).success,
      ).toBe(false);

      expect(
        WebAppFrameBasePropsSchema.safeParse({
          config: 'not an object',
        }).success,
      ).toBe(false);

      expect(
        WebAppFrameBasePropsSchema.safeParse({
          allowedEvents: 1234,
        }).success,
      ).toBe(false);

      expect(
        WebAppFrameBasePropsSchema.safeParse({
          allowedFunctions: false,
        }).success,
      ).toBe(false);

      expect(
        WebAppFrameBasePropsSchema.safeParse({
          mutableData: 'none',
        }).success,
      ).toBe(false);
    });
  });

  describe('validateMessageSecurity', () => {
    describe('Null, undefined, and primitive values', () => {
      it('allows null and undefined inputs', () => {
        expect(validateMessageSecurity(null)).toEqual({valid: true});
        expect(validateMessageSecurity(undefined)).toEqual({valid: true});
      });

      it('allows safe primitives (strings, numbers, booleans)', () => {
        expect(validateMessageSecurity('hello world')).toEqual({valid: true});
        expect(validateMessageSecurity(42)).toEqual({valid: true});
        expect(validateMessageSecurity(true)).toEqual({valid: true});
        expect(validateMessageSecurity(false)).toEqual({valid: true});
      });
    });

    describe('Safe objects and arrays', () => {
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

      it('allows nested arrays and mixed object structures within safe depth', () => {
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

    describe('Prototype pollution defense', () => {
      it('rejects an object with an own "__proto__" property', () => {
        const payload = JSON.parse('{"__proto__": {"admin": true}}');
        const result = validateMessageSecurity(payload);
        expect(result.valid).toBe(false);
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
        expect(result.valid).toBe(false);
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
        expect(result.valid).toBe(false);
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
        expect(result.valid).toBe(false);
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
        expect(result.valid).toBe(false);
        expect(result.reason).toContain(
          'Detected forbidden prototype pollution property key: "prototype"',
        );
      });
    });

    describe('Nesting depth enforcement', () => {
      it('allows objects nested up to exactly 10 levels deep', () => {
        let deepObj: any = 'leaf value';
        for (let i = 0; i < 10; i++) {
          deepObj = {nest: deepObj};
        }
        const result = validateMessageSecurity(deepObj);
        expect(result.valid).toBe(true);
      });

      it('rejects objects nested 11 levels deep', () => {
        let tooDeepObj: any = 'leaf value';
        for (let i = 0; i < 11; i++) {
          tooDeepObj = {nest: tooDeepObj};
        }
        const result = validateMessageSecurity(tooDeepObj);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Exceeded maximum allowed nesting depth of 10 levels');
      });

      it('rejects arrays nested 11 levels deep', () => {
        let tooDeepArray: any = 'leaf value';
        for (let i = 0; i < 11; i++) {
          tooDeepArray = [tooDeepArray];
        }
        const result = validateMessageSecurity(tooDeepArray);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Exceeded maximum allowed nesting depth of 10 levels');
      });

      it('rejects alternating object and array structures exceeding 10 levels', () => {
        let tooDeepMixed: any = 'leaf value';
        for (let i = 0; i < 6; i++) {
          tooDeepMixed = [{nest: tooDeepMixed}];
        }
        // 6 iterations of array + object = 12 levels of depth
        const result = validateMessageSecurity(tooDeepMixed);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Exceeded maximum allowed nesting depth of 10 levels');
      });
    });

    describe('Payload size enforcement', () => {
      it('allows payloads under 64 KB', () => {
        const payload = {
          type: 'a2ui_action',
          data: 'x'.repeat(1000), // ~1 KB
        };
        expect(validateMessageSecurity(payload)).toEqual({valid: true});
      });

      it('allows payloads of exactly 64 KB (65,536 bytes)', () => {
        const prefix = '{"type":"a2ui_action","data":"';
        const suffix = '"}';
        const targetLen = MAX_PAYLOAD_SIZE_BYTES;
        const paddingNeeded = targetLen - prefix.length - suffix.length;
        const exactPayload = {
          type: 'a2ui_action',
          data: 'A'.repeat(paddingNeeded),
        };
        expect(JSON.stringify(exactPayload).length).toBe(MAX_PAYLOAD_SIZE_BYTES);
        expect(validateMessageSecurity(exactPayload)).toEqual({valid: true});
      });

      it('rejects payloads exceeding 64 KB (65,536 bytes)', () => {
        const prefix = '{"type":"a2ui_action","data":"';
        const suffix = '"}';
        const targetLen = MAX_PAYLOAD_SIZE_BYTES + 1;
        const paddingNeeded = targetLen - prefix.length - suffix.length;
        const oversizedPayload = {
          type: 'a2ui_action',
          data: 'A'.repeat(paddingNeeded),
        };
        expect(JSON.stringify(oversizedPayload).length).toBe(MAX_PAYLOAD_SIZE_BYTES + 1);

        const result = validateMessageSecurity(oversizedPayload);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain(
          'Message payload exceeds maximum allowed size of 65536 bytes (65537 bytes)',
        );
      });
    });

    describe('Serialization failure handling', () => {
      it('rejects non-serializable payloads containing BigInt values', () => {
        const payload = {
          type: 'a2ui_action',
          value: BigInt(9007199254740991),
        };
        const result = validateMessageSecurity(payload);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Failed to serialize message payload for size inspection');
      });

      it('rejects circular references via nesting depth limit or serialization protection', () => {
        const circularObj: any = {type: 'a2ui_action'};
        circularObj.self = circularObj;
        const result = validateMessageSecurity(circularObj);
        expect(result.valid).toBe(false);
      });
    });
  });
});
