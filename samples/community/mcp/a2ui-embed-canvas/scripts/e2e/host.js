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
 * Minimal MCP Apps host built on `@modelcontextprotocol/ext-apps/app-bridge`.
 * Loads the app into a cross-origin `sandbox="allow-scripts"` iframe under the
 * default MCP Apps CSP and proxies `tools/call`, `ui/message`, and `ui/update-model-context`.
 */

import {AppBridge, PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';

const MAX_FRAME_HEIGHT = 800;

const HOST_CAPABILITIES = {
  serverTools: {},
  message: {text: {}},
  updateModelContext: {text: {}},
};

const THEMES = {
  light: {
    '--color-background-primary': '#ffffff',
    '--color-background-secondary': '#f6f8fc',
    '--color-background-tertiary': '#e8eaed',
    '--color-text-primary': '#1f1f1f',
    '--color-text-secondary': '#5f6368',
    '--color-border-primary': '#dadce0',
    '--color-ring-primary': '#1a73e8',
    '--border-radius-md': '10px',
    '--font-sans': 'system-ui, sans-serif',
  },
  dark: {
    '--color-background-primary': '#1e1f20',
    '--color-background-secondary': '#28292a',
    '--color-background-tertiary': '#3c4043',
    '--color-text-primary': '#e3e3e3',
    '--color-text-secondary': '#a8abb0',
    '--color-border-primary': '#444746',
    '--color-ring-primary': '#8ab4f8',
    '--border-radius-md': '10px',
    '--font-sans': 'system-ui, sans-serif',
  },
};

function hostContext(theme) {
  return {
    theme,
    displayMode: 'inline',
    platform: 'web',
    containerDimensions: {maxHeight: MAX_FRAME_HEIGHT},
    styles: {variables: THEMES[theme]},
  };
}

const log = {toolCalls: [], messages: [], modelContexts: [], sizes: []};
let frameCount = 0;

async function render(appUrl, toolArguments, toolResult, theme = 'light') {
  const id = `app-${++frameCount}`;
  const section = document.createElement('section');
  section.style.cssText = 'margin: 0 0 14px;';
  const iframe = document.createElement('iframe');
  iframe.id = id;
  iframe.name = id;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = `width: 740px; height: 150px; border: none; border-radius: 12px; display: block; background: ${THEMES[theme]['--color-background-primary']};`;
  section.append(iframe);
  document.body.append(section);
  section.scrollIntoView();

  const bridge = new AppBridge(
    null,
    {name: 'a2ui-embed-canvas-e2e-host', version: '0.0.0'},
    HOST_CAPABILITIES,
    {hostContext: hostContext(theme)},
  );
  bridge.oncalltool = async params => {
    log.toolCalls.push({frame: id, params});
    return window.harnessCallTool(params);
  };
  bridge.onmessage = async params => {
    log.messages.push({frame: id, params});
    return {};
  };
  bridge.onupdatemodelcontext = async params => {
    log.modelContexts.push({frame: id, params});
    return {};
  };
  bridge.onsizechange = params => {
    log.sizes.push({frame: id, params});
    if (typeof params.height === 'number') {
      iframe.style.height = `${Math.min(params.height, MAX_FRAME_HEIGHT)}px`;
    }
  };
  const initialized = new Promise(resolve => {
    bridge.oninitialized = resolve;
  });
  iframe.src = appUrl;
  const contentWindow = iframe.contentWindow;
  await bridge.connect(new PostMessageTransport(contentWindow, contentWindow));
  await initialized;
  await bridge.sendToolInput({arguments: toolArguments});
  await bridge.sendToolResult(toolResult);
  return id;
}

window.host = {render, log};
