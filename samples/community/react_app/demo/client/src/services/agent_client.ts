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

/** The demo agent's HTTP API: chat turns streamed as server-sent events, and renderer messages. */

/** Usage of one turn, summed over its attempts. */
export interface TurnUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
}

/** One model call of a turn: the first try, or the retry after validation errors. */
export interface AttemptDebug {
  attempt: number;
  ok: boolean;
  errors: string[];
  express: string;
  messageCount: number;
  durationMs: number;
  firstTokenMs: number | null;
  usage: TurnUsage;
}

/** A `ReactApp` component the turn sent, as the model wrote it. */
export interface ReactAppDebug {
  surfaceId: string;
  id: string;
  title?: string;
  source: string;
  dataPaths?: string[];
  functions?: string[];
}

/** The `debug` event: everything the explanation panels show about a turn. */
export interface TurnDebug {
  turnId: string;
  model: string;
  mode: 'live' | 'replay';
  promptChars: number;
  express: string;
  messages: Array<Record<string, unknown>>;
  reactApps: ReactAppDebug[];
  attempts: AttemptDebug[];
  retries: number;
  ok: boolean;
  /** Agent checkpoints, epoch milliseconds. */
  timings: Record<string, number>;
  usage: TurnUsage;
}

/** The events of a chat turn, by SSE event name. */
export type AgentEvent =
  | {
      type: 'turn';
      data: {turnId: string; model: string; mode: string; promptChars: number; receivedAt: number};
    }
  | {type: 'timing'; data: {checkpoint: string; at: number}}
  | {type: 'text'; data: {text: string}}
  | {type: 'a2ui'; data: {message: Record<string, unknown>; attempt: number}}
  | {
      type: 'app_pending';
      data: {attempt: number; index: number; title: string | null; height: number | null};
    }
  | {type: 'retry'; data: {attempt: number; errors: string[]}}
  | {type: 'restore_surface'; data: {surfaceId: string}}
  | {type: 'debug'; data: TurnDebug}
  | {type: 'error'; data: {message: string; errors?: string[]}}
  | {type: 'done'; data: {turnId?: string; ok: boolean}};

/** What the client sends for one turn. */
export type ChatRequest =
  | {conversationId: string; text: string}
  | {conversationId: string; action: Record<string, unknown>}
  | {conversationId: string; appError: AppErrorReport};

/** An app that failed in the browser, sent to the agent for one repair turn. */
export interface AppErrorReport {
  surfaceId: string | null;
  componentId: string | null;
  phase: string;
  message: string;
}

/**
 * Posts a chat turn and calls `onEvent` for every event of its SSE response.
 * Resolves when the stream ends.
 */
export async function streamChat(
  request: ChatRequest,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Accept: 'text/event-stream'},
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`The agent answered HTTP ${response.status}.`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) {
      break;
    }
    buffer += value;
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const event = parseEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event) {
        onEvent(event);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

/** Parses one SSE event block (`event:` and `data:` lines). */
export function parseEvent(block: string): AgentEvent | null {
  let type = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (data.length === 0) {
    return null;
  }
  return {type, data: JSON.parse(data.join('\n'))} as AgentEvent;
}

/** Sends a renderer-to-agent message (such as `callAgentFunction`) and returns the replies. */
export async function sendRendererMessage(
  conversationId: string,
  message: unknown,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const response = await fetch('/api/renderer-message', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({conversationId, message}),
    signal,
  });
  if (!response.ok) {
    throw new Error(`The agent answered HTTP ${response.status}.`);
  }
  const body = (await response.json()) as {replies?: unknown[]};
  return body.replies ?? [];
}
