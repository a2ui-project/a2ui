/**
 * Copyright 2025 Google LLC
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
import {AgentStubService} from './agent-stub.service';
import {AgentStubV09Service} from './agent-stub-v09.service';
import {A2uiRendererService} from '@a2ui/angular/v0_9';
import {ActionDispatcher} from './action-dispatcher.service';
import {Subject} from 'rxjs';
import {A2uiMessage} from '@a2ui/web_core/v0_9';
import {A2UI_VERSION, Version} from './types';

describe('AgentStubService', () => {
  let service: AgentStubService;
  let mockRendererService: any;
  let mockActionDispatcher: any;
  let mockSurfaceGroup: any;

  beforeEach(() => {
    mockSurfaceGroup = {
      getSurface: jasmine.createSpy('getSurface'),
    };
    mockRendererService = {
      processMessages: jasmine.createSpy('processMessages'),
      get surfaceGroup() {
        return mockSurfaceGroup;
      },
    };
    mockActionDispatcher = {
      actions: new Subject(),
    };

    TestBed.configureTestingModule({
      providers: [
        {provide: AgentStubService, useClass: AgentStubV09Service},
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: ActionDispatcher, useValue: mockActionDispatcher},
        {provide: A2UI_VERSION, useValue: Version.V0_9},
      ],
    });
    service = TestBed.inject(AgentStubService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initializeDemo', () => {
    it('should send deleteSurface before createSurface if surface already exists', () => {
      const surfaceId = 'test-surface';
      const createMsg: A2uiMessage = {
        version: 'v0.9',
        createSurface: {
          surfaceId,
          catalogId: 'basic',
        },
      };
      const messages = [createMsg];

      // 1. First call: Surface does not exist
      mockSurfaceGroup.getSurface.and.returnValue(undefined);
      service.initializeDemo(messages);

      // Should have called processMessages with initial messages only
      expect(mockRendererService.processMessages).toHaveBeenCalledWith(messages);
      expect(mockRendererService.processMessages).toHaveBeenCalledTimes(1);
      mockRendererService.processMessages.calls.reset();

      // 2. Second call: Surface now exists
      mockSurfaceGroup.getSurface.and.returnValue({id: surfaceId});
      service.initializeDemo(messages);

      // Should have called processMessages twice:
      // First with deleteSurface, then with initial messages
      const deleteMessages = [
        {
          version: 'v0.9' as const,
          deleteSurface: {surfaceId},
        },
      ];
      expect(mockRendererService.processMessages.calls.allArgs()).toEqual([
        [deleteMessages],
        [messages],
      ]);
    });

    it('should NOT send deleteSurface if surface does not exist', () => {
      const surfaceId = 'new-surface';
      const createMsg: A2uiMessage = {
        version: 'v0.9',
        createSurface: {
          surfaceId,
          catalogId: 'basic',
        },
      };
      const messages = [createMsg];

      mockSurfaceGroup.getSurface.and.returnValue(undefined);
      service.initializeDemo(messages);

      expect(mockRendererService.processMessages).toHaveBeenCalledTimes(1);
      expect(mockRendererService.processMessages).toHaveBeenCalledWith(messages);
    });
  });
});
