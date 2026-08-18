// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * MCP Communication Layer
 * Handles bidirectional JSON-RPC communication using the Model Context Protocol (MCP)
 * over the Window.postMessage API. This allows the embedded app to send requests
 * (like tool calls) to the parent proxy agent and handle framework-level initialization
 * and state updates.
 */
let nextId = 1;
let localPlayerScore = 0;
let localCpuScore = 0;

function sendRequest(method, params) {
  const id = nextId++;
  window.parent.postMessage({jsonrpc: '2.0', id, method, params}, '*');
  return new Promise((resolve, reject) => {
    const listener = event => {
      if (event.data?.id === id) {
        window.removeEventListener('message', listener);
        if (event.data?.result) {
          resolve(event.data.result);
        } else if (event.data?.error) {
          reject(new Error(event.data.error.message || JSON.stringify(event.data.error)));
        }
      }
    };
    window.addEventListener('message', listener);
  });
}

function sendNotification(method, params) {
  window.parent.postMessage({jsonrpc: '2.0', method, params}, '*');
}

function applyContainerDimensions(containerDimensions) {
  if (!containerDimensions) return;
  if (typeof containerDimensions.width === 'number') {
    document.documentElement.style.width = `${containerDimensions.width}px`;
    document.body.style.width = `${containerDimensions.width}px`;
  }
  if (typeof containerDimensions.height === 'number') {
    document.documentElement.style.height = `${containerDimensions.height}px`;
    document.body.style.height = `${containerDimensions.height}px`;
  }
  if (typeof resize === 'function') resize();
}

window.addEventListener('message', event => {
  const data = event.data;
  if (data?.method === 'ping') {
    if (data.id) {
      window.parent.postMessage({jsonrpc: '2.0', id: data.id, result: {}}, '*');
    }
  } else if (data?.method === 'ui/notifications/host-context-changed') {
    applyContainerDimensions(data.params?.containerDimensions);
  } else if (data?.method === 'ui/notifications/data-model-update') {
    // TODO: Refactor message handlers to use `@modelcontextprotocol/ext-apps/app-bridge` App client.
    const params = data.params;
    const key = params?.key;
    const subpath = params?.subpath;
    const value = params?.value;

    if (key === 'state') {
      if (subpath) {
        if (subpath === '/player_score' && typeof value === 'number') {
          localPlayerScore = value;
        } else if (subpath === '/cpu_score' && typeof value === 'number') {
          localCpuScore = value;
        }
      } else if (value && typeof value === 'object') {
        if (typeof value.player_score === 'number') {
          localPlayerScore = value.player_score;
        }
        if (typeof value.cpu_score === 'number') {
          localCpuScore = value.cpu_score;
        }
      }

      // Automatically restart if scores reset to 0
      if (localPlayerScore === 0 && localCpuScore === 0) {
        if (typeof isPaused !== 'undefined' && isPaused) {
          isPaused = false;
          if (typeof hideOverlay === 'function') {
            hideOverlay();
          }
          if (typeof resetBall === 'function') {
            resetBall();
          }
          sendRequest('tools/call', {
            name: 'commentate_pong',
            arguments: {
              game_event: 'Match started! Current Score: Player 0 - CPU 0.',
              silent: true,
            },
          }).catch(e => console.error('Failed to request commentary:', e));
        }
      }
    }
  }
});

// Initialize
sendRequest('ui/initialize', {
  appInfo: {
    name: 'Neon Pong',
    version: '1.0.0',
  },
  appCapabilities: {
    experimental: {},
    tools: {listChanged: false},
    availableDisplayModes: ['inline'],
  },
  protocolVersion: '2026-06-26',
})
  .then(result => {
    console.log('Initialized with host:', result);
    sendNotification('ui/notifications/initialized', {});

    // The app is reactive to host dimensions if provided; otherwise, it falls back
    // to requesting default dimensions to maintain backward compatibility.
    if (result.hostContext?.containerDimensions) {
      applyContainerDimensions(result.hostContext.containerDimensions);
    } else {
      sendNotification('ui/notifications/size-changed', {width: 728, height: 502});
    }
  })
  .catch(err => {
    console.error('Initialization failed:', err);
  });
