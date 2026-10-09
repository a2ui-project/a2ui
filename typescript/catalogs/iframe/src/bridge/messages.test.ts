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
  A2uiMessageType,
  IncomingWebFrameMessageSchema,
  WebAppFrameBasePropsSchema,
} from './messages.js';

describe('A2uiMessageType', () => {
  it('uses the a2ui_ prefixed wire names', () => {
    expect(A2uiMessageType).toEqual({
      Action: 'a2ui_action',
      DataModelChange: 'a2ui_data_model_change',
      DataModelUpdate: 'a2ui_data_model_update',
      FunctionCall: 'a2ui_function_call',
      FunctionResult: 'a2ui_function_result',
      SandboxProxyReady: 'a2ui_sandbox_proxy_ready',
      SandboxResourceReady: 'a2ui_sandbox_resource_ready',
      AppFrameReady: 'a2ui_app_frame_ready',
      AppFrameInit: 'a2ui_app_frame_init',
      SizeChanged: 'a2ui_size_changed',
      HostContextUpdate: 'a2ui_host_context_update',
    });
  });
});

describe('IncomingWebFrameMessageSchema', () => {
  describe('handshake messages', () => {
    it('accepts SandboxProxyReady and AppFrameReady', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_sandbox_proxy_ready'}).success,
      ).toBeTrue();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_app_frame_ready'}).success,
      ).toBeTrue();
    });
  });

  describe('Action message', () => {
    it('accepts an action without data', () => {
      const result = IncomingWebFrameMessageSchema.safeParse({
        type: 'a2ui_action',
        action: 'submitForm',
      });
      expect(result.success).toBeTrue();
      if (result.success && result.data.type === 'a2ui_action') {
        expect(result.data.action).toBe('submitForm');
        expect(result.data.data).toBeUndefined();
      }
    });

    it('accepts an action with structured data', () => {
      const result = IncomingWebFrameMessageSchema.safeParse({
        type: 'a2ui_action',
        action: 'calculateMetrics',
        data: {inputs: [10, 20, 30], operation: 'sum'},
      });
      expect(result.success).toBeTrue();
      if (result.success && result.data.type === 'a2ui_action') {
        expect(result.data.data).toEqual({inputs: [10, 20, 30], operation: 'sum'});
      }
    });

    it('rejects an action without a string action name', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_action', data: {}}).success,
      ).toBeFalse();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_action', action: 12345}).success,
      ).toBeFalse();
    });
  });

  describe('DataModelChange message', () => {
    it('accepts a change without subpath', () => {
      const result = IncomingWebFrameMessageSchema.safeParse({
        type: 'a2ui_data_model_change',
        key: 'userProfile',
        value: {name: 'Alice', score: 100},
      });
      expect(result.success).toBeTrue();
      if (result.success && result.data.type === 'a2ui_data_model_change') {
        expect(result.data.key).toBe('userProfile');
        expect(result.data.subpath).toBeUndefined();
        expect(result.data.value).toEqual({name: 'Alice', score: 100});
      }
    });

    it('accepts a change with subpath', () => {
      const result = IncomingWebFrameMessageSchema.safeParse({
        type: 'a2ui_data_model_change',
        key: 'userProfile',
        subpath: '/score',
        value: 150,
      });
      expect(result.success).toBeTrue();
      if (result.success && result.data.type === 'a2ui_data_model_change') {
        expect(result.data.subpath).toBe('/score');
        expect(result.data.value).toBe(150);
      }
    });

    it('accepts null, boolean and missing values', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({
          type: 'a2ui_data_model_change',
          key: 'k',
          value: null,
        }).success,
      ).toBeTrue();
      expect(
        IncomingWebFrameMessageSchema.safeParse({
          type: 'a2ui_data_model_change',
          key: 'k',
          value: false,
        }).success,
      ).toBeTrue();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_data_model_change', key: 'k'}).success,
      ).toBeTrue();
    });

    it('rejects a missing key or a non-string subpath', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_data_model_change', value: 'v'})
          .success,
      ).toBeFalse();
      expect(
        IncomingWebFrameMessageSchema.safeParse({
          type: 'a2ui_data_model_change',
          key: 'k',
          subpath: 42,
          value: 'v',
        }).success,
      ).toBeFalse();
    });
  });

  describe('FunctionCall message', () => {
    it('accepts string and numeric call ids, with or without args', () => {
      const withArgs = IncomingWebFrameMessageSchema.safeParse({
        type: 'a2ui_function_call',
        call: 'formatCurrency',
        callId: 'req-abc-123',
        args: {amount: 49.99, currency: 'USD'},
      });
      expect(withArgs.success).toBeTrue();
      if (withArgs.success && withArgs.data.type === 'a2ui_function_call') {
        expect(withArgs.data.callId).toBe('req-abc-123');
        expect(withArgs.data.args).toEqual({amount: 49.99, currency: 'USD'});
      }

      const numeric = IncomingWebFrameMessageSchema.safeParse({
        type: 'a2ui_function_call',
        call: 'getSystemTime',
        callId: 1001,
      });
      expect(numeric.success).toBeTrue();
      if (numeric.success && numeric.data.type === 'a2ui_function_call') {
        expect(numeric.data.callId).toBe(1001);
        expect(numeric.data.args).toBeUndefined();
      }
    });

    it('rejects a missing call, a missing call id or a call id of another type', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_function_call', callId: 'req-1'})
          .success,
      ).toBeFalse();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_function_call', call: 'f'}).success,
      ).toBeFalse();
      expect(
        IncomingWebFrameMessageSchema.safeParse({
          type: 'a2ui_function_call',
          call: 'f',
          callId: true,
        }).success,
      ).toBeFalse();
      expect(
        IncomingWebFrameMessageSchema.safeParse({
          type: 'a2ui_function_call',
          call: 'f',
          callId: {id: 1},
        }).success,
      ).toBeFalse();
    });
  });

  describe('SizeChanged message', () => {
    it('accepts both, one or no dimensions', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({
          type: 'a2ui_size_changed',
          width: 800,
          height: 600,
        }).success,
      ).toBeTrue();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_size_changed', height: 450}).success,
      ).toBeTrue();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_size_changed'}).success,
      ).toBeTrue();
    });

    it('rejects non-numeric dimensions', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_size_changed', height: '600px'})
          .success,
      ).toBeFalse();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_size_changed', width: '800px'})
          .success,
      ).toBeFalse();
    });
  });

  describe('unknown or invalid structures', () => {
    it('rejects unsupported types, missing discriminators and non-objects', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_unknown_custom_type'}).success,
      ).toBeFalse();
      expect(IncomingWebFrameMessageSchema.safeParse({}).success).toBeFalse();
      expect(IncomingWebFrameMessageSchema.safeParse(null).success).toBeFalse();
      expect(IncomingWebFrameMessageSchema.safeParse(undefined).success).toBeFalse();
      expect(IncomingWebFrameMessageSchema.safeParse('a2ui_action').success).toBeFalse();
      expect(IncomingWebFrameMessageSchema.safeParse(12345).success).toBeFalse();
      expect(IncomingWebFrameMessageSchema.safeParse(true).success).toBeFalse();
    });

    it('rejects host-to-app types arriving from the app', () => {
      expect(
        IncomingWebFrameMessageSchema.safeParse({
          type: 'a2ui_data_model_update',
          key: 'k',
          value: 1,
        }).success,
      ).toBeFalse();
      expect(
        IncomingWebFrameMessageSchema.safeParse({type: 'a2ui_app_frame_init', value: {}}).success,
      ).toBeFalse();
    });
  });
});

describe('WebAppFrameBasePropsSchema', () => {
  it('accepts an empty props object', () => {
    const result = WebAppFrameBasePropsSchema.safeParse({});
    expect(result.success).toBeTrue();
    if (result.success) {
      expect(result.data.config).toBeUndefined();
      expect(result.data.data).toBeUndefined();
      expect(result.data.allowedEvents).toBeUndefined();
      expect(result.data.allowedFunctions).toBeUndefined();
      expect(result.data.mutableData).toBeUndefined();
      expect(result.data.disableSchemaValidation).toBeUndefined();
    }
  });

  it('accepts fully populated props', () => {
    const result = WebAppFrameBasePropsSchema.safeParse({
      config: {theme: 'dark', apiKey: 'token_xyz'},
      data: {paths: {count: '/data/counter'}},
      allowedEvents: {onSubmit: {type: 'object'}},
      allowedFunctions: {formatCurrency: {type: 'object'}},
      mutableData: {count: {type: 'number'}},
      disableSchemaValidation: true,
    });
    expect(result.success).toBeTrue();
    if (result.success) {
      expect(result.data.config).toEqual({theme: 'dark', apiKey: 'token_xyz'});
      expect(result.data.data).toEqual({paths: {count: '/data/counter'}});
      expect(result.data.disableSchemaValidation).toBeTrue();
      expect(result.data.mutableData).toEqual({count: {type: 'number'}});
    }
  });

  it('rejects properties of the wrong type', () => {
    expect(
      WebAppFrameBasePropsSchema.safeParse({disableSchemaValidation: 'true'}).success,
    ).toBeFalse();
    expect(WebAppFrameBasePropsSchema.safeParse({config: 'not an object'}).success).toBeFalse();
    expect(WebAppFrameBasePropsSchema.safeParse({allowedEvents: 1234}).success).toBeFalse();
    expect(WebAppFrameBasePropsSchema.safeParse({allowedFunctions: false}).success).toBeFalse();
    expect(WebAppFrameBasePropsSchema.safeParse({mutableData: 'none'}).success).toBeFalse();
    expect(WebAppFrameBasePropsSchema.safeParse({data: {paths: {count: 7}}}).success).toBeFalse();
    expect(WebAppFrameBasePropsSchema.safeParse({data: {}}).success).toBeFalse();
  });
});
