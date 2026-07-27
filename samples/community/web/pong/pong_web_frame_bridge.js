/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * WebFrame Communication Layer
 *
 * SECURITY NOTE: To prevent cross-site message interception, we must explicitly
 * specify the targetOrigin when using window.parent.postMessage().
 * We extract this from the '?origin=' query parameter supplied by the A2UI host.
 * Failing to explicitly set this origin would allow any malicious parent site
 * to silently intercept sensitive messages and data sent from this iframe.
 */
const urlParams = new URLSearchParams(window.location.search);
const PARENT_ORIGIN = urlParams.get('origin');
if (!PARENT_ORIGIN) {
  console.error(
    'A2UI Web Frame: The parent origin must be specified via the "?origin=" query parameter for security.',
  );
}

let localPlayerScore = 0;
let localCpuScore = 0;

let functionCallId = 0;

function dispatchAction(action, data = {}) {
  window.parent.postMessage({type: 'a2ui_action', action, data}, PARENT_ORIGIN);
}

function dispatchDataModelChange(key, subpath, value) {
  window.parent.postMessage({type: 'a2ui_data_model_change', key, subpath, value}, PARENT_ORIGIN);
}

function dispatchFunctionCall(call, args = {}) {
  const callId = String(++functionCallId);
  window.parent.postMessage({type: 'a2ui_function_call', call, callId, args}, PARENT_ORIGIN);

  return new Promise((resolve, reject) => {
    const listener = event => {
      if (event.data?.type === 'a2ui_function_result' && event.data?.callId === callId) {
        window.removeEventListener('message', listener);
        if (event.data.status === 'success') {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data.error?.message || 'Error'));
        }
      }
    };
    window.addEventListener('message', listener);
  });
}

function sendNotification(method, params) {
  if (method === 'ui/notifications/data-model-change') {
    dispatchDataModelChange(params.key, params.subpath, params.value);
  }
}

function sendRequest(method, params) {
  if (method === 'tools/call') {
    dispatchAction(params.name, params.arguments);
    return Promise.resolve();
  } else if (method === 'ui/requests/function-call') {
    return dispatchFunctionCall(params.call, params.args);
  }
  return Promise.resolve();
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
  if (data?.type === 'a2ui_app_frame_init') {
    const initialData = data.value.initialData;
    if (initialData?.state) {
      if (typeof initialData.state.player_score === 'number')
        localPlayerScore = initialData.state.player_score;
      if (typeof initialData.state.cpu_score === 'number')
        localCpuScore = initialData.state.cpu_score;
    }
    if (data.value.hostContext && data.value.hostContext.containerDimensions) {
      applyContainerDimensions(data.value.hostContext.containerDimensions);
    }
  } else if (data?.type === 'a2ui_host_context_update') {
    if (data.value.containerDimensions) {
      applyContainerDimensions(data.value.containerDimensions);
    }
  } else if (data?.type === 'a2ui_data_model_update') {
    const key = data.key;
    const subpath = data.subpath;
    const value = data.value;

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
        if (typeof isPaused !== 'undefined') {
          isPaused = false;
        }
        if (typeof hideOverlay === 'function') {
          hideOverlay();
        }
        if (typeof resetBall === 'function') {
          resetBall();
        }
        dispatchAction('commentate_pong', {
          game_event: 'Match started! Current Score: Player 0 - CPU 0.',
          silent: true,
        });
      }
    }
  }
});

// Initialize
window.parent.postMessage({type: 'a2ui_app_frame_ready'}, PARENT_ORIGIN);
