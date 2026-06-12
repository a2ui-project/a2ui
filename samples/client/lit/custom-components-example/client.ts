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

import {v0_8} from '@a2ui/lit';
import {registerContactComponents} from './ui/custom-components/register-components.js';

import {componentRegistry} from '@a2ui/lit/ui';

export class A2UIClient {
  #ready: Promise<void> = Promise.resolve();
  #contextId?: string;

  get ready() {
    return this.#ready;
  }

  async send(
    message: v0_8.Types.A2UIClientEventMessage,
    onChunk?: (messages: v0_8.Types.ServerToClientMessage[]) => void,
  ): Promise<v0_8.Types.ServerToClientMessage[]> {
    const catalog = componentRegistry.getInlineCatalog();
    const finalMessage = {
      ...message,
      metadata: {
        a2uiClientCapabilities: {
          inlineCatalogs: [catalog],
        },
      },
    };

    const response = await fetch('/a2a', {
      body: JSON.stringify({
        event: finalMessage,
        contextId: this.#contextId,
      }),
      method: 'POST',
    });

    if (!response.ok) {
      const error = (await response.json()) as {error: string};
      throw new Error(error.error);
    }

    const contentType = response.headers.get('content-type');
    const messages: v0_8.Types.ServerToClientMessage[] = [];

    if (contentType?.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace(/^data:\s*/, '');
            try {
              const responseData = JSON.parse(jsonStr);
              if (responseData.error) {
                throw new Error(responseData.error);
              } else {
                if (responseData.contextId) {
                  this.#contextId = responseData.contextId;
                }
                const parts = responseData.parts || responseData;
                const chunkMessages = this.#extractMessages(parts);
                if (chunkMessages.length > 0) {
                  messages.push(...chunkMessages);
                  onChunk?.(chunkMessages);
                }
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, jsonStr);
            }
          }
        }
      }
      return messages;
    }

    const responseData = (await response.json()) as any;
    if (responseData && typeof responseData === 'object' && 'error' in responseData) {
      throw new Error(responseData.error);
    } else {
      if (responseData.contextId) {
        this.#contextId = responseData.contextId;
      }
      const parts = responseData.parts || responseData;
      const extracted = this.#extractMessages(parts);
      messages.push(...extracted);
      if (messages.length > 0) {
        onChunk?.(messages);
      }
    }
    return messages;
  }

  #extractMessages(data: any): v0_8.Types.ServerToClientMessage[] {
    let items: any[] = [];
    if (data.messages && Array.isArray(data.messages)) {
      items = data.messages;
    } else {
      items = Array.isArray(data)
        ? data
        : data.kind === 'message' && Array.isArray(data.parts)
          ? data.parts
          : [data];
    }

    const messages: v0_8.Types.ServerToClientMessage[] = [];
    for (const item of items) {
      if (item.kind === 'message' && Array.isArray(item.parts)) {
        for (const part of item.parts) {
          if (part.data) {
            messages.push(part.data);
          }
        }
      } else {
        if (item.kind === 'text') continue;
        if (item.data) {
          messages.push(item.data);
        }
      }
    }
    return messages;
  }
}
registerContactComponents();
