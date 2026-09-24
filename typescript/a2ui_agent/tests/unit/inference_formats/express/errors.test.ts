/*
 * Copyright 2026 Google LLC
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

import {describe, it, expect} from 'vitest';
import {A2uiError} from '../../../../src/errors.js';
import {
  ExpressCompilerError,
  ExpressParseError,
  ExpressValidationError,
  ExpressUnknownPropertyError,
  ExpressDuplicatePropertyError,
  ExpressInvalidParamError,
  ExpressDuplicateParamError,
  ExpressForbiddenDatabindingError,
  ExpressUndefinedRootError,
  ExpressUndefinedChildError,
} from '../../../../src/inference_formats/express/errors.js';

describe('Express error classes', () => {
  describe('ExpressCompilerError', () => {
    it('sets message, helpMessage, and inheritance correctly', () => {
      const err = new ExpressCompilerError('compiler error', 'hint');
      expect(err.message).toBe('compiler error');
      expect(err.helpMessage).toBe('hint');
      expect(err.name).toBe('ExpressCompilerError');
      expect(err.code).toBe('EXPRESS_COMPILER_ERROR');
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ExpressParseError', () => {
    it('sets inheritance and name correctly', () => {
      const err = new ExpressParseError('parse error', 'parse hint');
      expect(err.message).toBe('parse error');
      expect(err.helpMessage).toBe('parse hint');
      expect(err.name).toBe('ExpressParseError');
      expect(err).toBeInstanceOf(ExpressParseError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });
  });

  describe('ExpressValidationError', () => {
    it('sets inheritance and name correctly', () => {
      const err = new ExpressValidationError('validation error', 'validation hint');
      expect(err.message).toBe('validation error');
      expect(err.helpMessage).toBe('validation hint');
      expect(err.name).toBe('ExpressValidationError');
      expect(err).toBeInstanceOf(ExpressValidationError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });
  });

  describe('ExpressUnknownPropertyError', () => {
    it('formats message and sorted helpMessage when properties are provided', () => {
      const err = new ExpressUnknownPropertyError('Button', 'unknown', ['zeta', 'alpha', 'beta']);
      expect(err.message).toBe("Property 'unknown' is not a valid property of component 'Button'.");
      expect(err.helpMessage).toBe("Component 'Button' accepts properties: alpha, beta, zeta.");
      expect(err.compName).toBe('Button');
      expect(err.propName).toBe('unknown');
      expect(err.validProps).toEqual(['zeta', 'alpha', 'beta']);
      expect(err.name).toBe('ExpressUnknownPropertyError');
      expect(err).toBeInstanceOf(ExpressUnknownPropertyError);
      expect(err).toBeInstanceOf(ExpressValidationError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });

    it('formats helpMessage for empty validProps list', () => {
      const err = new ExpressUnknownPropertyError('Divider', 'unknown', []);
      expect(err.message).toBe(
        "Property 'unknown' is not a valid property of component 'Divider'.",
      );
      expect(err.helpMessage).toBe("Component 'Divider' has no configurable properties.");
    });
  });

  describe('ExpressDuplicatePropertyError', () => {
    it('formats message and helpMessage correctly', () => {
      const err = new ExpressDuplicatePropertyError('Card', 'title');
      expect(err.message).toBe("Property 'title' of component 'Card' was provided multiple times.");
      expect(err.helpMessage).toBe(
        "Remove duplicate specification of property 'title' for component 'Card'.",
      );
      expect(err.compName).toBe('Card');
      expect(err.propName).toBe('title');
      expect(err.name).toBe('ExpressDuplicatePropertyError');
      expect(err).toBeInstanceOf(ExpressDuplicatePropertyError);
      expect(err).toBeInstanceOf(ExpressValidationError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });
  });

  describe('ExpressInvalidParamError', () => {
    it('formats message and sorted helpMessage when parameters are provided', () => {
      const err = new ExpressInvalidParamError('submitForm', 'extra', ['url', 'method']);
      expect(err.message).toBe(
        "Argument 'extra' is not a valid parameter of function 'submitForm'.",
      );
      expect(err.helpMessage).toBe("Function 'submitForm' accepts parameters: method, url.");
      expect(err.fnName).toBe('submitForm');
      expect(err.paramName).toBe('extra');
      expect(err.validParams).toEqual(['url', 'method']);
      expect(err.name).toBe('ExpressInvalidParamError');
      expect(err).toBeInstanceOf(ExpressInvalidParamError);
      expect(err).toBeInstanceOf(ExpressValidationError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });

    it('formats helpMessage for empty validParams list', () => {
      const err = new ExpressInvalidParamError('now', 'extra', []);
      expect(err.message).toBe("Argument 'extra' is not a valid parameter of function 'now'.");
      expect(err.helpMessage).toBe("Function 'now' accepts no parameters.");
    });
  });

  describe('ExpressDuplicateParamError', () => {
    it('formats message and helpMessage correctly', () => {
      const err = new ExpressDuplicateParamError('doAction', 'target');
      expect(err.message).toBe(
        "Argument 'target' of function 'doAction' was provided multiple times.",
      );
      expect(err.helpMessage).toBe(
        "Remove duplicate specification of parameter 'target' for function 'doAction'.",
      );
      expect(err.fnName).toBe('doAction');
      expect(err.paramName).toBe('target');
      expect(err.name).toBe('ExpressDuplicateParamError');
      expect(err).toBeInstanceOf(ExpressDuplicateParamError);
      expect(err).toBeInstanceOf(ExpressValidationError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });
  });

  describe('ExpressForbiddenDatabindingError', () => {
    it('formats message and helpMessage correctly', () => {
      const err = new ExpressForbiddenDatabindingError('Input', 'id');
      expect(err.message).toBe(
        "Property 'id' of component 'Input' does not support dynamic data bindings (paths).",
      );
      expect(err.helpMessage).toBe(
        "Property 'id' on 'Input' must be a static literal value, not a dynamic databinding ($path).",
      );
      expect(err.compName).toBe('Input');
      expect(err.propName).toBe('id');
      expect(err.name).toBe('ExpressForbiddenDatabindingError');
      expect(err).toBeInstanceOf(ExpressForbiddenDatabindingError);
      expect(err).toBeInstanceOf(ExpressValidationError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });
  });

  describe('ExpressUndefinedRootError', () => {
    it('formats message and helpMessage correctly', () => {
      const err = new ExpressUndefinedRootError('rootView');
      expect(err.message).toBe("Root target 'rootView' is not defined.");
      expect(err.helpMessage).toBe(
        "Ensure root component 'rootView' is assigned in your Express DSL.",
      );
      expect(err.rootTarget).toBe('rootView');
      expect(err.name).toBe('ExpressUndefinedRootError');
      expect(err).toBeInstanceOf(ExpressUndefinedRootError);
      expect(err).toBeInstanceOf(ExpressParseError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });
  });

  describe('ExpressUndefinedChildError', () => {
    it('formats message and helpMessage correctly', () => {
      const err = new ExpressUndefinedChildError('childComp');
      expect(err.message).toBe("Child target 'childComp' is not defined.");
      expect(err.helpMessage).toBe(
        "Ensure component reference 'childComp' is defined in your Express DSL.",
      );
      expect(err.childId).toBe('childComp');
      expect(err.name).toBe('ExpressUndefinedChildError');
      expect(err).toBeInstanceOf(ExpressUndefinedChildError);
      expect(err).toBeInstanceOf(ExpressParseError);
      expect(err).toBeInstanceOf(ExpressCompilerError);
      expect(err).toBeInstanceOf(A2uiError);
    });
  });
});
