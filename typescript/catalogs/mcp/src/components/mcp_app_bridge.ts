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
 * Host side of the MCP Apps protocol for one `McpApp` frame. An `AppBridge` from
 * `@modelcontextprotocol/ext-apps` handles the standard protocol (the `ui/initialize` handshake,
 * `ui/notifications/size-changed`, logging, host context) over a `PostMessageTransport` to the
 * sandbox proxy. On top of it, this bridge implements the A2UI extension of the protocol described
 * in `catalogs/mcp/mcp_app_specification.md`: `tools/call` requests are dispatched as A2UI actions
 * when `allowedTools` lists the tool, `ui/requests/function-call` requests run catalog functions
 * when `allowedFunctions` lists the function and its arguments match the function's JSON Schema,
 * and the paths of `data.paths` are kept in sync both ways with `ui/notifications/data-model-update`
 * and `ui/notifications/data-model-change`.
 */

import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ErrorCode,
  McpError,
  type CallToolRequest,
  type CallToolResult,
  type Implementation,
  type LoggingMessageNotification,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {DataModelSync, type DataModelUpdate} from '../shared/sandbox/data_model_sync.js';
import type {FrameHost} from '../shared/sandbox/frame_host.js';
import {
  measureHostContext,
  observeHostContext,
  type FrameHostContext,
} from '../shared/sandbox/frame_sizing.js';
import {FORBIDDEN_PROTOTYPE_KEYS, validateMessageSecurity} from '../shared/sandbox/security.js';
import {PayloadValidator} from './payload_validation.js';

const LOG_PREFIX = '[McpApp]';

/** Method of the notification an app sends to write a bound value into the data model. */
export const DATA_MODEL_CHANGE_METHOD = 'ui/notifications/data-model-change';
/** Method of the notification the host sends when a bound value changes. */
export const DATA_MODEL_UPDATE_METHOD = 'ui/notifications/data-model-update';
/** Method of the request an app sends to run a catalog function. */
export const FUNCTION_CALL_METHOD = 'ui/requests/function-call';

/** `ui/notifications/data-model-change`: the app asks for a write to a bound path. */
export const DataModelChangeNotificationSchema = z.object({
  method: z.literal(DATA_MODEL_CHANGE_METHOD),
  params: z.object({
    key: z.string(),
    subpath: z.string().optional(),
    value: z.unknown(),
  }),
});

/** `ui/requests/function-call`: the app asks the host to run a catalog function. */
export const FunctionCallRequestSchema = z.object({
  method: z.literal(FUNCTION_CALL_METHOD),
  params: z.object({
    call: z.string(),
    args: z.record(z.unknown()).optional(),
  }),
});

/** The successful result of a `ui/requests/function-call` request. */
export interface FunctionCallResult {
  readonly status: 'success';
  readonly result: unknown;
  readonly [key: string]: unknown;
}

/** Name and version the host announces to the app in the `ui/initialize` result. */
export const DEFAULT_MCP_APP_HOST_INFO: Implementation = {name: 'A2UI McpApp', version: '1.0.0'};

/**
 * Capabilities announced to the app. `serverTools` is what lets the app call tools; the calls go
 * to the tool-call handler, which dispatches the allowed ones as actions.
 */
const HOST_CAPABILITIES = {openLinks: {}, logging: {}, serverTools: {}};

/** The properties of a `McpApp` component the bridge reads. */
export interface McpAppBridgeProps {
  /** Names of the tools the app may call; each call becomes an action of that name. */
  readonly allowedTools?: readonly string[];
  /** Catalog functions the app may call, each with the JSON Schema of its arguments. */
  readonly allowedFunctions?: Readonly<Record<string, unknown>>;
  /** The component's `data.paths`: binding key to JSON pointer in the data model. */
  readonly dataPaths?: Readonly<Record<string, string>>;
}

/** Inputs of {@link McpAppBridge}. */
export interface McpAppBridgeOptions {
  /** The frame that loads the sandbox proxy. */
  readonly frame: HTMLIFrameElement;
  /** The surface side: data model access, catalog functions and action dispatch. */
  readonly host: FrameHost;
  /**
   * Returns the component's current properties. The allowlists are read on every request, so a
   * change applies at once; the data paths are read when the bridge starts.
   */
  readonly getProps: () => McpAppBridgeProps;
  /** Applies a size the app asks for through `ui/notifications/size-changed`. */
  readonly onSizeChange?: (width?: number, height?: number) => void;
  /** Overrides {@link DEFAULT_MCP_APP_HOST_INFO}. */
  readonly hostInfo?: Implementation;
  /**
   * The transport to the app. Defaults to a `PostMessageTransport` that posts to the frame's
   * window and accepts messages from it only; tests inject an in-memory one.
   */
  readonly transport?: Transport;
}

function subpathHasForbiddenSegment(subpath: string | undefined): boolean {
  return (subpath ?? '')
    .split('/')
    .some(segment =>
      FORBIDDEN_PROTOTYPE_KEYS.has(
        segment.replace(/~([01])/g, (_, p1) => (p1 === '1' ? '/' : '~')),
      ),
    );
}

function logAppMessage(params: LoggingMessageNotification['params']): void {
  const message = `${LOG_PREFIX} App log (${params.level}):`;
  switch (params.level) {
    case 'error':
    case 'critical':
    case 'alert':
    case 'emergency':
      console.error(message, params.data);
      break;
    case 'warning':
      console.warn(message, params.data);
      break;
    default:
      console.log(message, params.data);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The host context in the shape of the protocol: the container dimensions of the frame. */
function toHostContext(context: FrameHostContext): McpUiHostContext {
  return {containerDimensions: {...context.containerDimensions}};
}

/**
 * Connects one `McpApp` frame to its surface. {@link start} creates the `AppBridge` and its
 * transport, subscribes to the bound data paths and starts watching the frame's size;
 * {@link dispose} undoes all of it. An instance is used once: the component creates a new one
 * whenever the frame content or the context changes, so a reloaded app always talks to a fresh
 * bridge.
 */
export class McpAppBridge {
  private readonly validator = new PayloadValidator();
  private appBridge: AppBridge | null = null;
  private dataSync: DataModelSync | null = null;
  private dataPaths: Readonly<Record<string, string>> = {};
  private stopHostContextObserver: (() => void) | null = null;

  constructor(private readonly options: McpAppBridgeOptions) {}

  /** Starts the bridge. Does nothing when the frame has no window yet or the bridge already runs. */
  start(): void {
    if (this.appBridge) {
      return;
    }
    const {frame, host} = this.options;
    const transport = this.options.transport ?? createFrameTransport(frame);
    if (!transport) {
      return;
    }

    const bridge = new AppBridge(
      null,
      this.options.hostInfo ?? DEFAULT_MCP_APP_HOST_INFO,
      HOST_CAPABILITIES,
      {hostContext: toHostContext(measureHostContext(frame))},
    );
    this.appBridge = bridge;
    bridge.onerror = error => {
      console.warn(`${LOG_PREFIX} Bridge error:`, error.message);
    };
    bridge.onloggingmessage = logAppMessage;
    bridge.onsizechange = ({width, height}) => {
      this.options.onSizeChange?.(width, height);
    };
    bridge.oninitialized = () => {
      this.sendBoundData();
    };
    bridge.oncalltool = async params => this.handleToolCall(params);
    bridge.setNotificationHandler(DataModelChangeNotificationSchema, notification => {
      this.handleDataModelChange(notification.params);
    });
    bridge.setRequestHandler(FunctionCallRequestSchema, request =>
      this.handleFunctionCall(request.params),
    );

    this.dataPaths = this.options.getProps().dataPaths ?? {};
    this.dataSync = new DataModelSync({
      host,
      paths: this.dataPaths,
      sendUpdate: update => this.sendUpdate(update),
    });
    this.dataSync.start();

    bridge.connect(transport).catch((error: unknown) => {
      console.error(`${LOG_PREFIX} Failed to connect to the app:`, error);
    });
    this.stopHostContextObserver = observeHostContext(frame, context => {
      bridge.setHostContext(toHostContext(context));
    });
  }

  /** Stops watching the frame, unsubscribes from the data model and closes the transport. */
  dispose(): void {
    this.stopHostContextObserver?.();
    this.stopHostContextObserver = null;
    this.dataSync?.dispose();
    this.dataSync = null;
    const bridge = this.appBridge;
    this.appBridge = null;
    bridge?.close().catch((error: unknown) => {
      console.error(`${LOG_PREFIX} Failed to close the app bridge:`, error);
    });
  }

  /**
   * Sends the current value of every bound path once the app is initialized, so an app that
   * renders bound state does not have to wait for the first change.
   */
  private sendBoundData(): void {
    for (const [key, path] of Object.entries(this.dataPaths)) {
      this.sendUpdate({key, value: this.options.host.getData(path)});
    }
  }

  /**
   * Posts a `ui/notifications/data-model-update` notification. The A2UI extension methods are
   * not part of the `AppBridge` notification types, so they go through the transport directly,
   * which is what `AppBridge.notification` does for its own notifications.
   */
  private sendUpdate(update: DataModelUpdate): void {
    const transport = this.appBridge?.transport;
    if (!transport) {
      return;
    }
    const params: Record<string, unknown> = {key: update.key, value: update.value};
    if (update.subpath !== undefined) {
      params['subpath'] = update.subpath;
    }
    transport
      .send({jsonrpc: '2.0', method: DATA_MODEL_UPDATE_METHOD, params})
      .catch((error: unknown) => {
        console.error(`${LOG_PREFIX} Failed to send data-model-update for ${update.key}:`, error);
      });
  }

  private async handleToolCall(params: CallToolRequest['params']): Promise<CallToolResult> {
    const args = params.arguments ?? {};
    const security = validateMessageSecurity(args);
    if (!security.valid) {
      console.warn(`${LOG_PREFIX} Tool '${params.name}' arguments rejected:`, security.reason);
      throw new McpError(
        ErrorCode.InvalidParams,
        `Tool '${params.name}' arguments rejected: ${security.reason}`,
      );
    }
    const allowedTools = this.options.getProps().allowedTools ?? [];
    if (!allowedTools.includes(params.name)) {
      console.warn(`${LOG_PREFIX} Tool '${params.name}' is not in allowedTools`);
      throw new McpError(ErrorCode.InvalidParams, `Tool '${params.name}' is not allowed`);
    }
    // The action reaches the agent asynchronously; the app gets its answer at once, as the
    // reference host does, rather than waiting for the agent's turn.
    Promise.resolve()
      .then(() => this.options.host.dispatchAction(params.name, args))
      .catch((error: unknown) => {
        console.error(`${LOG_PREFIX} Failed to dispatch the action ${params.name}:`, error);
      });
    return {content: []};
  }

  private async handleFunctionCall(
    params: z.infer<typeof FunctionCallRequestSchema>['params'],
  ): Promise<FunctionCallResult> {
    const {call} = params;
    const args = params.args ?? {};
    const security = validateMessageSecurity(args);
    if (!security.valid) {
      console.warn(`${LOG_PREFIX} Function '${call}' arguments rejected:`, security.reason);
      throw new McpError(
        ErrorCode.InvalidParams,
        `Function '${call}' arguments rejected: ${security.reason}`,
      );
    }
    const decision = this.validator.checkAllowlist(
      call,
      args,
      this.options.getProps().allowedFunctions,
    );
    if (decision.status === 'not-listed') {
      console.warn(`${LOG_PREFIX} Function '${call}' is not in allowedFunctions`);
      throw new McpError(ErrorCode.InvalidParams, `Function '${call}' is not allowed`);
    }
    if (decision.status === 'invalid') {
      console.warn(`${LOG_PREFIX} Function '${call}' failed schema validation:`, decision.errors);
      throw new McpError(
        ErrorCode.InvalidParams,
        `Function '${call}' arguments failed schema validation`,
        {errors: decision.errors},
      );
    }
    try {
      const result = await this.options.host.invokeFunction(call, args);
      return {status: 'success', result};
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Function '${call}' failed: ${errorMessage(error)}`,
      );
    }
  }

  private handleDataModelChange(
    params: z.infer<typeof DataModelChangeNotificationSchema>['params'],
  ): void {
    const security = validateMessageSecurity(params.value);
    if (!security.valid) {
      console.warn(`${LOG_PREFIX} Data change for ${params.key} rejected:`, security.reason);
      return;
    }
    if (subpathHasForbiddenSegment(params.subpath)) {
      console.warn(`${LOG_PREFIX} Data change for ${params.key} rejected: forbidden subpath`);
      return;
    }
    const result = this.dataSync?.applyChange({
      key: params.key,
      subpath: params.subpath,
      value: params.value,
    });
    if (result === 'unbound') {
      console.warn(`${LOG_PREFIX} Data change for ${params.key} dropped: key not in data.paths`);
    }
  }
}

/** A transport to the proxy in `frame`, or null when the frame has no window yet. */
function createFrameTransport(frame: HTMLIFrameElement): Transport | null {
  const target = frame.contentWindow;
  if (!target) {
    return null;
  }
  // The first argument is where messages are posted (the proxy window); the second is the only
  // source whose messages are accepted (the same window).
  return new PostMessageTransport(target, target);
}
