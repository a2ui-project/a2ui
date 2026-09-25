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

/** What `WebAppFrameUrl` and `WebAppFrameSrcdoc` share: their common schema and bridge wiring. */

import {
  AccessibilityAttributesSchema,
  DynamicNumberSchema,
  type ComponentContext,
} from '@a2ui/web_core/v0_9';
import {WebAppFrameBasePropsSchema, type WebAppFrameBaseProps} from '../bridge/messages.js';
import {WebAppFrameBridge, type WebAppFrameBridgeProps} from '../bridge/web_app_frame_bridge.js';
import {ComponentContextFrameHost} from '../shared/sandbox/component_context_frame_host.js';

/**
 * Properties both frame components declare: the bridge properties of the catalog's
 * `WebAppFrameCommon`, its `height`, and the `accessibility` attributes every component accepts.
 */
export const WebAppFrameCommonPropsSchema = WebAppFrameBasePropsSchema.extend({
  'accessibility': AccessibilityAttributesSchema.optional(),
  'height': DynamicNumberSchema.optional().describe('The height of the iframe in pixels.'),
});

/** Maps the component properties to what the bridge reads; `data.paths` becomes `dataPaths`. */
export function toBridgeProps(props: WebAppFrameBaseProps): WebAppFrameBridgeProps {
  return {
    config: props.config,
    dataPaths: props.data?.paths,
    allowedEvents: props.allowedEvents,
    allowedFunctions: props.allowedFunctions,
    mutableData: props.mutableData,
    disableSchemaValidation: props.disableSchemaValidation,
  };
}

/** Inputs of {@link connectWebAppFrameBridge}. */
export interface ConnectWebAppFrameBridgeOptions {
  /** The frame that loads the sandbox proxy. */
  readonly frame: HTMLIFrameElement;
  /** Origin of the sandbox proxy. */
  readonly sandboxOrigin: string;
  /** Context of the component the frame belongs to; it becomes the bridge's `FrameHost`. */
  readonly context: ComponentContext;
  /** Returns the component's current properties, in bridge form. */
  readonly getProps: () => WebAppFrameBridgeProps;
}

/** Starts a {@link WebAppFrameBridge} for a frame component; returns the function that disposes it. */
export function connectWebAppFrameBridge(options: ConnectWebAppFrameBridgeOptions): () => void {
  const bridge = new WebAppFrameBridge({
    frame: options.frame,
    host: new ComponentContextFrameHost(options.context),
    sandboxOrigin: options.sandboxOrigin,
    getProps: options.getProps,
  });
  bridge.start();
  return () => {
    bridge.dispose();
  };
}
