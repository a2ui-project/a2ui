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
 * @a2ui/catalog-iframe: the A2UI iframe catalog. This entry point exposes the sandbox
 * configuration and the `a2ui_*` host bridge; the frame components follow.
 */

/** `$id` of the iframe catalog schema (`catalogs/iframe/catalog.json`). */
export const IFRAME_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/iframe/catalog.json';

// Sandbox configuration and handshake.
export {
  configureSandbox,
  DEFAULT_SANDBOX_BASE_URL,
  getSandboxConfig,
  resetSandboxConfig,
  resolveSandboxUrl,
  SANDBOX_PAGES,
  type ResolveSandboxUrlOptions,
  type SandboxConfig,
  type SandboxMode,
} from './shared/sandbox/sandbox_config.js';
export {
  listenForSandboxProxyReady,
  sendSandboxResourceReady,
  type SandboxProtocol,
  type SandboxResource,
} from './shared/sandbox/sandbox_bootstrap.js';
export {DEFAULT_INNER_SANDBOX, type SandboxPermissions} from './shared/sandbox/sandbox.js';

// Host interface the bridge is written against.
export type {FrameHost, FrameHostSubscription} from './shared/sandbox/frame_host.js';
export type {FrameHostContext} from './shared/sandbox/frame_sizing.js';

// The a2ui_* wire protocol and its host bridge.
export {
  A2uiMessageType,
  IncomingWebFrameMessageSchema,
  WebAppFrameBasePropsSchema,
  type ActionMessage,
  type AppFrameInitMessage,
  type DataModelChangeMessage,
  type DataModelUpdateMessage,
  type FunctionCallMessage,
  type FunctionErrorCode,
  type FunctionResultMessage,
  type HostContextUpdateMessage,
  type IncomingWebFrameMessage,
  type OutgoingWebFrameMessage,
  type SizeChangedMessage,
  type WebAppFrameBaseProps,
} from './bridge/messages.js';
export {
  WebAppFrameBridge,
  type WebAppFrameBridgeOptions,
  type WebAppFrameBridgeProps,
} from './bridge/web_app_frame_bridge.js';
