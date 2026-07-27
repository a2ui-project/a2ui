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

import type {A2uiMessage, A2uiClientMessage} from '@a2ui/web_core/v0_9';

interface Part {
  kind: 'data' | 'text' | 'error';
  data?: Record<string, unknown>;
  text?: string;
  mimeType?: string;
}

export class A2UIClient {
  get ready() {
    return Promise.resolve();
  }

  async send(
    message: A2uiClientMessage | string,
    onChunk?: (messages: A2uiMessage[]) => void,
  ): Promise<A2uiMessage[]> {
    const body = typeof message === 'string' ? message : JSON.stringify(message);

    const response = await fetch('/a2a', {
      method: 'POST',
      body: body,
    });

    // Surface non-JSON error pages (e.g. from a proxy) clearly instead of
    // letting the JSON/SSE parsers below fail with a confusing SyntaxError.
    if (!response.ok && !response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type');
    const allMessages: A2uiMessage[] = [];
    // A2A status-update events carry cumulative parts, so createSurface is
    // redelivered on every chunk. Track surfaces we've already forwarded so
    // processMessages doesn't throw "Surface already exists" mid-stream.
    const seenSurfaceIds = new Set<string>();
    if (contentType?.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, {stream: true});

          const lines = buffer.split(/\r?\n\r?\n/);
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              try {
                const parts = JSON.parse(dataStr) as Part[];
                const chunkMessages: A2uiMessage[] = [];
                for (const part of parts) {
                  if (part.kind === 'error') {
                    throw new Error(part.text);
                  }
                  if (part.kind === 'data' && part.data) {
                    const uiMessage = part.data as unknown as A2uiMessage;
                    const createSurface = (uiMessage as {createSurface?: {surfaceId: string}})
                      .createSurface;
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
              } catch (e) {
                console.error('Error processing SSE chunk:', e);
              }
            }
          }
        }
      }
    } else {
      // Non-streaming fallback
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      const parts = data as Part[];
      for (const part of parts) {
        if (part.kind === 'data' && part.data) {
          allMessages.push(part.data as unknown as A2uiMessage);
        }
      }
    }

    return allMessages;
  }
}
