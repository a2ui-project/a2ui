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

import type {CatalogSchema, JsonSchemaValidator} from '@a2ui/web_core/schema-engine';
import {memoizeByValidator} from '@a2ui/web_core/catalog';
import {toWebComponentImplementation} from '@a2ui/web_core/universal';
import type {
  AccessibilityAttributes,
  ComponentApi,
  DynamicString,
  WebComponentImplementation,
} from '@a2ui/web_core/v1_0';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {loadMcpCatalogApi} from '../document.js';
import type {McpToolDataPayload} from '../functions/callMcpTool.js';
import {getMcpCatalogConfig} from '../mcp_catalog_config.js';
import {ComponentContextFrameHost} from '../shared/sandbox/component_context_frame_host.js';
import type {
  SandboxPermissions,
  SandboxProtocol,
  SandboxResource,
} from '../shared/sandbox/sandbox_bootstrap.js';
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

/** Per-resource Content Security Policy domain allowlists from `_meta.ui.csp`. */
export interface McpAppCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

/** A delegated permission: `true`, or an object of options (an empty object delegates it too). */
type PermissionFlag = boolean | Record<string, unknown>;

/** Browser capability permissions delegated to the inner sandboxed iframe from `_meta.ui.permissions`. */
export interface McpAppPermissions {
  camera?: PermissionFlag;
  microphone?: PermissionFlag;
  geolocation?: PermissionFlag;
  clipboardWrite?: PermissionFlag;
}

function toSandboxPermissions(
  permissions: McpAppPermissions | undefined,
): SandboxPermissions | undefined {
  if (!permissions) {
    return undefined;
  }
  return {
    ...(permissions.camera ? {camera: {}} : {}),
    ...(permissions.microphone ? {microphone: {}} : {}),
    ...(permissions.geolocation ? {geolocation: {}} : {}),
    ...(permissions.clipboardWrite ? {clipboardWrite: {}} : {}),
  };
}

/**
 * The properties of the `McpApp` component, as the MCP catalog document defines them, plus the
 * envelope's accessibility attributes.
 */
export interface McpAppProps {
  accessibility?: AccessibilityAttributes;
  /** The HTML of the app; a value prefixed with `url_encoded:` is decoded first. */
  htmlContent: DynamicString;
  /** The accessible title of the frame. */
  title?: DynamicString;
  /** The MCP tools the app may call. */
  allowedTools?: string[];
  /** The host functions the app may call, each with the JSON Schema of its arguments. */
  allowedFunctions?: Record<string, Record<string, unknown>>;
  /** The data model paths bound to the app. */
  data?: {paths: Record<string, string>};
  csp?: McpAppCsp;
  permissions?: McpAppPermissions;
}

/** The API of the `McpApp` component of the MCP catalog. */
export type McpAppApi = ComponentApi<CatalogSchema<McpAppProps>>;

/** The `McpApp` component of the MCP catalog, with its element. */
export type A2uiMcpApp = WebComponentImplementation<CatalogSchema<McpAppProps>>;

/** The custom element that renders `McpApp`: the app in a sandboxed double iframe. */
export class A2uiMcpAppElement extends SandboxedFrameElement<McpAppApi> {
  static readonly tagName = 'a2ui-mcp-app';

  protected readonly sandboxMode: SandboxMode = 'html';
  protected readonly sandboxProtocol: SandboxProtocol = 'mcp';

  /**
   * Optional callback that executes authorized `tools/call` requests directly against an MCP
   * server and returns the `CallToolResult` to the embedded application.
   */
  callTool?: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

  protected resolveResource(): SandboxResource | null {
    const {htmlContent, csp, permissions} = this.controller.props;
    if (typeof htmlContent !== 'string') {
      return null;
    }
    const html = decodeHtmlContent(htmlContent);
    if (html === '') {
      return null;
    }
    const sandboxPermissions = toSandboxPermissions(permissions);
    return {
      html,
      sandbox: MCP_APP_INNER_SANDBOX,
      ...(csp !== undefined ? {csp} : {}),
      ...(sandboxPermissions !== undefined ? {permissions: sandboxPermissions} : {}),
    };
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

  private resolveCallTool():
    | ((name: string, args: Record<string, unknown>) => Promise<CallToolResult>)
    | undefined {
    if (this.callTool) {
      return this.callTool;
    }
    const callMcpTool =
      this.context?.componentModel?.catalog?.functions.get('callMcpTool') ??
      this.context?.dataContext?.surface?.defaultCatalog?.functions.get('callMcpTool');
    if (!getMcpCatalogConfig().getMcpClientForTool || !callMcpTool) {
      return undefined;
    }
    return async (name: string, args: Record<string, unknown>) => {
      // Executed directly rather than through the catalog invoker: the invoker validates the
      // arguments as A2UI payload values, which excludes the plain objects an app may send, and
      // the bridge has already checked them for prototype pollution, depth and size.
      const payload = await callMcpTool.execute({name, arguments: args}, this.context.dataContext);
      // `callMcpTool` returns its tool data payload; the app receives the raw result inside it.
      const res = (payload as Partial<McpToolDataPayload> | undefined)?.toolResult ?? payload;
      if (res && typeof res === 'object' && Array.isArray((res as CallToolResult).content)) {
        return res as CallToolResult;
      }
      return {content: [{type: 'text', text: JSON.stringify(res ?? null)}]};
    };
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
          dataPaths: data?.paths as Readonly<Record<string, string>> | undefined,
        };
      },
      callTool: this.resolveCallTool(),
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

/**
 * Builds the `McpApp` component of the MCP catalog: its definition in the catalog document,
 * rendered by `A2uiMcpAppElement`. Memoised per validator.
 */
export const createMcpAppImplementation: (validator: JsonSchemaValidator) => A2uiMcpApp =
  memoizeByValidator(validator => {
    const catalog = loadMcpCatalogApi(validator);
    const api = catalog.components.get('McpApp') as McpAppApi | undefined;
    if (!api) {
      throw new Error("The MCP catalog document has no component 'McpApp'.");
    }
    return toWebComponentImplementation(A2uiMcpAppElement, api);
  });
