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

import {DataPart, Part, SendMessageSuccessResponse, Task} from '@a2a-js/sdk';
import {A2AClient} from '@a2a-js/sdk/client';

import {
  A2UIClientTurnResult,
  PLAYGROUND_TRACE_MIME_TYPE,
  PlaygroundTurnTrace,
} from './types/inspector.js';

export {type A2UIClientTurnResult, PLAYGROUND_TRACE_MIME_TYPE, type PlaygroundTurnTrace};

const A2UI_MIME_TYPE = 'application/a2ui+json';
const LEGACY_A2UI_MIME_TYPE = 'application/json+a2ui';

/**
 * Per-turn request options for `A2UIClient.sendTurn(...)`.
 */
export interface SendTurnOptions {
  /** Whether to request the in-band Format Playground pipeline trace part. */
  inspector?: boolean;
}

/**
 * Client wrapper around `A2AClient` that negotiates A2UI extensions,
 * persists `contextId` across conversation turns, and separates in-band
 * playground trace payloads from A2UI surface messages.
 */
export class A2UIClient {
  #serverUrl: string;
  #client: A2AClient | null = null;
  #contextId: string | null = null;

  /**
   * Creates an A2UI client bound to an A2A server base URL.
   *
   * @param serverUrl Base URL of the A2A agent server (defaults to `http://localhost:10002` when empty).
   */
  constructor(serverUrl: string = '') {
    this.#serverUrl = serverUrl;
  }

  #ready: Promise<void> = Promise.resolve();

  /** Promise that resolves when client initialization is complete. */
  get ready() {
    return this.#ready;
  }

  /** Active A2A conversation context identifier, or `null` before the first turn. */
  get contextId(): string | null {
    return this.#contextId;
  }

  /**
   * Clears the stored conversation `contextId` so the next turn starts a fresh session.
   */
  resetSession(): void {
    this.#contextId = null;
  }

  /**
   * Lazily initializes and returns the underlying `A2AClient` from the server's agent card.
   *
   * @return The initialized `A2AClient` instance.
   */
  async #getClient() {
    if (!this.#client) {
      // Default to localhost:10002 if no URL provided (fallback for restaurant app default)
      const baseUrl = this.#serverUrl || 'http://localhost:10002';

      this.#client = await A2AClient.fromCardUrl(`${baseUrl}/.well-known/agent-card.json`, {
        fetchImpl: async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set(
            'X-A2A-Extensions',
            'https://a2ui.org/a2a-extension/a2ui/v1.0, https://a2ui.org/a2a-extension/a2ui/v0.9',
          );
          return fetch(url, {...init, headers});
        },
      });
    }
    return this.#client;
  }

  /**
   * Converts a user prompt string or client action payload into outgoing A2A message parts.
   *
   * @param message User string (plain text or JSON object) or structured action object.
   * @return Outgoing A2A message parts including the `useStreaming: false` hint.
   */
  #buildOutgoingParts(message: unknown): Part[] {
    let parts: Part[];
    if (typeof message === 'string') {
      parts = this.#parseStringMessageParts(message);
    } else {
      parts = [
        {
          kind: 'data',
          data: message as Record<string, unknown>,
          mimeType: A2UI_MIME_TYPE,
          metadata: {mimeType: A2UI_MIME_TYPE},
        } as Part,
      ];
    }

    parts.push({
      kind: 'data',
      data: {useStreaming: false},
      mimeType: 'application/json',
    } as Part);
    return parts;
  }

  /**
   * Parses a user string as either an A2UI JSON data part or a plain text part.
   *
   * @param message Raw user input string.
   * @return A single-element `Part` array.
   */
  #parseStringMessageParts(message: string): Part[] {
    try {
      const parsed = JSON.parse(message);
      if (typeof parsed === 'object' && parsed !== null) {
        return [
          {
            kind: 'data',
            data: parsed as Record<string, unknown>,
            mimeType: A2UI_MIME_TYPE,
            metadata: {mimeType: A2UI_MIME_TYPE},
          } as Part,
        ];
      }
    } catch {
      // Fall through to plain text part.
    }
    return [{kind: 'text', text: message}];
  }

  /**
   * Splits response `DataPart` entries into A2UI wire messages and an optional playground trace.
   *
   * @param parts Response parts from the completed A2A task status message.
   * @return Object containing A2UI wire `messages` and the optional `trace`.
   */
  #routeDataParts(parts: Part[] | undefined): {
    messages: unknown[];
    trace: PlaygroundTurnTrace | null;
  } {
    const messages: unknown[] = [];
    let trace: PlaygroundTurnTrace | null = null;
    if (!parts) {
      return {messages, trace};
    }

    for (const part of parts) {
      if (part.kind !== 'data') {
        continue;
      }
      const dataPart = part as DataPart & {mimeType?: unknown};
      const rawMime = dataPart.metadata?.mimeType ?? dataPart.mimeType;
      const mimeType = typeof rawMime === 'string' ? rawMime : undefined;
      if (mimeType === PLAYGROUND_TRACE_MIME_TYPE) {
        trace = dataPart.data as unknown as PlaygroundTurnTrace;
      } else if (!mimeType || mimeType === A2UI_MIME_TYPE || mimeType === LEGACY_A2UI_MIME_TYPE) {
        messages.push(dataPart.data);
      }
    }
    return {messages, trace};
  }

  /**
   * Sends a turn to the agent, persisting `contextId` across calls and splitting
   * any in-band playground trace `DataPart` from A2UI surface messages.
   *
   * @param message User text, JSON string, or client event payload.
   * @param rendererCapabilities Renderer capability map keyed by protocol version.
   * @param options Optional request flags such as `inspector: true`.
   * @return Turn result containing wire messages, optional inspector trace, and `contextId`.
   */
  async sendTurn(
    message: unknown,
    rendererCapabilities: Record<string, unknown>,
    options?: SendTurnOptions,
  ): Promise<A2UIClientTurnResult> {
    const client = await this.#getClient();
    const parts = this.#buildOutgoingParts(message);

    const response = await client.sendMessage({
      message: {
        messageId: crypto.randomUUID(),
        role: 'user',
        parts,
        kind: 'message',
        contextId: this.#contextId ?? undefined,
        metadata: {
          a2uiClientCapabilities: rendererCapabilities,
          ...(options?.inspector ? {a2uiPlaygroundInspector: true} : {}),
        },
      },
    });

    if ('error' in response) {
      throw new Error(response.error.message);
    }

    const result = (response as SendMessageSuccessResponse).result as Task;
    if (result?.kind === 'task') {
      this.#contextId = result.contextId ?? this.#contextId;
      const routed = this.#routeDataParts(result.status?.message?.parts);
      return {
        messages: routed.messages,
        trace: routed.trace,
        contextId: this.#contextId,
      };
    }

    return {
      messages: [],
      trace: null,
      contextId: this.#contextId,
    };
  }

  /**
   * Sends a message to the agent and returns only the A2UI wire messages.
   *
   * @param message The user's text, or a client event.
   * @param rendererCapabilities The renderer's capabilities, keyed by protocol
   *   version, which the agent negotiates the request's catalogs from.
   * @return Array of A2UI wire messages returned by the agent.
   */
  async send(message: unknown, rendererCapabilities: Record<string, unknown>): Promise<unknown[]> {
    return (await this.sendTurn(message, rendererCapabilities)).messages;
  }
}
