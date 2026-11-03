/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The A2A side of the chat host: one turn in, one reply out. The reply
 * separates the agent's text from its A2UI messages so the chat can show the
 * former and hand the latter to the `MessageProcessor`.
 */

import type {Message, Part, Task} from '@a2a-js/sdk';
import {A2AClient} from '@a2a-js/sdk/client';

/** MIME type of A2UI data parts, both directions. */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/** The A2UI A2A extension this host negotiates. */
export const A2UI_EXTENSION_URI = 'https://a2ui.org/a2a-extension/a2ui/v1.0';

function defaultAgentHost(): string {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return window.location.hostname;
  }
  return 'localhost';
}

/** Default URL of the Kanban agent. */
export const DEFAULT_AGENT_URL = `http://${defaultAgentHost()}:10007`;

/** What comes back from one turn. */
export interface AgentReply {
  /** The agent's prose, in order. */
  readonly texts: readonly string[];
  /** The A2UI messages (`createSurface`, `updateDataModel`, ...), in order. */
  readonly a2uiMessages: readonly Record<string, unknown>[];
}

/** The agent as the chat sees it; the tests supply a scripted one. */
export interface AgentClient {
  send(parts: readonly Part[]): Promise<AgentReply>;
}

/** Builds the data part of an A2UI payload (an action, the renderer data model, ...). */
export function a2uiDataPart(data: Record<string, unknown>): Part {
  return {kind: 'data', data, metadata: {mimeType: A2UI_MIME_TYPE}};
}

/** Sorts the parts of an agent message into prose and A2UI messages. */
export function partsToReply(parts: readonly Part[]): AgentReply {
  const texts: string[] = [];
  const a2uiMessages: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text.trim() !== '') {
        texts.push(part.text);
      }
    } else if (part.kind === 'data') {
      const mimeType = (part.metadata as {mimeType?: unknown} | undefined)?.mimeType;
      if (mimeType === A2UI_MIME_TYPE || mimeType === 'application/json+a2ui') {
        a2uiMessages.push(part.data);
      }
    }
  }
  return {texts, a2uiMessages};
}

/** Which way an A2A message travelled between the host and the agent. */
export type A2aDirection = 'host-to-agent' | 'agent-to-host';

/** Receives every JSON payload exchanged with the agent, for the debug pane. */
export type A2aTrafficListener = (
  direction: A2aDirection,
  payload: Record<string, unknown>,
) => void;

/** Options of {@link A2aAgentClient}. */
export interface A2aAgentClientOptions {
  /** Observes the literal JSON-RPC requests and responses, for the debug pane. */
  readonly onTraffic?: A2aTrafficListener;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Wraps a fetch so every JSON request body and JSON response body goes to
 * `onTraffic`. Bodies that are not JSON objects (the agent card GET has no
 * body) are reported as `{method, url}` on the way out and skipped on the way
 * back unless they parse as an object.
 */
export function recordingFetch(fetchImpl: FetchLike, onTraffic: A2aTrafficListener): FetchLike {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const requestBody = typeof init?.body === 'string' ? parseJsonRecord(init.body) : null;
    onTraffic('host-to-agent', requestBody ?? {method, url});
    const response = await fetchImpl(input, init);
    const text = await response.clone().text();
    const responseBody = parseJsonRecord(text);
    if (responseBody) {
      onTraffic('agent-to-host', responseBody);
    }
    return response;
  };
}

/** Talks to the agent over A2A with the A2UI v1.0 extension header. */
export class A2aAgentClient implements AgentClient {
  private client: Promise<A2AClient> | null = null;
  private contextId: string | undefined;

  constructor(
    private readonly agentUrl: string = DEFAULT_AGENT_URL,
    private readonly options: A2aAgentClientOptions = {},
  ) {}

  private getClient(): Promise<A2AClient> {
    const base = new URL(this.agentUrl);
    const rewriteFetch: FetchLike = async (url, init) => {
      const target = new URL(String(url), this.agentUrl);
      target.protocol = base.protocol;
      target.host = base.host;
      const headers = new Headers(init?.headers);
      headers.set('X-A2A-Extensions', A2UI_EXTENSION_URI);
      return fetch(target, {...init, headers});
    };
    const {onTraffic} = this.options;
    this.client ??= A2AClient.fromCardUrl(`${this.agentUrl}/.well-known/agent-card.json`, {
      fetchImpl: onTraffic ? recordingFetch(rewriteFetch, onTraffic) : rewriteFetch,
    });
    return this.client;
  }

  async send(parts: readonly Part[]): Promise<AgentReply> {
    const client = await this.getClient();
    const response = await client.sendMessage({
      message: {
        kind: 'message',
        messageId: crypto.randomUUID(),
        role: 'user',
        parts: [...parts],
        ...(this.contextId ? {contextId: this.contextId} : {}),
      },
    });
    if ('error' in response) {
      throw new Error(response.error.message);
    }
    const result = response.result as Task | Message;
    this.contextId = result.contextId ?? this.contextId;
    if (result.kind === 'message') {
      return partsToReply(result.parts);
    }
    return partsToReply(result.status.message?.parts ?? []);
  }
}
