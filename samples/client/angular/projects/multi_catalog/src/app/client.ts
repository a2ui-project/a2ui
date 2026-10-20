/*
 * Copyright 2024 Google LLC
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

import {A2uiRendererService} from '@a2ui/angular';
import {ActionPayload} from '@a2ui/web_core/v1_0';
import {inject, Injectable, signal} from '@angular/core';

/** The A2A parts that the server forwards from the agent. */
interface Part {
  kind: string;
  text?: string;
  data?: unknown;
}

/** Sends requests to the agent through the server, and renders the answers. */
@Injectable({providedIn: 'root'})
export class Client {
  private readonly renderer = inject(A2uiRendererService);
  private contextId?: string;
  /** When the current request started, for the console log of each message. */
  private requestStart = 0;

  readonly isLoading = signal(false);
  /** Whether the last response was read as a stream. */
  readonly streamed = signal<boolean | null>(null);
  /** How many server events of the last response carried A2UI messages. */
  readonly uiEvents = signal(0);
  /** The text the agent sent in the last response, if any. */
  readonly agentText = signal('');
  readonly error = signal('');
  /**
   * The surfaces the renderer holds. The surface group's map is not a signal,
   * so the app reads this one to render a surface as soon as it is created,
   * while the rest of the response is still streaming.
   */
  readonly surfaces = signal<{id: string; catalogId?: string}[]>([]);

  constructor() {
    const surfaceGroup = this.renderer.surfaceGroup;
    surfaceGroup.onSurfaceCreated.subscribe(surface => {
      this.surfaces.update(list => [
        ...list,
        {id: surface.id, catalogId: surface.defaultCatalog?.id},
      ]);
    });
    surfaceGroup.onSurfaceDeleted.subscribe(id => {
      this.surfaces.update(list => list.filter(surface => surface.id !== id));
    });
  }

  async sendQuery(query: string) {
    await this.request({query});
  }

  async handleAction(action: ActionPayload) {
    await this.request({event: {version: 'v1.0', action}});
  }

  private async request(body: {query?: string; event?: unknown}) {
    this.requestStart = performance.now();
    this.isLoading.set(true);
    this.uiEvents.set(0);
    this.agentText.set('');
    this.error.set('');
    // Each response creates its surfaces again.
    const surfaceGroup = this.renderer.surfaceGroup;
    for (const surfaceId of Array.from(surfaceGroup.surfacesMap.keys())) {
      surfaceGroup.deleteSurface(surfaceId);
    }

    try {
      const response = await fetch('/a2a', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...body, contextId: this.contextId}),
      });
      if (!response.ok) {
        throw new Error(((await response.json()) as {error: string}).error);
      }
      const isStream = !!response.headers.get('content-type')?.includes('text/event-stream');
      this.streamed.set(isStream);
      if (isStream) {
        await this.readStream(response);
      } else {
        this.handleData(await response.json());
      }
    } catch (err) {
      console.error(err);
      this.error.set(String(err));
    } finally {
      this.isLoading.set(false);
    }
  }

  private async readStream(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      // The server sends one "data: <json>\n\n" event per agent update.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        if (event.startsWith('data: ')) {
          this.handleData(JSON.parse(event.slice('data: '.length)));
        }
      }
    }
  }

  private handleData(data: {parts?: Part[]; contextId?: string; error?: string}) {
    if (data.error) {
      throw new Error(data.error);
    }
    if (data.contextId) {
      this.contextId = data.contextId;
    }
    const messages: Record<string, unknown>[] = [];
    for (const part of data.parts ?? []) {
      if (part.kind === 'text' && part.text) {
        this.agentText.update(text => text + part.text);
      } else if (part.kind === 'data' && part.data) {
        const data = part.data as Record<string, unknown> | Record<string, unknown>[];
        messages.push(...(Array.isArray(data) ? data : [data]));
      }
    }
    if (messages.length > 0) {
      this.uiEvents.update(count => count + 1);
      for (const message of messages) {
        console.log(
          `[a2ui] ${(performance.now() - this.requestStart).toFixed(0)}ms ${JSON.stringify(message)}`,
        );
      }
      this.renderer.processMessages(messages);
    }
  }
}
