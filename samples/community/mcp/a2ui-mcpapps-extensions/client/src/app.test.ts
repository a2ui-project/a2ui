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

import {describe, it, expect} from 'vitest';
import {buildMcpUiClientCapabilities} from '@a2ui/web_core/v1_0';
import {A2uiMcpDualModeApp} from './app.js';

describe('A2UI MCP Dual Mode App', () => {
  it('instantiates with default native mode and disconnected state', () => {
    const app = new A2uiMcpDualModeApp();
    expect(app.mode).toBe('native');
    expect(app.connectionStatus).toBe('disconnected');
    expect(app.logs.length).toBe(0);
  });

  it('switches between native and fallback modes', () => {
    const app = new A2uiMcpDualModeApp();
    app.setMode('fallback');
    expect(app.mode).toBe('fallback');
    expect(app.logs.length).toBe(1);
    expect(app.logs[0].text).toContain('Switched mode to: fallback');

    app.setMode('native');
    expect(app.mode).toBe('native');
    expect(app.logs.length).toBe(2);
  });

  it('generates capabilities according to active mode', () => {
    const nativeCaps = buildMcpUiClientCapabilities({
      enableNativeA2ui: true,
      enableHtmlApp: false,
    });
    expect(nativeCaps.extensions['io.modelcontextprotocol/ui'].mimeTypes).toEqual([
      'application/a2ui+json',
    ]);

    const fallbackCaps = buildMcpUiClientCapabilities({
      enableNativeA2ui: false,
      enableHtmlApp: true,
    });
    expect(fallbackCaps.extensions['io.modelcontextprotocol/ui'].mimeTypes).toEqual([
      'text/html;profile=mcp-app',
    ]);
  });
});
