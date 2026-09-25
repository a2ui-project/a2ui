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

import {DynamicStringSchema, type ComponentApi} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import type {z} from 'zod';
import {DEFAULT_INNER_SANDBOX} from '../shared/sandbox/sandbox.js';
import type {SandboxProtocol, SandboxResource} from '../shared/sandbox/sandbox_bootstrap.js';
import type {SandboxMode} from '../shared/sandbox/sandbox_config.js';
import {
  frameHeightFromProp,
  frameTitleFromProps,
  SandboxedFrameElement,
} from '../shared/sandbox/sandboxed_frame_element.js';
import {
  connectWebAppFrameBridge,
  toBridgeProps,
  WebAppFrameCommonPropsSchema,
} from './web_app_frame_common.js';

/** The `WebAppFrameUrl` component of the iframe catalog: an external web application in a frame. */
export const WebAppFrameUrlApi = {
  name: 'WebAppFrameUrl',
  schema: WebAppFrameCommonPropsSchema.extend({
    'url': DynamicStringSchema.describe(
      'The external URL to load inside the iframe. Only http and https URLs are loaded.',
    ),
  }).strict(),
} satisfies ComponentApi;

/** Properties of `WebAppFrameUrl`, as declared in the catalog. */
export type WebAppFrameUrlProps = z.infer<typeof WebAppFrameUrlApi.schema>;

/**
 * The URL the inner frame loads for a `url` property: only `http:` and `https:` URLs qualify, and
 * the host origin is appended as the `origin` query parameter so the application can address its
 * messages to the host. Returns null for anything else.
 */
export function resolveWebAppUrl(url: unknown, hostOrigin = window.location.origin): string | null {
  if (typeof url !== 'string' || url === '') {
    return null;
  }
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return null;
  }
  target.searchParams.set('origin', hostOrigin);
  return target.href;
}

class WebAppFrameUrlElement extends SandboxedFrameElement<typeof WebAppFrameUrlApi> {
  protected readonly api = WebAppFrameUrlApi;
  protected readonly sandboxMode: SandboxMode = 'url';
  protected readonly sandboxProtocol: SandboxProtocol = 'a2ui';

  private reportedInvalidUrl: string | undefined;

  protected resolveResource(): SandboxResource | null {
    const {url} = this.controller.props;
    const target = resolveWebAppUrl(url);
    if (target === null) {
      if (typeof url === 'string' && url !== '' && url !== this.reportedInvalidUrl) {
        this.reportedInvalidUrl = url;
        console.warn(`[WebAppFrameUrl] Not an http or https URL, nothing loaded: ${url}`);
      }
      return null;
    }
    return {url: target, sandbox: DEFAULT_INNER_SANDBOX};
  }

  protected resolveHeight(): number | undefined {
    return frameHeightFromProp(this.controller.props.height);
  }

  protected resolveTitle(): string {
    return frameTitleFromProps(this.controller.props.accessibility, 'Embedded web application');
  }

  protected connectFrame(frame: HTMLIFrameElement, sandboxOrigin: string): () => void {
    return connectWebAppFrameBridge({
      frame,
      sandboxOrigin,
      context: this.context,
      getProps: () => toBridgeProps(this.controller.props),
    });
  }
}

/** Registration entry of `WebAppFrameUrl` for a `Catalog`. */
export const A2uiWebAppFrameUrl: WebComponentImplementation<typeof WebAppFrameUrlApi.schema> = {
  ...WebAppFrameUrlApi,
  tagName: 'a2ui-web-app-frame-url',
  element: WebAppFrameUrlElement,
};
