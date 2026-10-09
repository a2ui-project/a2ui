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
 * in `catalogs/mcp/v1/mcp_app_specification.md`: `tools/call` requests are dispatched as A2UI actions
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
  /**
   * Optional executor for authorized `tools/call` requests. When provided, its `CallToolResult`
   * is returned directly to the guest app after dispatching the corresponding A2UI action.
   */
  readonly callTool?: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  /**
   * Optional handler for `ui/open-link` requests after the URL scheme (`http:` or `https:`) is
   * validated. Defaults to opening the URL in a new tab with `noopener,noreferrer`.
   */
  readonly openLink?: (url: string) => void | Promise<void>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalizes a bound `toolResult` value from the A2UI data model into a standard MCP
 * `CallToolResult`. Values that already carry a `content` array are forwarded as-is; plain
 * objects and primitives are wrapped with both a JSON text block and `structuredContent` so
 * views reading either `result.content` or `result.structuredContent` work out of the box.
 */
function toCallToolResult(value: unknown): CallToolResult {
  if (isRecord(value) && Array.isArray(value['content'])) {
    return value as CallToolResult;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return {
    content: [{type: 'text', text}],
    ...(isRecord(value) ? {structuredContent: value} : {}),
  };
}

function resolveHostTheme(): 'light' | 'dark' {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/** The host context in the shape of the protocol: theme, display mode, locale, timezone, platform, and container dimensions. */
function toHostContext(context: FrameHostContext): McpUiHostContext {
  return {
    theme: resolveHostTheme(),
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    locale: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    platform: 'web',
    containerDimensions: {...context.containerDimensions},
  };
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
  private stopThemeObserver: (() => void) | null = null;
  private initialized = false;
  private lastSentToolInputJson: string | null = null;
  private lastSentToolResultJson: string | null = null;

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
      this.initialized = true;
      this.sendBoundData();
    };
    bridge.oncalltool = async params => this.handleToolCall(params);
    bridge.onopenlink = async params => this.handleOpenLink(params.url);
    bridge.onmessage = async params => this.handleMessage(params);
    bridge.onrequestdisplaymode = async () => ({mode: 'inline'});
    bridge.onupdatemodelcontext = async params => {
      this.handleUpdateModelContext(params);
      return {};
    };
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
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const onThemeChange = () => {
        bridge.setHostContext(toHostContext(measureHostContext(frame)));
      };
      mediaQuery.addEventListener?.('change', onThemeChange);
      this.stopThemeObserver = () => {
        mediaQuery.removeEventListener?.('change', onThemeChange);
      };
    }
  }

  /** Stops watching the frame, unsubscribes from the data model and closes the transport. */
  dispose(): void {
    this.stopHostContextObserver?.();
    this.stopHostContextObserver = null;
    this.stopThemeObserver?.();
    this.stopThemeObserver = null;
    this.dataSync?.dispose();
    this.dataSync = null;
    this.initialized = false;
    this.lastSentToolInputJson = null;
    this.lastSentToolResultJson = null;
    const bridge = this.appBridge;
    this.appBridge = null;
    bridge?.close().catch((error: unknown) => {
      console.error(`${LOG_PREFIX} Failed to close the app bridge:`, error);
    });
  }

  /**
   * Sends the current value of every bound path once the app is initialized, so an app that
   * renders bound state does not have to wait for the first change. Also emits the standard MCP
   * Apps `ui/notifications/tool-input` and `ui/notifications/tool-result` notifications for
   * standard `@modelcontextprotocol/ext-apps` views.
   */
  private sendBoundData(): void {
    for (const [key, path] of Object.entries(this.dataPaths)) {
      this.sendDataModelUpdate({key, value: this.options.host.getData(path)});
    }
    this.sendStandardToolNotifications();
  }

  private sendStandardToolNotifications(): void {
    const toolInputArgs = this.buildToolInputArguments();
    if (toolInputArgs !== null) {
      this.sendToolInput(toolInputArgs);
    } else if ('toolResult' in this.dataPaths) {
      this.sendToolInput({});
    }
    const toolResultPath = this.dataPaths['toolResult'];
    if (toolResultPath !== undefined) {
      const resultValue = this.options.host.getData(toolResultPath);
      if (resultValue !== undefined) {
        this.sendToolResult(resultValue);
      }
    }
  }

  private buildToolInputArguments(): Record<string, unknown> | null {
    const explicitToolInputPath = this.dataPaths['toolInput'];
    if (explicitToolInputPath !== undefined) {
      const raw = this.options.host.getData(explicitToolInputPath);
      if (raw === undefined) {
        return null;
      }
      return isRecord(raw) ? {...raw} : {value: raw};
    }
    const entries = Object.entries(this.dataPaths).filter(
      ([key]) => key !== 'toolResult' && key !== 'modelContext',
    );
    if (entries.length === 0) {
      return null;
    }
    const args: Record<string, unknown> = {};
    for (const [key, path] of entries) {
      args[key] = this.options.host.getData(path);
    }
    return args;
  }

  private sendToolInput(args: Record<string, unknown>): void {
    const bridge = this.appBridge;
    if (!bridge) {
      return;
    }
    const serialized = JSON.stringify(args);
    if (serialized === this.lastSentToolInputJson) {
      return;
    }
    this.lastSentToolInputJson = serialized;
    bridge.sendToolInput({arguments: args}).catch((error: unknown) => {
      console.error(`${LOG_PREFIX} Failed to send tool-input:`, error);
    });
  }

  private sendToolResult(value: unknown): void {
    const bridge = this.appBridge;
    if (!bridge) {
      return;
    }
    const serialized = JSON.stringify(value);
    if (serialized === this.lastSentToolResultJson) {
      return;
    }
    this.lastSentToolResultJson = serialized;
    bridge.sendToolResult(toCallToolResult(value)).catch((error: unknown) => {
      console.error(`${LOG_PREFIX} Failed to send tool-result:`, error);
    });
  }

  private sendUpdate(update: DataModelUpdate): void {
    this.sendDataModelUpdate(update);
    if (!this.initialized) {
      return;
    }
    if (update.key === 'toolResult') {
      const toolResultPath = this.dataPaths['toolResult'];
      if (toolResultPath !== undefined) {
        const resultValue = this.options.host.getData(toolResultPath);
        if (resultValue !== undefined) {
          this.sendToolResult(resultValue);
        }
      }
      return;
    }
    const toolInputArgs = this.buildToolInputArguments();
    if (toolInputArgs !== null) {
      this.sendToolInput(toolInputArgs);
    }
  }

  /**
   * Posts a `ui/notifications/data-model-update` notification. The A2UI extension methods are
   * not part of the `AppBridge` notification types, so they go through the transport directly,
   * which is what `AppBridge.notification` does for its own notifications.
   */
  private sendDataModelUpdate(update: DataModelUpdate): void {
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

  private handleUpdateModelContext(params: {
    structuredContent?: Record<string, unknown>;
    content?: unknown;
  }): void {
    const {structuredContent, content} = params;
    if (structuredContent === undefined && content === undefined) {
      return;
    }
    if ('modelContext' in this.dataPaths) {
      const value =
        structuredContent !== undefined && content !== undefined
          ? {content, structuredContent}
          : (structuredContent ?? content);
      this.handleDataModelChange({
        key: 'modelContext',
        value,
      });
    }
    if (structuredContent) {
      for (const [key, value] of Object.entries(structuredContent)) {
        if (key in this.dataPaths && key !== 'modelContext') {
          this.handleDataModelChange({key, value});
        }
      }
    }
  }

  private async handleOpenLink(url: string): Promise<{isError?: boolean}> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      console.warn(`${LOG_PREFIX} Invalid URL in ui/open-link:`, url);
      return {isError: true};
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn(`${LOG_PREFIX} Disallowed URL protocol in ui/open-link:`, parsed.protocol);
      return {isError: true};
    }
    if (this.options.openLink) {
      await this.options.openLink(parsed.href);
    } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(parsed.href, '_blank', 'noopener,noreferrer');
    }
    return {};
  }

  private async handleMessage(params: {
    role: string;
    content: unknown;
  }): Promise<Record<string, never>> {
    const payload = {role: params.role, content: params.content};
    const security = validateMessageSecurity(payload);
    if (!security.valid) {
      throw new McpError(ErrorCode.InvalidParams, `Message payload rejected: ${security.reason}`);
    }
    Promise.resolve()
      .then(() => this.options.host.dispatchAction('a2ui.mcpAppMessage', payload))
      .catch((error: unknown) => {
        console.error(`${LOG_PREFIX} Failed to dispatch a2ui.mcpAppMessage action:`, error);
      });
    return {};
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
    if (this.options.callTool) {
      try {
        return await this.options.callTool(params.name, args);
      } catch (error) {
        return {
          content: [{type: 'text', text: errorMessage(error)}],
          isError: true,
        };
      }
    }
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
