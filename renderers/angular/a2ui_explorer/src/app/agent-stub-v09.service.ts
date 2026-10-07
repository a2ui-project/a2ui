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
  value: unknown;
  surfaceId?: string;
}

/**
 * Context for the 'submit_form' event.
 */
interface SubmitFormContext {
  [key: string]: unknown;
  name?: string;
}

/**
 * A stub service that simulates an A2UI agent.
 * It listens for actions and responds with data model updates or new surfaces.
 * Supports the v0.9 and v1.0 A2UI specs.
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
  private errorSub?: {unsubscribe: () => void};
  private activeProtocolVersion: 'v0.9' | 'v1.0' = 'v0.9';
  private activeSurfaceId = 'demo-surface';

  constructor(
    private rendererService: A2uiRendererService,
    private actionDispatcher: ActionDispatcher,
  ) {
    super();
  }

  private handleAction(action: A2uiClientAction) {
    setTimeout(() => {
      const {name, context} = action;
      if (name === 'update_property' && context) {
        const {path, value, surfaceId} = context as unknown as UpdatePropertyContext;
        this.rendererService.processMessages([
          {
            version: this.activeProtocolVersion,
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
            version: this.activeProtocolVersion,
            updateDataModel: {
              surfaceId: action.surfaceId,
              path: '/form/submitted',
              value: true,
            },
          },
          {
            version: this.activeProtocolVersion,
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

  private ensureActionSubscription() {
    this.actionSub?.unsubscribe();
    this.actionSub = this.actionDispatcher.actions.subscribe(action => {
      this.handleAction(action);
      this.eventsLog.update(log => [{timestamp: new Date(), action}, ...log]);
    });
  }

  private attachSurfaceSubscriptions(surfaceId: string) {
    this.dataModelSub?.unsubscribe();
    this.errorSub?.unsubscribe();
    const surface = this.rendererService.surfaceGroup?.getSurface(surfaceId);
    if (surface?.dataModel) {
      this.dataModelSub = surface.dataModel.subscribe('/', data => {
        this.dataModel.set(data as Record<string, unknown>);
      });
      this.dataModel.set(surface.dataModel.get('/'));
    } else {
      this.dataModel.set({});
    }
    if (surface?.onError) {
      this.errorSub = surface.onError.subscribe((err: {message?: string; code?: string}) => {
        const errorAction: A2uiClientAction = {
          name: 'Error',
          surfaceId,
          sourceComponentId: '',
          timestamp: new Date().toISOString(),
          context: {
            code: err.code ?? 'SURFACE_ERROR',
            message: err.message ?? String(err),
          },
        };
        this.eventsLog.update(log => [{timestamp: new Date(), action: errorAction}, ...log]);
      });
    }
  }

  override initializeDemo(initialMessages: A2uiMessage[]) {
    const clonedMessages = JSON.parse(JSON.stringify(initialMessages)) as A2uiMessage[];
    const firstMsgVersion = (clonedMessages[0] as {version?: string} | undefined)?.version;
    this.activeProtocolVersion = firstMsgVersion === 'v1.0' ? 'v1.0' : 'v0.9';

    this.deleteExistingSurfaces(clonedMessages);
    const createMsg = clonedMessages.find((m): m is CreateSurfaceMessage => 'createSurface' in m);
    const newSurfaceId = createMsg ? createMsg.createSurface.surfaceId : 'demo-surface';
    this.activeSurfaceId = newSurfaceId;
    this.currentCreateSurfaceMessage.set(createMsg || null);

    this.eventsLog.set([]);
    this.ensureActionSubscription();

    this.rendererService.processMessages(clonedMessages);

    this.attachSurfaceSubscriptions(newSurfaceId);

    this.surfaceId.set('');
    setTimeout(() => {
      this.surfaceId.set(newSurfaceId);
    }, 0);
  }

  override resetSurface(messages: A2uiMessage[]) {
    const clonedMessages = JSON.parse(JSON.stringify(messages)) as A2uiMessage[];
    const firstMsgVersion = (clonedMessages[0] as {version?: string} | undefined)?.version;
    this.activeProtocolVersion = firstMsgVersion === 'v1.0' ? 'v1.0' : 'v0.9';
    this.deleteExistingSurfaces(clonedMessages);
    this.dataModelSub?.unsubscribe();
    this.dataModelSub = undefined;
    this.errorSub?.unsubscribe();
    this.errorSub = undefined;
    this.eventsLog.set([]);
    this.dataModel.set({});
    this.surfaceId.set('');
  }

  override processIncrementalMessages(messagesToProcess: A2uiMessage[]) {
    if (messagesToProcess.length === 0) return;
    const clonedMessages = JSON.parse(JSON.stringify(messagesToProcess)) as A2uiMessage[];
    const firstMsgVersion = (clonedMessages[0] as {version?: string} | undefined)?.version;
    if (firstMsgVersion === 'v1.0' || firstMsgVersion === 'v0.9') {
      this.activeProtocolVersion = firstMsgVersion;
    }

    const createMsg = clonedMessages.find((m): m is CreateSurfaceMessage => 'createSurface' in m);
    if (createMsg) {
      this.activeSurfaceId = createMsg.createSurface.surfaceId;
      this.currentCreateSurfaceMessage.set(createMsg);
      this.ensureActionSubscription();
    }

    this.rendererService.processMessages(clonedMessages);

    if (createMsg || !this.dataModelSub) {
      this.attachSurfaceSubscriptions(this.activeSurfaceId);
    }

    if (createMsg || !this.surfaceId()) {
      const targetId = this.activeSurfaceId;
      this.surfaceId.set(targetId);
    }
  }

  private deleteExistingSurfaces(messages: A2uiMessage[]) {
    if (!this.rendererService.surfaceGroup) return;
    for (const msg of messages) {
      if ('createSurface' in msg) {
        const surfaceId = msg.createSurface.surfaceId;
        if (this.rendererService.surfaceGroup.getSurface(surfaceId)) {
          this.rendererService.processMessages([
            {
              version: this.activeProtocolVersion,
              deleteSurface: {surfaceId},
            },
          ]);
        }
      }
    }
  }
}
