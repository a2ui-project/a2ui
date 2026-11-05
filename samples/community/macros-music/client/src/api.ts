/*
 * Copyright 2026 Google LLC
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

/** Types and calls for the Liner Notes agent's HTTP API. */

import type {ProcessableMessage} from '@a2ui/web_core';

export interface AgentInfo {
  mode: 'live' | 'scripted';
  model: string;
  protocolVersion: string;
  catalogIds: string[];
  musicCatalogId: string;
  examplePrompts: string[];
}

export interface MacroInfo {
  name: string;
  description: string;
  parameters: string[];
  basicComponents: string[];
  musicComponents: string[];
}

export interface TurnDebug {
  mode: 'live' | 'scripted' | 'action';
  model: string | null;
  modelOutput: string;
  latencyMs: number;
  toolCalls: {name: string; args: Record<string, unknown>}[];
  macroCalls: string[];
  inferenceComponentCount: number;
  transportComponentCount: number;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}

export interface AgentTurn {
  surfaceId: string;
  text: string;
  messages: ProcessableMessage[];
  debug: TurnDebug;
}

export interface ActionRequest {
  name: string;
  context: Record<string, unknown>;
  userMessage?: string;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export const api = {
  info: () => request<AgentInfo>('/api/info'),
  macros: () => request<MacroInfo[]>('/api/macros'),
  chat: (conversationId: string, prompt: string) =>
    request<AgentTurn>('/api/chat', {conversationId, prompt}),
  action: (conversationId: string, action: ActionRequest) =>
    request<AgentTurn>('/api/action', {conversationId, ...action}),
};
