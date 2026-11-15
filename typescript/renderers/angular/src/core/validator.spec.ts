/*
 * Copyright 2026 Google LLC
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

import {TestBed} from '@angular/core/testing';
import {
  A2uiConfigurationError,
  NO_VALIDATOR_MESSAGE,
  type JsonSchemaValidator,
} from '@a2ui/web_core';
import {A2uiRendererService, provideA2Ui} from './a2ui-renderer.service';
import {A2UI_JSON_SCHEMA_VALIDATOR, injectA2uiValidator, provideA2uiValidator} from './validator';
import {BASIC_CATALOG_OPTIONS, BasicCatalog} from '../basic-catalog';
import {BasicCatalog as V09BasicCatalog} from '../v0_9/catalog/basic/basic-catalog';
import {MessageProcessor as V08MessageProcessor} from '../v0_8/data/processor';
import {provideA2UI as provideV08A2UI} from '../v0_8/config';
import {validator} from '../test_validator';

/** Whether `error` is web_core's missing-validator error. */
function isNoValidatorError(error: unknown): boolean {
  return (
    error instanceof A2uiConfigurationError &&
    error.message.startsWith(NO_VALIDATOR_MESSAGE) &&
    error.message.includes('provideA2uiValidator')
  );
}

/** A validator that records the schemas it compiles. */
function spyValidator(): JsonSchemaValidator & {compiled: number} {
  const spy = {
    compiled: 0,
    compile(schema: Parameters<JsonSchemaValidator['compile']>[0], opts?: {defs?: object}) {
      spy.compiled++;
      return validator.compile(schema, opts as Parameters<JsonSchemaValidator['compile']>[1]);
    },
  };
  return spy as JsonSchemaValidator & {compiled: number};
}

describe('A2UI_JSON_SCHEMA_VALIDATOR', () => {
  it('is provided by provideA2uiValidator', () => {
    TestBed.configureTestingModule({providers: [provideA2uiValidator(validator)]});
    expect(TestBed.inject(A2UI_JSON_SCHEMA_VALIDATOR)).toBe(validator);
    expect(TestBed.runInInjectionContext(() => injectA2uiValidator())).toBe(validator);
  });

  it('has no default: injectA2uiValidator throws without one', () => {
    TestBed.configureTestingModule({});
    expect(() => TestBed.runInInjectionContext(() => injectA2uiValidator())).toThrowMatching(
      isNoValidatorError,
    );
  });

  describe('A2uiRendererService', () => {
    it('fails at construction without a validator', () => {
      TestBed.configureTestingModule({providers: [provideA2Ui({catalogs: []})]});
      expect(() => TestBed.inject(A2uiRendererService)).toThrowMatching(isNoValidatorError);
    });

    it('validates messages with the provided validator', () => {
      const spy = spyValidator();
      TestBed.configureTestingModule({
        providers: [provideA2uiValidator(spy), provideA2Ui({catalogs: []})],
      });
      const service = TestBed.inject(A2uiRendererService);
      expect(() =>
        service.processMessages([{version: 'v0.9', createSurface: {catalogId: 'x'}}]),
      ).toThrowError(/surfaceId/);
      expect(spy.compiled).toBeGreaterThan(0);
    });
  });

  describe('BasicCatalog', () => {
    it('fails without a validator (v1.0 and v0.9)', () => {
      TestBed.configureTestingModule({});
      expect(() => TestBed.inject(BasicCatalog)).toThrowMatching(isNoValidatorError);
      expect(() => TestBed.inject(V09BasicCatalog)).toThrowMatching(isNoValidatorError);
    });

    it('uses the provided validator, or the one BASIC_CATALOG_OPTIONS sets', () => {
      TestBed.configureTestingModule({providers: [provideA2uiValidator(validator)]});
      expect(TestBed.inject(BasicCatalog).components.size).toBe(18);
      expect(TestBed.inject(V09BasicCatalog).components.size).toBe(18);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{provide: BASIC_CATALOG_OPTIONS, useValue: {validator}}],
      });
      expect(TestBed.inject(BasicCatalog).components.size).toBe(18);
    });
  });

  describe('v0.8 MessageProcessor', () => {
    it('fails at construction without a validator', () => {
      TestBed.configureTestingModule({});
      expect(() => TestBed.inject(V08MessageProcessor)).toThrowMatching(
        (error: unknown) =>
          error instanceof A2uiConfigurationError && error.message.startsWith(NO_VALIDATOR_MESSAGE),
      );
    });

    it('takes the validator from provideA2UI and validates messages with it', () => {
      const spy = spyValidator();
      TestBed.configureTestingModule({
        providers: [provideV08A2UI({catalog: {}, theme: {} as never, validator: spy})],
      });
      const processor = TestBed.inject(V08MessageProcessor);
      expect(TestBed.inject(A2UI_JSON_SCHEMA_VALIDATOR)).toBe(spy);
      expect(() => processor.processMessages([{beginRendering: {root: 'r'}} as never])).toThrow();
      expect(spy.compiled).toBeGreaterThan(0);
    });
  });
});
