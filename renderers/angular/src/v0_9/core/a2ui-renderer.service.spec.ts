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

import {TestBed} from '@angular/core/testing';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from './a2ui-renderer.service';

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
