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
import {A2uiRendererService, A2UI_RENDERER_CONFIG, provideA2Ui} from './a2ui-renderer.service';
import {BasicCatalog} from '../basic-catalog';
import {isWebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {getMarkdownRenderer, setMarkdownRenderer} from '@a2ui/web_core/v0_9/basic_catalog';
import {MarkdownRenderer} from './markdown';

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
    beforeEach(() => {
      setMarkdownRenderer(undefined);
    });

    afterEach(() => {
      setMarkdownRenderer(undefined);
    });

    it('should create surfaceGroup', () => {
      expect(service.surfaceGroup).toBeDefined();
    });

    it('should configure web_core setMarkdownRenderer when MarkdownRenderer is in the injector', async () => {
      const mockRenderer: MarkdownRenderer = {
        render: jasmine.createSpy('render').and.resolveTo('<p>rendered</p>'),
      };

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          A2uiRendererService,
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [mockCatalog], useUniversalComponents: true},
          },
          {
            provide: MarkdownRenderer,
            useValue: mockRenderer,
          },
        ],
      });

      const svc = TestBed.inject(A2uiRendererService);
      expect(svc).toBeTruthy();

      const registeredFn = getMarkdownRenderer();
      expect(registeredFn).toBeDefined();

      const result = await registeredFn!('# heading', {tagClassMap: {h1: ['custom-h1']}});
      expect(result).toBe('<p>rendered</p>');
      expect(mockRenderer.render).toHaveBeenCalledWith('# heading', {
        tagClassMap: {h1: ['custom-h1']},
      });
    });

    it('should leave the web_core markdown renderer untouched when MarkdownRenderer is not in the injector', () => {
      const existing = async (markdown: string) => markdown;
      setMarkdownRenderer(existing);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          A2uiRendererService,
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [mockCatalog], useUniversalComponents: true},
          },
        ],
      });
      TestBed.inject(A2uiRendererService);

      expect(getMarkdownRenderer()).toBe(existing);
    });

    it('should not configure web_core setMarkdownRenderer when universal components are disabled', () => {
      const existing = async (markdown: string) => markdown;
      setMarkdownRenderer(existing);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          A2uiRendererService,
          {provide: A2UI_RENDERER_CONFIG, useValue: {catalogs: [mockCatalog]}},
          {provide: MarkdownRenderer, useValue: {render: async () => '<p>rendered</p>'}},
        ],
      });
      TestBed.inject(A2uiRendererService);

      expect(getMarkdownRenderer()).toBe(existing);
    });
  });

  describe('processMessages and processor methods', () => {
    it('should delegate processMessages to MessageProcessor', () => {
      expect(() => service.processMessages([])).not.toThrow();
    });

    it('should delegate processMessagesAsync to MessageProcessor', async () => {
      const spy = spyOn(service.processor, 'processMessagesAsync').and.resolveTo();
      await service.processMessagesAsync({version: 'v1.0', messages: []});
      expect(spy).toHaveBeenCalledWith({version: 'v1.0', messages: []});
    });

    it('should delegate callAgentFunction to MessageProcessor', async () => {
      const spy = spyOn(service.processor, 'callAgentFunction').and.resolveTo('ok');
      const result = await service.callAgentFunction('surf1', 'myFn', {a: 1});
      expect(result).toBe('ok');
      expect(spy).toHaveBeenCalledWith('surf1', {call: 'myFn', args: {a: 1}} as any, undefined);
    });
  });

  describe('ngOnDestroy', () => {
    it('should dispose processor and surfaceGroup', () => {
      const processorDisposeSpy = spyOn(service.processor, 'dispose').and.callThrough();
      const surfaceGroupDisposeSpy = spyOn(
        service.surfaceGroup as any,
        'dispose',
      ).and.callThrough();

      service.ngOnDestroy();

      expect(processorDisposeSpy).toHaveBeenCalled();
      expect(surfaceGroupDisposeSpy).toHaveBeenCalled();
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
      expect(comp.component).toEqual(jasmine.any(Function));
    }
  });

  it('should support useUniversalComponents option in configuration', () => {
    const basicCat = new BasicCatalog();
    TestBed.configureTestingModule({
      providers: [provideA2Ui({catalogs: [basicCat], useUniversalComponents: true})],
    });
    const config = TestBed.inject(A2UI_RENDERER_CONFIG);
    expect(config.useUniversalComponents).toBeTrue();
    expect(TestBed.inject(A2uiRendererService).useUniversalComponents).toBeTrue();
  });

  it('should keep basic catalog entries renderable both natively and as Web Components regardless of the flag', () => {
    const basicCat = new BasicCatalog();
    TestBed.configureTestingModule({
      providers: [provideA2Ui({catalogs: [basicCat], useUniversalComponents: false})],
    });
    TestBed.inject(A2uiRendererService);
    expect(basicCat.components.size).toBeGreaterThan(1);
    for (const comp of basicCat.components.values()) {
      expect(comp.component).toEqual(jasmine.any(Function));
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
      expect(comp.component).toEqual(jasmine.any(Function));
    }
  });
});
