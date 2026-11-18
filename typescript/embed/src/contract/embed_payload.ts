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

import type {AgentToRendererMessage} from '@a2ui/web_core/v1_0';
import {z} from 'zod';
import {checkContractVersion} from './contract_version.js';

/** The `structuredContent` key that holds the {@link EmbedPayload} in a tool result. */
export const A2UI_STRUCTURED_KEY = 'a2ui';

/** The A2UI content of a tool result, read by the app from `structuredContent.a2ui`. */
export interface EmbedPayload {
  /** The contract version the server speaks. */
  contractVersion: string;
  /** The A2UI v1.0 messages to apply, in order. */
  messages: AgentToRendererMessage[];
  /** A message the app posts to the conversation on the user's behalf. */
  followUp?: {text: string};
}

/**
 * The shape of an {@link EmbedPayload}. Messages are only checked to be A2UI v1.0 message objects;
 * the server and the app validate their content against the protocol and catalog schemas.
 */
export const EmbedPayloadSchema = z.object({
  contractVersion: z.string(),
  messages: z.array(z.object({version: z.literal('1.0')}).passthrough()),
  followUp: z.object({text: z.string()}).optional(),
});

/** A tool result that carries an {@link EmbedPayload}, as built by {@link toToolResult}. */
export type EmbedToolResult = {
  content: Array<{type: 'text'; text: string}>;
  structuredContent: {[A2UI_STRUCTURED_KEY]: EmbedPayload};
};

/**
 * Builds a tool result that gives the model `text` and the app `payload`. Only `content` reaches
 * the model; MCP Apps hosts keep `structuredContent` out of the model context.
 */
export function toToolResult({
  text,
  payload,
}: {
  text: string;
  payload: EmbedPayload;
}): EmbedToolResult {
  return {
    content: [{type: 'text', text}],
    structuredContent: {[A2UI_STRUCTURED_KEY]: payload},
  };
}

/** Why {@link readEmbedPayload} could not read a payload. */
export type EmbedPayloadErrorCode =
  /** The tool result has no `structuredContent.a2ui`. */
  | 'missing'
  /** The payload speaks an incompatible contract version. */
  | 'unsupported-version'
  /** The payload does not have the {@link EmbedPayload} shape. */
  | 'invalid';

/** The outcome of {@link readEmbedPayload}. */
export type ReadEmbedPayloadResult =
  | {ok: true; payload: EmbedPayload}
  | {ok: false; code: EmbedPayloadErrorCode; message: string};

/**
 * Reads the {@link EmbedPayload} from a tool result's `structuredContent.a2ui`. Never throws: a
 * missing, incompatible or malformed payload is reported as an error result. The contract version
 * is checked before the rest of the payload, so a newer major version is reported as
 * `unsupported-version` even when its shape changed.
 */
export function readEmbedPayload(
  toolResult: {readonly structuredContent?: unknown} | null | undefined,
): ReadEmbedPayloadResult {
  const structuredContent = toolResult?.structuredContent;
  const raw = isRecord(structuredContent) ? structuredContent[A2UI_STRUCTURED_KEY] : undefined;
  if (raw === undefined) {
    return {
      ok: false,
      code: 'missing',
      message: `The tool result has no structuredContent.${A2UI_STRUCTURED_KEY}.`,
    };
  }
  if (isRecord(raw) && typeof raw['contractVersion'] === 'string') {
    const versionCheck = checkContractVersion(raw['contractVersion']);
    if (!versionCheck.ok) {
      return {ok: false, code: 'unsupported-version', message: versionCheck.reason};
    }
  }
  const parsed = EmbedPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      code: 'invalid',
      message: `Invalid ${A2UI_STRUCTURED_KEY} payload: ${details}`,
    };
  }
  // The messages are only shallowly checked here; their content is validated when applied.
  return {ok: true, payload: parsed.data as EmbedPayload};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
