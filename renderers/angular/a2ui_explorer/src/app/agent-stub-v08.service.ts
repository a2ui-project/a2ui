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

import {Injectable, signal, computed} from '@angular/core';
import {MessageProcessor as MessageProcessorV08, Theme as ThemeV08} from '@a2ui/angular/v0_8';
import {A2uiClientAction} from '@a2ui/web_core/v0_9';
import {ServerToClientMessage} from 'src/v0_8/types';
import {AgentStubService} from './agent-stub.service';
import {UserAction} from '@a2ui/web_core/types/client-event';

/**
 * Context for the 'update_property' event.
 */
interface UpdatePropertyContext {
  path: string;
  value: any;
  surfaceId?: string;
}

/**
 * A stub service that simulates an A2UI agent.
 * It listens for actions and responds with data model updates or new surfaces.
 * Supports the v0.8 A2UI spec.
 */
@Injectable({
  providedIn: 'root',
})
export class AgentStubV08Service extends AgentStubService {
  override eventsLog = signal<Array<{timestamp: Date; action: A2uiClientAction}>>([]);
  override surfaceId = signal<string>('demo-surface', {equal: () => false});
  override currentCreateSurfaceMessage = signal<ServerToClientMessage[] | null>(null);
  private actionSub?: {unsubscribe: () => void};

  override dataModel = computed(() => {
    const surfaceId = this.surfaceId();
    if (!surfaceId) return {};
    const surfaces = this.messageProcessorV08.getSurfaces();
    const surface = surfaces.get(surfaceId);
    if (surface) {
      return this.messageProcessorV08.getData({id: 'root'} as any, '/', surfaceId) as Record<
        string,
        unknown
      >;
    }
    return {};
  });

  constructor(
    private messageProcessorV08: MessageProcessorV08,
    private themeV08: ThemeV08,
  ) {
    super();
  }

  private handleAction(action: UserAction) {
    console.log('[AgentStubV08] handleAction action:', action);

    setTimeout(() => {
      const {context} = action;
      if (action.name === 'update_property' && action.context) {
        const {path, value, surfaceId} = context as unknown as UpdatePropertyContext;
        this.messageProcessorV08.processMessages([
          {
            dataModelUpdate: {
              surfaceId: surfaceId || this.surfaceId(),
              path: path,
              contents: [
                {
                  key: path.substring(1),
                  valueString: String(value),
                },
              ],
            },
          },
        ]);
      }
    }, 50);
  }

  override initializeDemo(initialMessages: ServerToClientMessage[]) {
    const clonedMessages = JSON.parse(JSON.stringify(initialMessages)) as ServerToClientMessage[];
    this.themeV08.update(this.getDefault08Theme());

    const surfaceUpdate = clonedMessages.find(m => 'surfaceUpdate' in m) as
      | ServerToClientMessage
      | undefined;
    const newSurfaceId = surfaceUpdate?.surfaceUpdate?.surfaceId ?? 'demo-surface';
    this.currentCreateSurfaceMessage.set(clonedMessages);

    this.eventsLog.set([]);
    if (this.actionSub) {
      this.actionSub.unsubscribe();
    }
    this.actionSub = this.messageProcessorV08.events.subscribe(event => {
      const message = event.message;
      if (message.userAction) {
        const action = message.userAction;
        this.handleAction(action);
        this.eventsLog.update(log => [
          {timestamp: new Date(), action: this.userActionToClientAction(action)},
          ...log,
        ]);
      }
    });

    this.messageProcessorV08.processMessages(clonedMessages);

    this.surfaceId.set('');
    setTimeout(() => {
      this.surfaceId.set(newSurfaceId);
    }, 0);
  }

  private userActionToClientAction(action: UserAction): A2uiClientAction {
    return {
      name: action.name,
      surfaceId: action.surfaceId,
      sourceComponentId: action.sourceComponentId,
      timestamp: action.timestamp,
      context: action.context ?? {},
    };
  }

  private getDefault08Theme() {
    return {
      components: {
        AudioPlayer: {},
        Text: {all: {}, h1: {}, h2: {}, h3: {}, h4: {}, h5: {}, body: {}, caption: {}},
        CheckBox: {container: {}, element: {}, label: {}},
        DateTimeInput: {container: {}, element: {}, label: {}},
        List: {},
        Modal: {backdrop: {}, element: {}},
        MultipleChoice: {container: {}, element: {}, label: {}},
        Tabs: {
          container: {},
          element: {},
          controls: {
            all: {},
            selected: {},
          },
        },
        Slider: {container: {}, element: {}, label: {}},
        TextField: {container: {}, element: {}, label: {}},
        Video: {},
        Card: {},
        Row: {},
        Column: {},
        Image: {
          all: {},
          icon: {},
          avatar: {},
          smallFeature: {},
          mediumFeature: {},
          largeFeature: {},
          header: {},
        },
        Divider: {},
        Icon: {},
        Button: {},
      },
      elements: {
        a: {},
        audio: {},
        body: {},
        button: {},
        h1: {},
        h2: {},
        h3: {},
        h4: {},
        h5: {},
        iframe: {},
        input: {},
        p: {},
        pre: {},
        textarea: {},
        video: {},
      },
      markdown: {
        p: [],
        h1: [],
        h2: [],
        h3: [],
        h4: [],
        h5: [],
        ul: [],
        ol: [],
        li: [],
        a: [],
        strong: [],
        em: [],
      },
    };
  }
}
