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

import {
  AccessibilityAttributesSchema,
  DynamicStringSchema,
  type ComponentApi,
} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {z} from 'zod';
import {ComponentContextFrameHost} from '../shared/sandbox/component_context_frame_host.js';
import type {SandboxProtocol, SandboxResource} from '../shared/sandbox/sandbox_bootstrap.js';
import type {SandboxMode} from '../shared/sandbox/sandbox_config.js';
import {
  frameTitleFromProps,
  SandboxedFrameElement,
} from '../shared/sandbox/sandboxed_frame_element.js';
import {McpAppBridge} from './mcp_app_bridge.js';

/** Prefix of an `htmlContent` value that was `encodeURIComponent`-encoded for transport. */
export const URL_ENCODED_PREFIX = 'url_encoded:';

/**
 * Sandbox flags of the inner frame an MCP App runs in: scripts and nothing else, as the reference
 * host grants. Form submission, modal dialogs and same-origin access stay denied.
 */
export const MCP_APP_INNER_SANDBOX = 'allow-scripts';

/** Accessible name of the frame when the component sets neither `accessibility.label` nor `title`. */
export const DEFAULT_MCP_APP_TITLE = 'MCP App';

/** Decodes the `url_encoded:` transport form; other values are returned unchanged. */
export function decodeHtmlContent(htmlContent: string): string {
  if (htmlContent.startsWith(URL_ENCODED_PREFIX)) {
    try {
      return decodeURIComponent(htmlContent.substring(URL_ENCODED_PREFIX.length));
    } catch (error) {
      console.warn('Failed to decode URL-encoded HTML content:', error);
      return '';
    }
  }
  return htmlContent;
}

/** The `McpApp` component of the MCP catalog: a sandboxed MCP App in a surface. */
export const McpAppApi = {
  name: 'McpApp',
  schema: z
    .object({
      'accessibility': AccessibilityAttributesSchema.optional(),
      'htmlContent': DynamicStringSchema.describe(
        'The HTML content of the app, rendered via srcdoc inside the sandbox. A value prefixed with `url_encoded:` is decoded with decodeURIComponent before rendering.',
      ),
      'title': DynamicStringSchema.optional().describe(
        'The title of the app, used as the accessible title of the frame.',
      ),
      'allowedTools': z
        .array(z.string())
        .optional()
        .describe(
          'The names of the MCP tools the app is allowed to call. The host dispatches an authorized `tools/call` request as an A2UI action named after the tool, with the tool arguments as its context, and rejects any other tool call.',
        ),
      'allowedFunctions': z
        .record(z.unknown())
        .optional()
        .describe(
          'A map of authorized host client function names to JSON Schemas describing their expected arguments. The host rejects a `ui/requests/function-call` request whose function is not listed or whose arguments fail validation. The functions must exist in the surface catalog.',
        ),
      'data': z
        .object({
          paths: z
            .record(z.string())
            .describe(
              'A dictionary mapping custom state keys to distinct JSON Pointer paths in the data model. The host pushes a `ui/notifications/data-model-update` notification whenever a bound value changes and writes authorized `ui/notifications/data-model-change` notifications back to the path.',
            ),
        })
        .optional()
        .describe('Data binding configuration for the component.'),
    })
    .strict(),
} satisfies ComponentApi;

/** Properties of `McpApp`, as declared in the catalog. */
export type McpAppProps = z.infer<typeof McpAppApi.schema>;

class McpAppElement extends SandboxedFrameElement<typeof McpAppApi> {
  protected readonly api = McpAppApi;
  protected readonly sandboxMode: SandboxMode = 'html';
  protected readonly sandboxProtocol: SandboxProtocol = 'mcp';

  protected resolveResource(): SandboxResource | null {
    const {htmlContent} = this.controller.props;
    if (typeof htmlContent !== 'string') {
      return null;
    }
    const html = decodeHtmlContent(htmlContent);
    return html === '' ? null : {html, sandbox: MCP_APP_INNER_SANDBOX};
  }

  /** The component has no `height` property; the element keeps its default height until the app asks for one. */
  protected resolveHeight(): number | undefined {
    return undefined;
  }

  protected resolveTitle(): string {
    const {accessibility, title} = this.controller.props;
    const fallback =
      typeof title === 'string' && title.trim() !== '' ? title : DEFAULT_MCP_APP_TITLE;
    return frameTitleFromProps(accessibility, fallback);
  }

  protected connectFrame(frame: HTMLIFrameElement, _sandboxOrigin: string): () => void {
    const bridge = new McpAppBridge({
      frame,
      host: new ComponentContextFrameHost(this.context),
      getProps: () => {
        const {allowedTools, allowedFunctions, data} = this.controller.props;
        return {
          // The binder types every string array as a possible child list; the catalog declares
          // tool names, so anything else is dropped.
          allowedTools: allowedTools?.filter((tool): tool is string => typeof tool === 'string'),
          allowedFunctions,
          dataPaths: data?.paths,
        };
      },
      onSizeChange: (width, height) => {
        this.requestFrameSize(width, height);
      },
    });
    bridge.start();
    return () => {
      bridge.dispose();
    };
  }
}

/** Registration entry of `McpApp` for a `Catalog`. */
export const A2uiMcpApp: WebComponentImplementation<typeof McpAppApi.schema> = {
  ...McpAppApi,
  tagName: 'a2ui-mcp-app',
  element: McpAppElement,
};
