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
 * Minimal browser-side MCP Apps host built on `@modelcontextprotocol/ext-apps/app-bridge`.
 * Mounts each tool result in a cross-origin `sandbox="allow-scripts"` iframe under
 * the strict default MCP Apps CSP.
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
const bridges = new Map();
let frameCount = 0;

async function render(appUrl, toolArguments, toolResult, theme = 'light') {
  const id = `app-${++frameCount}`;
  const section = document.createElement('section');
  section.style.marginBottom = '16px';
  const heading = document.createElement('h2');
  heading.textContent = `${id} (${theme})`;
  const iframe = document.createElement('iframe');
  iframe.id = id;
  iframe.name = id;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = `width: 720px; height: 150px; border: 1px solid ${THEMES[theme]['--color-border-primary']}; border-radius: 12px; display: block; background: ${THEMES[theme]['--color-background-primary']};`;
  section.append(heading, iframe);
  document.body.append(section);
  section.scrollIntoView();

  const bridge = new AppBridge(
    null,
    {name: 'a2ui-embed-redline-e2e-host', version: '0.1.0'},
    HOST_CAPABILITIES,
    {hostContext: hostContext(theme)},
  );
  bridges.set(id, {bridge, iframe});
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

async function setTheme(id, theme) {
  const entry = bridges.get(id);
  if (!entry) return;
  entry.iframe.style.background = THEMES[theme]['--color-background-primary'];
  await entry.bridge.sendHostContextChanged(hostContext(theme));
}

window.host = {render, setTheme, log};
