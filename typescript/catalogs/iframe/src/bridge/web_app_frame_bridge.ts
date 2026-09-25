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

import {DataModelSync} from '../shared/sandbox/data_model_sync.js';
import type {FrameHost} from '../shared/sandbox/frame_host.js';
import {
  FrameSizing,
  measureHostContext,
  observeHostContext,
} from '../shared/sandbox/frame_sizing.js';
import {
  isMessageFromFrame,
  type MessageListenerTarget,
} from '../shared/sandbox/sandbox_bootstrap.js';
import {validateMessageSecurity} from '../shared/sandbox/security.js';
import {
  A2uiMessageType,
  IncomingWebFrameMessageSchema,
  type ActionMessage,
  type AppFrameInitMessage,
  type DataModelChangeMessage,
  type FunctionCallMessage,
  type FunctionResultMessage,
  type OutgoingWebFrameMessage,
} from './messages.js';
import {PayloadValidator, projectSubpathChange} from './payload_validation.js';

const LOG_PREFIX = '[WebAppFrameBridge]';

/** The component properties the bridge reads; read again for every message, so they can change. */
export interface WebAppFrameBridgeProps {
  /** Static configuration handed to the app in the handshake. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Binding key to absolute data model path (`data.paths`). */
  readonly dataPaths?: Readonly<Record<string, string>>;
  /** Action name to JSON Schema of its payload. */
  readonly allowedEvents?: Readonly<Record<string, unknown>>;
  /** Function name to JSON Schema of its arguments. */
  readonly allowedFunctions?: Readonly<Record<string, unknown>>;
  /** Binding key the app may write, to JSON Schema of the whole bound value. */
  readonly mutableData?: Readonly<Record<string, unknown>>;
  /** Skips the JSON Schema checks; the allowlists still apply. */
  readonly disableSchemaValidation?: boolean;
}

/** Inputs of {@link WebAppFrameBridge}. */
export interface WebAppFrameBridgeOptions {
  /** The frame that loads the sandbox proxy. */
  readonly frame: HTMLIFrameElement;
  /** Adapter to the surface the component renders in. */
  readonly host: FrameHost;
  /** Origin of the sandbox proxy; the only origin accepted on the ambient channel. */
  readonly sandboxOrigin: string;
  /** Returns the current component properties. */
  readonly getProps: () => WebAppFrameBridgeProps;
  /** Called when the proxy reports ready; the component answers by sending its resource. */
  readonly onSandboxProxyReady?: () => void;
  /** Where ambient messages arrive; defaults to `window`. */
  readonly messageTarget?: MessageListenerTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Host side of the `a2ui_*` protocol for one frame.
 *
 * After {@link start}, the bridge watches the ambient `message` events of the frame: the proxy's
 * ready signal is forwarded to `onSandboxProxyReady`, and the app's `a2ui_app_frame_ready` opens
 * a dedicated `MessageChannel`. The host keeps one port and transfers the other to the app inside
 * `a2ui_app_frame_init`, together with the static configuration, the initial values of the bound
 * data paths, the allowlists and the container dimensions. Everything after that travels over
 * the port: actions, data changes, function calls and resize requests from the app; data updates,
 * function results and host context updates from the host.
 *
 * Every message from the app goes through {@link validateMessageSecurity}, the zod wire schema,
 * the allowlist of its kind and the JSON Schema of the listed entry, in that order.
 */
export class WebAppFrameBridge {
  private readonly frame: HTMLIFrameElement;
  private readonly host: FrameHost;
  private readonly sandboxOrigin: string;
  private readonly getProps: () => WebAppFrameBridgeProps;
  private readonly onSandboxProxyReady: (() => void) | undefined;
  private readonly messageTarget: MessageListenerTarget;
  private readonly validator = new PayloadValidator();
  private readonly sizing: FrameSizing;
  private readonly ambientListener = (event: Event) => {
    if (event instanceof MessageEvent) {
      this.handleAmbientMessage(event);
    }
  };

  private listening = false;
  private port: MessagePort | null = null;
  private dataSync: DataModelSync | null = null;
  private stopObservingHost: (() => void) | null = null;

  constructor(options: WebAppFrameBridgeOptions) {
    this.frame = options.frame;
    this.host = options.host;
    this.sandboxOrigin = options.sandboxOrigin;
    this.getProps = options.getProps;
    this.onSandboxProxyReady = options.onSandboxProxyReady;
    this.messageTarget = options.messageTarget ?? window;
    this.sizing = new FrameSizing({frame: options.frame});
  }

  /** Whether a channel to the app is open. */
  get connected(): boolean {
    return this.port !== null;
  }

  /** Starts watching the frame's handshake messages. Calling it twice has no effect. */
  start(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.messageTarget.addEventListener('message', this.ambientListener);
  }

  /** Stops watching, closes the channel and releases subscriptions, observers and timers. */
  dispose(): void {
    if (this.listening) {
      this.messageTarget.removeEventListener('message', this.ambientListener);
      this.listening = false;
    }
    this.closeChannel();
    this.sizing.dispose();
  }

  private handleAmbientMessage(event: MessageEvent): void {
    if (!isMessageFromFrame(event, this.frame, this.sandboxOrigin)) {
      return;
    }
    const parsed = IncomingWebFrameMessageSchema.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    switch (parsed.data.type) {
      case A2uiMessageType.SandboxProxyReady:
        this.onSandboxProxyReady?.();
        break;
      case A2uiMessageType.AppFrameReady:
        this.openChannel();
        break;
      default:
        // Everything else is only accepted on the dedicated port.
        break;
    }
  }

  private openChannel(): void {
    const frameWindow = this.frame.contentWindow;
    if (!frameWindow) {
      return;
    }
    // An app that reloads sends a new ready signal; the previous channel is replaced.
    this.closeChannel();

    const props = this.getProps();
    const channel = new MessageChannel();
    const port = channel.port1;
    this.port = port;

    const dataSync = new DataModelSync({
      host: this.host,
      paths: props.dataPaths ?? {},
      sendUpdate: update => {
        this.post({type: A2uiMessageType.DataModelUpdate, ...update});
      },
    });
    this.dataSync = dataSync;
    const initialData = dataSync.start();

    port.onmessage = event => {
      void this.handlePortMessage(event);
    };
    port.start();

    const init: AppFrameInitMessage = {
      type: A2uiMessageType.AppFrameInit,
      value: {
        config: props.config ?? {},
        initialData,
        allowedEvents: props.allowedEvents ?? {},
        allowedFunctions: props.allowedFunctions ?? {},
        mutableDataKeys: Object.keys(props.mutableData ?? {}),
        hostContext: measureHostContext(this.frame),
      },
    };
    frameWindow.postMessage(init, this.sandboxOrigin, [channel.port2]);

    this.stopObservingHost = observeHostContext(this.frame, context => {
      this.post({type: A2uiMessageType.HostContextUpdate, value: context});
    });
  }

  private closeChannel(): void {
    this.stopObservingHost?.();
    this.stopObservingHost = null;
    this.dataSync?.dispose();
    this.dataSync = null;
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
      this.port = null;
    }
  }

  private post(message: OutgoingWebFrameMessage): void {
    this.port?.postMessage(message);
  }

  private async handlePortMessage(event: MessageEvent): Promise<void> {
    const security = validateMessageSecurity(event.data);
    if (!security.valid) {
      console.warn(`${LOG_PREFIX} Dropping insecure message:`, security.reason);
      return;
    }
    const parsed = IncomingWebFrameMessageSchema.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case A2uiMessageType.Action:
        await this.handleAction(message);
        break;
      case A2uiMessageType.DataModelChange:
        this.handleDataModelChange(message);
        break;
      case A2uiMessageType.FunctionCall:
        await this.handleFunctionCall(message);
        break;
      case A2uiMessageType.SizeChanged:
        this.sizing.requestSize(message.width, message.height);
        break;
      default:
        // Handshake messages are only accepted on the ambient channel.
        break;
    }
  }

  private async handleAction(message: ActionMessage): Promise<void> {
    const props = this.getProps();
    const context = message.data ?? {};
    if (!isRecord(context)) {
      console.warn(`${LOG_PREFIX} Action ${message.action} carries a non-object payload; dropped`);
      return;
    }
    const decision = this.validator.checkAllowlist(
      message.action,
      context,
      props.allowedEvents,
      props,
    );
    if (decision.status === 'not-listed') {
      console.warn(`${LOG_PREFIX} Action ${message.action} not in allowedEvents`);
      return;
    }
    if (decision.status === 'invalid') {
      console.warn(
        `${LOG_PREFIX} Action ${message.action} failed schema validation:`,
        decision.errors,
      );
      return;
    }
    try {
      await this.host.dispatchAction(message.action, context);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Action ${message.action} failed:`, error);
    }
  }

  private handleDataModelChange(message: DataModelChangeMessage): void {
    const props = this.getProps();
    const {key, subpath} = message;
    if (!props.mutableData || !Object.hasOwn(props.mutableData, key)) {
      console.warn(`${LOG_PREFIX} Data key ${key} not authorized for mutation`);
      return;
    }
    const path = props.dataPaths?.[key];
    if (!path) {
      console.warn(`${LOG_PREFIX} Data key ${key} is not bound in data.paths`);
      return;
    }

    // The schema describes the whole bound value, so a subpath change is validated as the value
    // it would produce.
    let candidate: unknown = message.value;
    if (subpath) {
      const projection = projectSubpathChange(this.host.getData(path), subpath, message.value);
      if (!projection) {
        console.warn(`${LOG_PREFIX} Data change for ${key} uses a forbidden subpath: ${subpath}`);
        return;
      }
      candidate = projection.projected;
    }
    const decision = this.validator.checkAllowlist(key, candidate, props.mutableData, props);
    if (decision.status !== 'allowed') {
      console.warn(`${LOG_PREFIX} Data change for ${key} failed schema validation:`, decision);
      return;
    }

    try {
      this.dataSync?.applyChange({key, subpath, value: message.value});
    } catch (error) {
      console.warn(`${LOG_PREFIX} Data change for ${key} was rejected by the data model:`, error);
    }
  }

  private async handleFunctionCall(message: FunctionCallMessage): Promise<void> {
    const props = this.getProps();
    const {call, callId} = message;
    const args = message.args ?? {};
    const reply = (result: Omit<FunctionResultMessage, 'type' | 'call' | 'callId'>) => {
      this.post({type: A2uiMessageType.FunctionResult, call, callId, ...result});
    };

    if (!isRecord(args)) {
      reply({
        status: 'error',
        error: {code: 'VALIDATION_ERROR', message: 'Arguments must be an object'},
      });
      return;
    }
    const decision = this.validator.checkAllowlist(call, args, props.allowedFunctions, props);
    if (decision.status === 'not-listed') {
      console.warn(`${LOG_PREFIX} Function ${call} not in allowedFunctions`);
      reply({
        status: 'error',
        error: {code: 'NOT_ALLOWED', message: `Function ${call} is not in allowedFunctions`},
      });
      return;
    }
    if (decision.status === 'invalid') {
      console.warn(`${LOG_PREFIX} Function ${call} failed schema validation:`, decision.errors);
      reply({
        status: 'error',
        error: {code: 'VALIDATION_ERROR', message: 'Arguments failed schema validation'},
      });
      return;
    }

    try {
      const result = await this.host.invokeFunction(call, args);
      reply({status: 'success', result});
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error) || 'Error executing function';
      reply({status: 'error', error: {code: 'EXECUTION_ERROR', message: errorMessage}});
    }
  }
}
