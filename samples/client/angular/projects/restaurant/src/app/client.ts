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

import {A2uiRendererService} from '@a2ui/angular/v0_9';
import * as Types from '@a2ui/web_core/types/types';
import {inject, Injectable, signal} from '@angular/core';
import {A2uiClientAction, A2uiMessage} from '@a2ui/web_core/v0_9';

@Injectable({providedIn: 'root'})
export class Client {
  private readonly renderer = inject(A2uiRendererService);
  private contextId?: string;

  readonly isLoading = signal(false);

  async handleAction(userAction: A2uiClientAction) {
    try {
      const messages = await this.makeRequest({userAction});
      this.renderer.processMessages(messages as unknown as A2uiMessage[]);
    } catch (err) {
      console.error(err);
    }
  }

  async makeRequest(
    request: Types.A2UIClientEventMessage | string,
  ): Promise<Types.ServerToClientMessage[]> {
    const messages: Types.ServerToClientMessage[] = [];
    try {
      this.isLoading.set(true);

      // Clear existing surfaces on interaction
      const surfaceGroup = this.renderer.surfaceGroup;
      for (const surfaceId of Array.from(surfaceGroup.surfacesMap.keys())) {
        surfaceGroup.deleteSurface(surfaceId);
      }

      const isString = typeof request === 'string';
      const bodyData = isString
        ? {query: request, contextId: this.contextId}
        : {event: request, contextId: this.contextId};

      const response = await fetch('/a2a', {
        body: JSON.stringify(bodyData),
        method: 'POST',
      });

      if (!response.ok) {
        const error = (await response.json()) as {error: string};
        throw new Error(error.error);
      }

      const contentType = response.headers.get('content-type');
      console.log(`[client] Received response with content-type: ${contentType}`);
      if (contentType?.includes('text/event-stream')) {
        await this.handleStreamingResponse(response, messages);
      } else {
        await this.handleNonStreamingResponse(response, messages);
      }
    } catch (err) {
      console.error(err);
      throw err;
    } finally {
      this.isLoading.set(false);
    }
    return messages;
  }

  private async handleStreamingResponse(
    response: Response,
    messages: Types.ServerToClientMessage[],
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;

      const now = performance.now();
      buffer += decoder.decode(value, {stream: true});

      // Parse SSE events. The server sends "data: <json>\n\n"
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            const responseData = JSON.parse(jsonStr);
            console.log(`[client] [${now.toFixed(2)}ms] Received SSE data:`, responseData);

            if (responseData.error) {
              throw new Error(responseData.error);
            } else {
              if (responseData.contextId) {
                this.contextId = responseData.contextId;
              }
              const parts = responseData.parts || (Array.isArray(responseData) ? responseData : []);
              console.log(
                `[client] [${performance.now().toFixed(2)}ms] Scheduling processing for ${parts.length} parts`,
              );
              // Use a microtask to ensure we don't block the stream reader
              await Promise.resolve();
              const newMessages = this.processParts(parts);
              messages.push(...newMessages);
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e, jsonStr);
          }
        }
      }
    }
  }

  private async handleNonStreamingResponse(
    response: Response,
    messages: Types.ServerToClientMessage[],
  ): Promise<void> {
    const responseData = await response.json();
    console.log('[client] Received JSON response:', responseData);

    if (responseData.contextId) {
      this.contextId = responseData.contextId;
    }
    const parts = responseData.parts || (Array.isArray(responseData) ? responseData : []);
    const newMessages = this.processParts(parts);
    messages.push(...newMessages);
  }

  private processParts(parts: any[]): Types.ServerToClientMessage[] {
    const messages: Types.ServerToClientMessage[] = [];
    for (const item of parts) {
      if (item.kind === 'text') continue;
      if (item.data) {
        if (Array.isArray(item.data)) {
          messages.push(...item.data);
        } else {
          messages.push(item.data);
        }
      }
    }
    if (messages.length > 0) {
      this.renderer.processMessages(messages as unknown as A2uiMessage[]);
    }
    return messages;
  }
}
