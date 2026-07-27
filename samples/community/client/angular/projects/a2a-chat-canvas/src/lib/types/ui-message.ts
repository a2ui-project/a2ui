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
import {Artifact, Part} from '@a2a-js/sdk';

/**
 * Represents a single message in the UI, either from the user or the agent.
 */
export interface UiMessage {
  readonly type: 'ui_message';
  /** Unique identifier for the message. */
  readonly id: string;
  /** Identifier for the conversation context. */
  readonly contextId: string;
  /** The role of the message sender (agent or user). */
  readonly role: Role;
  /** Array of content parts that make up this message. */
  readonly contents: UiMessageContent[];
  /** The current status of the message. */
  readonly status: UiMessageStatus;
  /** ISO timestamp of when the message was created. */
  readonly created: string;
  /** ISO timestamp of when the message was last updated. */
  readonly lastUpdated: string;
}

/**
 * Represents the sender of a message, either an agent or a user.
 */
export type Role = UiAgent | UiUser;

/**
 * Represents an agent sender.
 */
export interface UiAgent {
  readonly type: 'ui_agent';
  /** The name of the agent. */
  readonly name: string;
  /** The URL of the agent's icon. */
  readonly iconUrl: string;
  /** The display name of the sub-agent. */
  readonly subagentName?: string;
  /** The URL of the sub-agent's icon. */
  readonly subagentIconUrl?: string;
}

/**
 * Represents a user sender.
 */
export interface UiUser {
  readonly type: 'ui_user';
}

/**
 * Represents a single piece of content within a UiMessage.
 */
export interface UiMessageContent {
  readonly type: 'ui_message_content';
  /** Unique identifier for this content part. */
  readonly id: string;
  /** The raw A2A Part or Artifact data. */
  readonly data: Part | Artifact;
  /** The variant key used to determine how to render this content. */
  readonly variant: string;
}

/**
 * Possible statuses for a UiMessage.
 */
export type UiMessageStatus = 'completed' | 'pending' | 'cancelled';
