/**
 * Copyright 2026 kokoro-ele
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

import {randomUUID} from 'node:crypto';
import {A2AClient} from '@a2a-js/sdk/client';
import type {MessageSendParams, Part} from '@a2a-js/sdk';
import type {A2uiMessage, A2uiClientMessage} from '@a2ui/web_core/v0_9';

const A2UI_MIME_TYPE = 'application/a2ui+json';
const A2UI_EXTENSION = 'https://a2ui.org/a2a-extension/a2ui/v0.9';

const fetchWithExtension: typeof fetch = async (url, init) => {
  const headers = new Headers(init?.headers);
  headers.set('X-A2A-Extensions', A2UI_EXTENSION);
  return fetch(url, {...init, headers});
};

/**
 * Node A2A client that talks to the same restaurant-finder agent the React
 * shell uses (default http://localhost:10002). Mirrors the Vite middleware in
 * samples/client/react/shell/middleware/a2a.ts without needing the browser proxy.
 */
export class InkA2AClient {
  private client: A2AClient | null = null;

  constructor(private readonly agentBaseUrl: string) {}

  private async getClient(): Promise<A2AClient> {
    if (!this.client) {
      const cardUrl = `${this.agentBaseUrl.replace(/\/$/, '')}/.well-known/agent-card.json`;
      this.client = await A2AClient.fromCardUrl(cardUrl, {fetchImpl: fetchWithExtension});
    }
    return this.client;
  }

  async send(
    message: A2uiClientMessage | string,
    onChunk?: (messages: A2uiMessage[]) => void,
  ): Promise<A2uiMessage[]> {
    const sendParams = this.toSendParams(message);
    const client = await this.getClient();
    const stream = client.sendMessageStream(sendParams);

    const allMessages: A2uiMessage[] = [];
    // A2A status-update events redeliver createSurface on every chunk.
    const seenSurfaceIds = new Set<string>();

    for await (const chunk of stream) {
      let parts: Part[] | undefined;
      if (chunk.kind === 'status-update' && chunk.status.message?.parts) {
        parts = chunk.status.message.parts;
      } else if (chunk.kind === 'message' && chunk.parts) {
        parts = chunk.parts;
      }
      if (!parts) continue;

      const chunkMessages: A2uiMessage[] = [];
      for (const part of parts) {
        if (part.kind === 'data' && part.data) {
          const uiMessage = part.data as unknown as A2uiMessage;
          const createSurface = (uiMessage as {createSurface?: {surfaceId: string}}).createSurface;
          if (createSurface) {
            if (seenSurfaceIds.has(createSurface.surfaceId)) continue;
            seenSurfaceIds.add(createSurface.surfaceId);
          }
          chunkMessages.push(uiMessage);
        }
      }
      if (chunkMessages.length > 0) {
        allMessages.push(...chunkMessages);
        onChunk?.(chunkMessages);
      }
    }

    return allMessages;
  }

  private toSendParams(message: A2uiClientMessage | string): MessageSendParams {
    if (typeof message === 'string') {
      return {
        message: {
          messageId: randomUUID(),
          role: 'user',
          parts: [{kind: 'text', text: message}],
          kind: 'message',
        },
      };
    }
    return {
      message: {
        messageId: randomUUID(),
        role: 'user',
        parts: [
          {
            kind: 'data',
            data: message as unknown as Record<string, unknown>,
            mimeType: A2UI_MIME_TYPE,
          } as Part,
        ],
        kind: 'message',
      },
    };
  }
}
