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

import {Injectable} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from './a2ui-renderer.service';
import {provideA2Ui} from './provide-a2ui';
import {BasicCatalog} from '../catalog/basic/basic-catalog';
import {isAngularComponentImplementation} from '../catalog/types';
import {isWebComponentImplementation} from '@a2ui/web_core/v0_9';

describe('A2uiRendererService', () => {
  let service: A2uiRendererService;
  let mockCatalog: any;

  beforeEach(() => {
    mockCatalog = {
      components: new Map(),
      functions: new Map(),
      get invoker() {
        return (name: string, args: any, ctx: any, ab?: any) => {
          const fn = mockCatalog.functions.get(name);
          if (fn) return fn(args, ctx, ab);
          console.warn(`Function "${name}" not found in catalog`);
          return undefined;
        };
      },
    };

    TestBed.configureTestingModule({
      providers: [
        A2uiRendererService,
        {
          provide: A2UI_RENDERER_CONFIG,
          useValue: {catalogs: [mockCatalog]},
        },
      ],
    });

    service = TestBed.inject(A2uiRendererService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initialization', () => {
    it('should create surfaceGroup', () => {
      expect(service.surfaceGroup).toBeDefined();
    });
  });

  describe('processMessages', () => {
    it('should delegate to MessageProcessor', () => {
      // Access private _messageProcessor via bracket notation for testing if needed,
      // or verify indirectly by inspecting surfaceGroup after messages.
      // Since MessageProcessor is complex, we can just verify it doesn't crash
      // and updates model if we pass valid messages.
      // For a pure unit test, we might consider mocking MessageProcessor if it was injected,
      // but it's instantiated via 'new'.
      // Let's pass an empty array to verify delegate runs without error.
      expect(() => service.processMessages([])).not.toThrow();
    });
  });

  describe('ngOnDestroy', () => {
    it('should dispose surfaceGroup', () => {
      const surfaceGroup = service.surfaceGroup;
      expect(surfaceGroup).toBeDefined();

      const disposeSpy = spyOn(surfaceGroup as any, 'dispose');

      service.ngOnDestroy();

      expect(disposeSpy).toHaveBeenCalled();
    });
  });
});

describe('provideA2Ui', () => {
  it('should provide the configuration and allow A2uiRendererService to be instantiated', () => {
    const mockCatalog = {
      components: new Map(),
      functions: new Map(),
    };
    TestBed.configureTestingModule({
      providers: [provideA2Ui({catalogs: [mockCatalog as any]})],
    });
    const config = TestBed.inject(A2UI_RENDERER_CONFIG);
    expect(config).toEqual({catalogs: [mockCatalog as any]});

    const service = TestBed.inject(A2uiRendererService);
    expect(service).toBeTruthy();
  });

  it('should support providing the configuration via a factory function', () => {
    const mockCatalog = {
      components: new Map(),
      functions: new Map(),
    };
    TestBed.configureTestingModule({
      providers: [provideA2Ui(() => ({catalogs: [mockCatalog as any]}))],
    });
    const config = TestBed.inject(A2UI_RENDERER_CONFIG);
    expect(config).toEqual({catalogs: [mockCatalog as any]});

    const service = TestBed.inject(A2uiRendererService);
    expect(service).toBeTruthy();
  });

  it('should provide BasicCatalog in configuration', () => {
    const basicCat = new BasicCatalog();
    TestBed.configureTestingModule({
      providers: [provideA2Ui({catalogs: [basicCat]})],
    });
    const config = TestBed.inject(A2UI_RENDERER_CONFIG);
    expect(config.catalogs).toBeDefined();
    expect(config.catalogs!.length).toBe(1);
    const catalog = config.catalogs![0];
    expect(catalog.components.size).toBeGreaterThan(1);
    for (const comp of catalog.components.values()) {
      expect(isAngularComponentImplementation(comp)).toBeTrue();
      if (isAngularComponentImplementation(comp)) {
        expect(comp.component).toBeDefined();
      }
    }
  });

  it('should support useUniversalComponents option in configuration', () => {
    const basicCat = new BasicCatalog();
    TestBed.configureTestingModule({
      providers: [provideA2Ui({catalogs: [basicCat], useUniversalComponents: true})],
    });
    const config = TestBed.inject(A2UI_RENDERER_CONFIG);
    expect(config.useUniversalComponents).toBeTrue();
    TestBed.inject(A2uiRendererService);
    expect(basicCat.components.size).toBeGreaterThan(1);
    for (const comp of basicCat.components.values()) {
      expect(isWebComponentImplementation(comp)).toBeTrue();
    }
  });

  it('should support custom catalogs extending BasicCatalog', () => {
    @Injectable()
    class CustomCatalog extends BasicCatalog {}

    TestBed.configureTestingModule({
      providers: [
        provideA2Ui({catalogs: [new CustomCatalog()], useUniversalComponents: true}),
        {provide: CustomCatalog, useClass: CustomCatalog},
      ],
    });

    const customCatalog = TestBed.inject(CustomCatalog);
    expect(customCatalog.components.size).toBeGreaterThan(1);
    for (const comp of customCatalog.components.values()) {
      expect(isAngularComponentImplementation(comp)).toBeTrue();
    }
  });
});
