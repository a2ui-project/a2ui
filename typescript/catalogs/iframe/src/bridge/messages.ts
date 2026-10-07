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
 * Wire format of the `a2ui_*` protocol between a host and a web app frame, as defined in the
 * WebApp iframe component specification (`catalogs/iframe/web_app_frame_specification.md`).
 */

import {z} from 'zod';
import type {FrameHostContext} from '../shared/sandbox/frame_sizing.js';

/**
 * Message types of the protocol. The handshake types travel over ambient `postMessage`; the rest
 * travel over the dedicated `MessagePort` established by `a2ui_app_frame_init`.
 */
export const A2uiMessageType = {
  Action: 'a2ui_action',
  DataModelChange: 'a2ui_data_model_change',
  DataModelUpdate: 'a2ui_data_model_update',
  FunctionCall: 'a2ui_function_call',
  FunctionResult: 'a2ui_function_result',
  SandboxProxyReady: 'a2ui_sandbox_proxy_ready',
  SandboxResourceReady: 'a2ui_sandbox_resource_ready',
  AppFrameReady: 'a2ui_app_frame_ready',
  AppFrameInit: 'a2ui_app_frame_init',
  SizeChanged: 'a2ui_size_changed',
  HostContextUpdate: 'a2ui_host_context_update',
} as const;

/** Messages the host accepts from the frame, discriminated on `type`. */
export const IncomingWebFrameMessageSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal(A2uiMessageType.SandboxProxyReady)}),
  z.object({type: z.literal(A2uiMessageType.AppFrameReady)}),
  z.object({
    type: z.literal(A2uiMessageType.Action),
    action: z.string(),
    data: z.unknown().optional(),
  }),
  z.object({
    type: z.literal(A2uiMessageType.DataModelChange),
    key: z.string(),
    subpath: z.string().optional(),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal(A2uiMessageType.FunctionCall),
    call: z.string(),
    callId: z.union([z.string(), z.number()]),
    args: z.unknown().optional(),
  }),
  z.object({
    type: z.literal(A2uiMessageType.SizeChanged),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
]);

export type IncomingWebFrameMessage = z.infer<typeof IncomingWebFrameMessageSchema>;

export type ActionMessage = Extract<IncomingWebFrameMessage, {type: 'a2ui_action'}>;
export type DataModelChangeMessage = Extract<
  IncomingWebFrameMessage,
  {type: 'a2ui_data_model_change'}
>;
export type FunctionCallMessage = Extract<IncomingWebFrameMessage, {type: 'a2ui_function_call'}>;
export type SizeChangedMessage = Extract<IncomingWebFrameMessage, {type: 'a2ui_size_changed'}>;

/**
 * Properties the frame components share, in the shape the catalog declares them. Component
 * schemas extend it with their content property.
 */
export const WebAppFrameBasePropsSchema = z.object({
  config: z.record(z.unknown()).optional(),
  data: z.object({paths: z.record(z.string())}).optional(),
  allowedEvents: z.record(z.unknown()).optional(),
  allowedFunctions: z.record(z.unknown()).optional(),
  mutableData: z.record(z.unknown()).optional(),
  disableSchemaValidation: z.boolean().optional(),
});

export type WebAppFrameBaseProps = z.infer<typeof WebAppFrameBasePropsSchema>;

/** First message on the channel: static configuration, initial data and the allowlists. */
export interface AppFrameInitMessage {
  readonly type: typeof A2uiMessageType.AppFrameInit;
  readonly value: {
    readonly config: Readonly<Record<string, unknown>>;
    readonly initialData: Readonly<Record<string, unknown>>;
    readonly allowedEvents: Readonly<Record<string, unknown>>;
    readonly allowedFunctions: Readonly<Record<string, unknown>>;
    readonly mutableDataKeys: readonly string[];
    readonly hostContext: FrameHostContext;
  };
}

/** A bound value, or one field of it, changed in the host data model. */
export interface DataModelUpdateMessage {
  readonly type: typeof A2uiMessageType.DataModelUpdate;
  readonly key: string;
  readonly subpath?: string;
  readonly value: unknown;
}

/** Why a function call did not produce a result. */
export type FunctionErrorCode = 'NOT_ALLOWED' | 'VALIDATION_ERROR' | 'EXECUTION_ERROR';

/** Reply to an `a2ui_function_call`. */
export interface FunctionResultMessage {
  readonly type: typeof A2uiMessageType.FunctionResult;
  readonly call: string;
  readonly callId: string | number;
  readonly status: 'success' | 'error';
  readonly result?: unknown;
  readonly error?: {readonly code: FunctionErrorCode; readonly message: string};
}

/** The host container changed size. */
export interface HostContextUpdateMessage {
  readonly type: typeof A2uiMessageType.HostContextUpdate;
  readonly value: FrameHostContext;
}

/** Messages the host sends to the frame over the channel (or, for init, the frame window). */
export type OutgoingWebFrameMessage =
  | AppFrameInitMessage
  | DataModelUpdateMessage
  | FunctionResultMessage
  | HostContextUpdateMessage;
