/*
 * Copyright 2025 Google LLC
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
import {Subject, Observable} from 'rxjs';
import * as WebCore from '@a2ui/web_core/v0_8';

import type {A2UIClientEventMessage, AnyComponentNode, ServerToClientMessage} from '../types';

export interface A2UIClientEvent {
  message: A2UIClientEventMessage;
  completion: Subject<ServerToClientMessage[]>;
}

export type DispatchedEvent = A2UIClientEvent;

@Injectable({
  providedIn: 'root',
})
export class MessageProcessor {
  private baseProcessor: WebCore.A2uiMessageProcessor;

  private readonly eventsSubject = new Subject<A2UIClientEvent>();
  readonly events: Observable<A2UIClientEvent> = this.eventsSubject.asObservable();
  // Signal to track the version of the data in the MessageProcessor. Since the base processor updates
  // surfaces in-place (mutating the Map), we use this to force Angular's change detection to
  // re-evaluate any components or effects that depend on getSurfaces().
  private readonly versionSignal = signal(0);
  readonly version = this.versionSignal.asReadonly();

  constructor() {
    this.baseProcessor = new WebCore.A2uiMessageProcessor();
  }

  /**
   * Increments the version signal to notify Angular that the data model has changed.
   * This should be called after any update to the underlying base processor's surfaces.
   */
  private notify() {
    this.versionSignal.update(v => v + 1);
  }

  processMessages(messages: ServerToClientMessage[]) {
    this.baseProcessor.processMessages(messages as WebCore.ServerToClientMessage[]);
    this.notify();
  }

  dispatch(message: A2UIClientEventMessage): Promise<ServerToClientMessage[]> {
    const completion = new Subject<ServerToClientMessage[]>();
    const promise = new Promise<ServerToClientMessage[]>((resolve, reject) => {
      completion.subscribe({
        next: msgs => resolve(msgs),
        error: err => reject(err),
      });
    });

    this.eventsSubject.next({message, completion});
    return promise;
  }

  getData(node: AnyComponentNode, path: string, surfaceId?: string | null): unknown {
    return this.baseProcessor.getData(
      node as WebCore.AnyComponentNode,
      path,
      surfaceId ?? undefined,
    );
  }

  setData(node: AnyComponentNode | null, path: string, value: any, surfaceId: string) {
    this.baseProcessor.setData(node as WebCore.AnyComponentNode | null, path, value, surfaceId);
    this.notify();
  }

  resolvePath(path: string, dataContextPath?: string): string {
    return this.baseProcessor.resolvePath(path, dataContextPath);
  }

  getSurfaces(): ReadonlyMap<string, WebCore.Surface> {
    this.versionSignal(); // Track dependency
    const allSurfaces = this.baseProcessor.getSurfaces();
    const readySurfaces = new Map<string, WebCore.Surface>();
    for (const [id, surface] of allSurfaces.entries()) {
      if (surface.rootComponentId != null) {
        readySurfaces.set(id, surface);
      }
    }
    return readySurfaces;
  }

  clearSurfaces() {
    this.baseProcessor.clearSurfaces();
    this.notify();
  }
}
