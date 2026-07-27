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
import {MessageProcessor, A2UIClientEvent} from './processor';
import {Catalog} from '../rendering/catalog';
import type {A2UIClientEventMessage, AnyComponentNode, ServerToClientMessage} from '../types';
import * as WebCore from '@a2ui/web_core/v0_8';

describe('MessageProcessor', () => {
  let service: MessageProcessor;
  let mockCatalog: any;

  beforeEach(() => {
    mockCatalog = {};

    TestBed.configureTestingModule({
      providers: [MessageProcessor, {provide: Catalog, useValue: mockCatalog}],
    });
    service = TestBed.inject(MessageProcessor);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should forward processMessages to baseProcessor', () => {
    const baseProcessor = (service as any).baseProcessor;
    spyOn(baseProcessor, 'processMessages');

    const messages: ServerToClientMessage[] = [];
    service.processMessages(messages);

    expect(baseProcessor.processMessages).toHaveBeenCalledWith(messages);
  });

  it('should dispatch events and emit to observable', done => {
    const mockMessage: A2UIClientEventMessage = {
      userAction: {
        name: 'click',
        sourceComponentId: 'btn-1',
        surfaceId: 'surf-1',
        timestamp: new Date().toISOString(),
      },
    };

    service.events.subscribe((event: A2UIClientEvent) => {
      expect(event.message).toBe(mockMessage);
      expect(event.completion).toBeTruthy();
      done();
    });

    service.dispatch(mockMessage);
  });

  it('should resolve dispatch promise when completion is triggered', async () => {
    const mockMessage: A2UIClientEventMessage = {
      userAction: {name: 'click', sourceComponentId: '1', surfaceId: '1', timestamp: ''},
    };

    const replyMessages: ServerToClientMessage[] = [{type: 'UpdateSurface'} as any];

    // Setup subscription to trigger completion
    service.events.subscribe((event: A2UIClientEvent) => {
      event.completion.next(replyMessages);
    });

    const result = await service.dispatch(mockMessage);
    expect(result).toBe(replyMessages);
  });

  it('should forward getData to baseProcessor', () => {
    const baseProcessor = (service as any).baseProcessor;
    spyOn(baseProcessor, 'getData').and.returnValue('mock-value');

    const node = {id: '1', type: 'Text'} as any as AnyComponentNode;
    const result = service.getData(node, 'path/to/data', 'surf-1');

    expect(baseProcessor.getData).toHaveBeenCalledWith(node, 'path/to/data', 'surf-1');
    expect(result).toBe('mock-value');
  });

  it('should forward setData to baseProcessor', () => {
    const baseProcessor = (service as any).baseProcessor;
    spyOn(baseProcessor, 'setData');

    const node = {id: '1', type: 'Text'} as any as AnyComponentNode;
    service.setData(node, 'path/to/data', 'new-value', 'surf-1');

    expect(baseProcessor.setData).toHaveBeenCalledWith(node, 'path/to/data', 'new-value', 'surf-1');
  });

  it('should forward resolvePath to baseProcessor', () => {
    const baseProcessor = (service as any).baseProcessor;
    spyOn(baseProcessor, 'resolvePath').and.returnValue('resolved-path');

    const result = service.resolvePath('path/to/data', 'context');

    expect(baseProcessor.resolvePath).toHaveBeenCalledWith('path/to/data', 'context');
    expect(result).toBe('resolved-path');
  });

  it('should clear surfaces', () => {
    const baseProcessor = (service as any).baseProcessor;
    spyOn(baseProcessor, 'clearSurfaces');

    service.clearSurfaces();

    expect(baseProcessor.clearSurfaces).toHaveBeenCalled();
  });

  it('should only return surfaces that are ready to render', () => {
    // NOTE: This state can occur if a `surfaceUpdate` message is processed
    // before a `beginRendering` message for the same surface.
    const readySurfaceId = 'ready-surface-id';
    const readyComponentId = 'ready-component-id';
    const notReadySurfaceId = 'not-ready-surface-id';
    const readySurface: WebCore.Surface = {
      rootComponentId: readyComponentId,
      componentTree: {
        id: readyComponentId,
        type: 'Text',
        properties: {
          text: {literalString: 'Ready to render'},
        },
      },
      dataModel: new Map(),
      components: new Map(),
      styles: {},
    };
    const notReadySurface: WebCore.Surface = {
      rootComponentId: null,
      componentTree: null,
      dataModel: new Map(),
      components: new Map(),
      styles: {},
    };
    // Add both surfaces to the base processor's surfaces map
    const baseProcessor = (service as any).baseProcessor;
    const surfaces = new Map<string, WebCore.Surface>([
      [readySurfaceId, readySurface],
      [notReadySurfaceId, notReadySurface],
    ]);
    baseProcessor.surfaces = surfaces;

    const returnedSurfaces = service.getSurfaces();

    expect(returnedSurfaces.size).toBe(1);
    expect(returnedSurfaces.get(readySurfaceId)).toBe(readySurface);
    expect(returnedSurfaces.get(notReadySurfaceId)).toBeUndefined();
  });
});
