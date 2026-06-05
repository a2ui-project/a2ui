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

import {WritableSignal, Signal} from '@angular/core';
import {A2uiClientAction, A2uiMessage, CreateSurfaceMessage} from '@a2ui/web_core/v0_9';
import {ServerToClientMessage} from 'src/v0_8/types';

/**
 * Abstract base class for agent stub services.
 */
export abstract class AgentStubService {
  abstract eventsLog: WritableSignal<Array<{timestamp: Date; action: A2uiClientAction}>>;
  abstract dataModel: Signal<Record<string, unknown>>;
  abstract surfaceId: Signal<string>;
  abstract currentCreateSurfaceMessage: Signal<
    CreateSurfaceMessage | ServerToClientMessage[] | null
  >;

  abstract initializeDemo(initialMessages: A2uiMessage[] | ServerToClientMessage[]): void;
}
