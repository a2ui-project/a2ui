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

import {Injectable, signal} from '@angular/core';
import {A2uiRendererService} from '@a2ui/angular/v0_9';
import {A2uiClientAction, A2uiMessage, CreateSurfaceMessage} from '@a2ui/web_core/v0_9';
import {ActionDispatcher} from './action-dispatcher.service';
import {AgentStubService} from './agent-stub.service';

/**
 * Context for the 'update_property' event.
 */
interface UpdatePropertyContext {
  path: string;
  value: any;
  surfaceId?: string;
}

/**
 * Context for the 'submit_form' event.
 */
interface SubmitFormContext {
  [key: string]: any;
  name?: string;
}

/**
 * A stub service that simulates an A2UI agent.
 * It listens for actions and responds with data model updates or new surfaces.
 * Supports the v0.9 A2UI spec.
 */
@Injectable({
  providedIn: 'root',
})
export class AgentStubV09Service extends AgentStubService {
  override dataModel = signal<Record<string, unknown>>({});
  override surfaceId = signal<string>('demo-surface', {equal: () => false});
  override eventsLog = signal<Array<{timestamp: Date; action: A2uiClientAction}>>([]);
  override currentCreateSurfaceMessage = signal<CreateSurfaceMessage | null>(null);
  private actionSub?: {unsubscribe: () => void};
  private dataModelSub?: {unsubscribe: () => void};

  constructor(
    private rendererService: A2uiRendererService,
    private actionDispatcher: ActionDispatcher,
  ) {
    super();
  }

  private handleAction(action: A2uiClientAction) {
    console.log('[AgentStubV09] handleAction action:', action);

    setTimeout(() => {
      const {name, context} = action;
      if (name === 'update_property' && context) {
        const {path, value, surfaceId} = context as unknown as UpdatePropertyContext;
        console.log(
          '[AgentStubV09] update_property path:',
          path,
          'value:',
          value,
          'surfaceId:',
          surfaceId,
        );
        this.rendererService.processMessages([
          {
            version: 'v0.9',
            updateDataModel: {
              surfaceId: surfaceId || action.surfaceId,
              path: path,
              value: value,
            },
          },
        ]);
      } else if (name === 'submit_form' && context) {
        const formData = context as unknown as SubmitFormContext;
        const nameValue = formData.name || 'Anonymous';

        this.rendererService.processMessages([
          {
            version: 'v0.9',
            updateDataModel: {
              surfaceId: action.surfaceId,
              path: '/form/submitted',
              value: true,
            },
          },
          {
            version: 'v0.9',
            updateDataModel: {
              surfaceId: action.surfaceId,
              path: '/form/responseMessage',
              value: `Hello, ${nameValue}! Your form has been processed.`,
            },
          },
        ]);
      }
    }, 50);
  }

  override initializeDemo(initialMessages: A2uiMessage[]) {
    const clonedMessages = JSON.parse(JSON.stringify(initialMessages)) as A2uiMessage[];
    if (this.rendererService.surfaceGroup) {
      for (const msg of clonedMessages) {
        if ('createSurface' in msg) {
          const createSurface = msg.createSurface;
          if (this.rendererService.surfaceGroup.getSurface(createSurface.surfaceId)) {
            this.rendererService.processMessages([
              {
                version: 'v0.9',
                deleteSurface: {surfaceId: createSurface.surfaceId},
              },
            ]);
          }
        }
      }
    }
    const createMsg = clonedMessages.find((m): m is CreateSurfaceMessage => 'createSurface' in m);
    const newSurfaceId = createMsg ? createMsg.createSurface.surfaceId : 'demo-surface';
    this.currentCreateSurfaceMessage.set(createMsg || null);

    this.eventsLog.set([]);
    if (this.actionSub) {
      this.actionSub.unsubscribe();
    }
    this.actionSub = this.actionDispatcher.actions.subscribe(action => {
      this.handleAction(action);
      this.eventsLog.update(log => [{timestamp: new Date(), action}, ...log]);
    });

    this.rendererService.processMessages(clonedMessages);

    if (this.dataModelSub) {
      this.dataModelSub.unsubscribe();
    }
    const surface = this.rendererService.surfaceGroup?.getSurface(newSurfaceId);
    if (surface && surface.dataModel) {
      this.dataModelSub = surface.dataModel.subscribe('/', data => {
        this.dataModel.set(data as Record<string, unknown>);
      });
      this.dataModel.set(surface.dataModel.get('/'));
    } else {
      this.dataModel.set({});
    }

    this.surfaceId.set('');
    setTimeout(() => {
      this.surfaceId.set(newSurfaceId);
    }, 0);
  }
}
