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

import type {ComponentApi} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {z} from 'zod';
import {DEFAULT_INNER_SANDBOX} from '../shared/sandbox/sandbox.js';
import type {SandboxProtocol, SandboxResource} from '../shared/sandbox/sandbox_bootstrap.js';
import type {SandboxMode} from '../shared/sandbox/sandbox_config.js';
import {
  frameHeightFromProp,
  frameTitleFromProps,
  SandboxedFrameElement,
} from '../shared/sandbox/sandboxed_frame_element.js';
import {prepareSrcdocContent} from './srcdoc_content.js';
import {
  connectWebAppFrameBridge,
  toBridgeProps,
  WebAppFrameCommonPropsSchema,
} from './web_app_frame_common.js';

/** The `WebAppFrameSrcdoc` component of the iframe catalog: inline HTML in a frame. */
export const WebAppFrameSrcdocApi = {
  name: 'WebAppFrameSrcdoc',
  schema: WebAppFrameCommonPropsSchema.extend({
    'htmlContent': z
      .string()
      .describe(
        'The raw HTML string to render via srcdoc. A value prefixed with `url_encoded:` is decoded with decodeURIComponent before rendering.',
      ),
  }).strict(),
} satisfies ComponentApi;

/** Properties of `WebAppFrameSrcdoc`, as declared in the catalog. */
export type WebAppFrameSrcdocProps = z.infer<typeof WebAppFrameSrcdocApi.schema>;

class WebAppFrameSrcdocElement extends SandboxedFrameElement<typeof WebAppFrameSrcdocApi> {
  protected readonly api = WebAppFrameSrcdocApi;
  protected readonly sandboxMode: SandboxMode = 'html';
  protected readonly sandboxProtocol: SandboxProtocol = 'a2ui';

  protected resolveResource(): SandboxResource | null {
    const {htmlContent} = this.controller.props;
    if (typeof htmlContent !== 'string') {
      return null;
    }
    const html = prepareSrcdocContent(htmlContent);
    return html === null ? null : {html, sandbox: DEFAULT_INNER_SANDBOX};
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

/** Registration entry of `WebAppFrameSrcdoc` for a `Catalog`. */
export const A2uiWebAppFrameSrcdoc: WebComponentImplementation<typeof WebAppFrameSrcdocApi.schema> =
  {
    ...WebAppFrameSrcdocApi,
    tagName: 'a2ui-web-app-frame-srcdoc',
    element: WebAppFrameSrcdocElement,
  };
