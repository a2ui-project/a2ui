/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Injectable, signal} from '@angular/core';

export interface TelemetryLogEntry {
  id: string;
  timestamp: string;
  card: 'ioc' | 'websocket' | 'agent' | 'resolver' | 'action';
  title: string;
  detail: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class TelemetryLoggerService {
  readonly logs = signal<TelemetryLogEntry[]>([
    {
      id: 'init-0',
      timestamp: new Date().toLocaleTimeString(),
      card: 'ioc',
      title: 'IoC Upload Callback Ready',
      detail: {status: 'Listening for A2UI FileUpload events'},
    },
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      card: 'websocket',
      title: 'WebSocket Payload Interceptor Ready',
      detail: {status: 'Monitoring JSON-RPC userAction payloads'},
    },
  ]);

  log(entry: Omit<TelemetryLogEntry, 'id' | 'timestamp'>) {
    const newEntry: TelemetryLogEntry = {
      ...entry,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
    };
    this.logs.update(current => [newEntry, ...current]);
  }

  clear() {
    this.logs.set([]);
  }
}
