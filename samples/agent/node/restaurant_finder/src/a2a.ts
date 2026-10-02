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

import * as crypto from 'crypto';

import type {DataPart, Message, Part, Task, TaskStatusUpdateEvent} from '@a2a-js/sdk';
import type {ExecutionEventBus, RequestContext} from '@a2a-js/sdk/server';
import type {ResponsePart} from '@a2ui/agent';

/** The MIME type of every A2UI data part, in v0.9.1 and v1.0. */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/** Converts a parsed response part to A2A parts, one data part per A2UI message. */
export function toA2aParts(part: ResponsePart): Part[] {
  if (part.type === 'text') {
    return [{kind: 'text', text: part.text}];
  }
  return part.a2ui.map(
    (msg): DataPart => ({
      kind: 'data',
      data: msg as unknown as Record<string, unknown>,
      metadata: {mimeType: A2UI_MIME_TYPE},
    }),
  );
}

/** A UI action carried by an inbound message. */
export interface UiAction {
  /** The action's name, if it has one. */
  name?: string;
  /** The action's context; empty when the message carries none. */
  context: Record<string, unknown>;
}

/** What an inbound A2A message carries, before the agent interprets it. */
export interface InboundMessage {
  /** The message's text parts, joined. Empty when there are none. */
  text: string;
  /** The UI action the message carries, if any. */
  action?: UiAction;
  /** False when the client wants every part in the final status instead of streamed. */
  useStreaming: boolean;
}

/**
 * Reads the text, the UI action and the streaming preference from an inbound message.
 *
 * A data part carries the action as `action` when its `version` is the one the agent
 * answers in, or as a legacy `userAction` otherwise. When several parts carry one, the
 * last wins.
 */
export function readInboundMessage(message: Message, version: string): InboundMessage {
  let useStreaming = true;
  let rawAction: Record<string, unknown> | undefined;
  const texts: string[] = [];

  for (const part of message.parts ?? []) {
    if ('text' in part && typeof part.text === 'string' && part.text) {
      texts.push(part.text);
    }
    if ('data' in part && typeof part.data === 'object' && part.data !== null) {
      const data = part.data as Record<string, unknown>;
      if (typeof data.useStreaming === 'boolean') {
        useStreaming = data.useStreaming;
      }
      if (data.version === version && data.action && typeof data.action === 'object') {
        rawAction = data.action as Record<string, unknown>;
      } else if (data.userAction && typeof data.userAction === 'object') {
        rawAction = data.userAction as Record<string, unknown>;
      }
    }
  }

  const action: UiAction | undefined = rawAction && {
    name: typeof rawAction.name === 'string' ? rawAction.name : undefined,
    context:
      typeof rawAction.context === 'object' && rawAction.context !== null
        ? (rawAction.context as Record<string, unknown>)
        : {},
  };
  return {text: texts.join(''), action, useStreaming};
}

/** Publishes the A2A events of one task: its creation and its status updates. */
export class TaskEvents {
  constructor(
    private readonly eventBus: ExecutionEventBus,
    private readonly requestContext: RequestContext,
  ) {}

  /** Announces the task, unless it already exists from an earlier turn. */
  start(): void {
    const {taskId, contextId, userMessage, task} = this.requestContext;
    if (task) {
      return;
    }
    const initialTask: Task = {
      kind: 'task',
      id: taskId,
      contextId,
      status: {state: 'submitted', timestamp: new Date().toISOString()},
      history: [userMessage],
    };
    this.eventBus.publish(initialTask);
  }

  /**
   * Publishes a status update for this task, with a message when there are parts.
   *
   * Failures go through here too. The A2A SDK publishes its own failure when `execute`
   * rejects, but in a stream it labels a first turn's failure with a new random task id,
   * which the client cannot match to the task this executor already announced.
   */
  status(
    state: TaskStatusUpdateEvent['status']['state'],
    final: boolean,
    parts: Part[] = [],
  ): void {
    const {taskId, contextId} = this.requestContext;
    const message: Message | undefined =
      parts.length > 0
        ? {kind: 'message', role: 'agent', messageId: crypto.randomUUID(), taskId, contextId, parts}
        : undefined;
    const event: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {state, timestamp: new Date().toISOString(), ...(message ? {message} : {})},
      final,
    };
    this.eventBus.publish(event);
  }
}
