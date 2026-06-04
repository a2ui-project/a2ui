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

import {DataContext, SurfaceModel} from '@a2ui/web_core/v0_9';
import {DestroyRef} from '@angular/core';
import {BasicCatalogBase} from '../catalog/basic/basic-catalog';
import {toAngularSignal} from './utils';

describe('Function Bindings', () => {
  let mockDestroyRef: jasmine.SpyObj<DestroyRef>;

  beforeEach(() => {
    mockDestroyRef = jasmine.createSpyObj('DestroyRef', ['onDestroy']);
    mockDestroyRef.onDestroy.and.returnValue(() => {});
  });

  describe('add', () => {
    it('should update output correctly when bound input updates using function call binding', () => {
      const catalog = new BasicCatalogBase();

      // Create Surface Model and DataContext
      const surface = new SurfaceModel('surface_1', catalog);
      const dataModel = surface.dataModel;
      const context = new DataContext(surface, '/');

      const callValue = {
        call: 'add',
        args: {
          a: {
            path: '/inputValue',
          },
          b: 1,
        },
        returnType: 'number',
      };

      // 1. Resolve Signal
      const resSig = context.resolveSignal<number>(callValue as any);

      // 2. Convert to Angular Signal
      const angSig = toAngularSignal(resSig, mockDestroyRef);

      // 3. Initial state
      expect(isNaN(angSig())).toBe(true);

      // 4. Update data model Simulation typing
      dataModel.set('/inputValue', 5);

      // 5. Verify reactive updates
      expect(angSig()).toBe(6);

      // 6. Update again to confirm reactive stream remains healthy
      dataModel.set('/inputValue', 10);
      expect(angSig()).toBe(11);
    });
  });

  describe('formatString', () => {
    it('should correctly format string with dynamic path and dollar sign', () => {
      const catalog = new BasicCatalogBase();

      // Create Surface Model and DataContext
      const surface = new SurfaceModel('surface_1', catalog);
      const dataModel = surface.dataModel;
      const context = new DataContext(surface, '/');

      // formatString with path binding: '$${/price}'
      const callValue = {
        call: 'formatString',
        args: {
          value: '$${/price}',
        },
        returnType: 'string',
      };

      // 1. Resolve Signal (Preact)
      const resSig = context.resolveSignal<string>(callValue as any);

      // 2. Convert to Angular Signal
      const angSig = toAngularSignal(resSig, mockDestroyRef);

      // 3. Initial state (price is undefined, so should be '$')
      expect(angSig()).toBe('$');

      // 4. Update data model
      dataModel.set('/price', 42);

      // 5. Verify reactive updates - should be '$42'
      // Regression check: This previously would have returned the Signal object
      // stringified as '[object Object]' due to instanceof failures across packages.
      expect(angSig()).toBe('$42');
      expect(typeof angSig()).toBe('string');
    });

    it('should handle multiple path interpolations correctly', () => {
      const catalog = new BasicCatalogBase();
      const surface = new SurfaceModel('surface_1', catalog);
      const dataModel = surface.dataModel;
      const context = new DataContext(surface, '/');

      const callValue = {
        call: 'formatString',
        args: {
          value: '${/firstName} ${/lastName}',
        },
        returnType: 'string',
      };

      const resSig = context.resolveSignal<string>(callValue as any);
      const angSig = toAngularSignal(resSig, mockDestroyRef);

      dataModel.set('/firstName', 'A2UI');
      dataModel.set('/lastName', 'Renderer');

      expect(angSig()).toBe('A2UI Renderer');
    });
  });
});
