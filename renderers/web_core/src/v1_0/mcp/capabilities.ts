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

import {A2UI_MIME_TYPE, MCP_APPS_MIME_TYPE, MCP_UI_EXTENSION_KEY} from './constants.js';
import {McpUiClientCapabilitiesOptions} from './types.js';

/**
 * Builds the standardized MCP Client capabilities object containing UI extension MIME types.
 *
 * @param options Configuration options specifying which MIME types to advertise.
 * @returns An object suitable for passing into the `capabilities` parameter of `Client.connect()`.
 */
export function buildMcpUiClientCapabilities(options?: McpUiClientCapabilitiesOptions): {
  extensions: {
    [MCP_UI_EXTENSION_KEY]: {
      mimeTypes: string[];
    };
  };
} {
  const mimeTypes: string[] = [];

  if (options?.enableHtmlApp !== false) {
    mimeTypes.push(MCP_APPS_MIME_TYPE);
  }
  if (options?.enableNativeA2ui !== false) {
    mimeTypes.push(A2UI_MIME_TYPE);
  }

  return {
    extensions: {
      [MCP_UI_EXTENSION_KEY]: {
        mimeTypes,
      },
    },
  };
}

/**
 * Inspects a client or server capabilities object to verify if native A2UI is supported.
 *
 * @param capabilities The capabilities object from initialize params or server handshake.
 * @returns True if application/a2ui+json is declared in mimeTypes.
 */
export function supportsNativeA2ui(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== 'object') {
    return false;
  }

  const caps = capabilities as Record<string, unknown>;
  const extensions =
    (caps['extensions'] as Record<string, unknown> | undefined) ||
    ((caps['capabilities'] as Record<string, unknown> | undefined)?.['extensions'] as
      | Record<string, unknown>
      | undefined);

  if (!extensions || typeof extensions !== 'object') {
    return false;
  }

  const uiExt = extensions[MCP_UI_EXTENSION_KEY] as Record<string, unknown> | undefined;
  if (!uiExt || typeof uiExt !== 'object') {
    return false;
  }

  const mimeTypes = (uiExt['mimeTypes'] || uiExt['mime_types']) as unknown;
  if (Array.isArray(mimeTypes)) {
    return mimeTypes.includes(A2UI_MIME_TYPE);
  }

  return false;
}
