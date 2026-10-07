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
 * @a2ui/catalog-iframe: the A2UI iframe catalog. This entry point exposes the catalog with its two
 * universal components, the sandbox configuration and the `a2ui_*` host bridge.
 */

// The catalog and its components.
export {IFRAME_CATALOG_ID, iframeCatalog} from './catalog.js';
export {
  A2uiWebAppFrameUrl,
  WebAppFrameUrlApi,
  type WebAppFrameUrlProps,
} from './components/web_app_frame_url.js';
export {
  A2uiWebAppFrameSrcdoc,
  WebAppFrameSrcdocApi,
  type WebAppFrameSrcdocProps,
} from './components/web_app_frame_srcdoc.js';

// Base class and host adapter for other sandboxed frame components.
export {
  frameHeightFromProp,
  frameTitleFromProps,
  SandboxedFrameElement,
} from './shared/sandbox/sandboxed_frame_element.js';
export {ComponentContextFrameHost} from './shared/sandbox/component_context_frame_host.js';

// Sandbox configuration.
export {
  configureSandbox,
  DEFAULT_SANDBOX_BASE_URL,
  resolveSandboxUrl,
  type ResolveSandboxUrlOptions,
  type SandboxConfig,
  type SandboxMode,
} from './shared/sandbox/sandbox_config.js';

// Handshake helper for hosts that drive the bridge themselves.
export {
  sendSandboxResourceReady,
  type SandboxResource,
} from './shared/sandbox/sandbox_bootstrap.js';

// Host interface the bridge is written against.
export type {FrameHost, FrameHostSubscription} from './shared/sandbox/frame_host.js';

// Host side of the a2ui_* protocol.
export {
  WebAppFrameBridge,
  type WebAppFrameBridgeOptions,
  type WebAppFrameBridgeProps,
} from './bridge/web_app_frame_bridge.js';
