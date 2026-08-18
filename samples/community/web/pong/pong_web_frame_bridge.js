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

/*
 * WebFrame Communication Layer
 *
 * SECURITY NOTE: To prevent cross-site message interception, we must explicitly
 * specify the targetOrigin when using window.parent.postMessage().
 * We extract this from the '?origin=' query parameter supplied by the A2UI host.
 * Failing to explicitly set this origin would allow any malicious parent site
 * to silently intercept sensitive messages and data sent from this iframe.
 */
const PARENT_ORIGIN = (() => {
  const urlParams = new URLSearchParams(window.location.search);
  const originParam = urlParams.get('origin');
  if (originParam) {
    return originParam;
  }

  const isSrcdocOrSandboxed =
    window.location.origin === 'null' ||
    window.location.protocol === 'about:' ||
    window.location.protocol === 'data:';

  if (isSrcdocOrSandboxed) {
    console.log(
      'A2UI Web Frame: Running in srcdoc/sandboxed mode without "?origin="; defaulting target origin to "*".',
    );
    return '*';
  }

  console.error(
    'A2UI Web Frame: Missing required "?origin=" parameter in URL mode. Refusing to broadcast postMessage to "*".',
  );
  return 'null';
})();

const MSG_TYPE_ACTION = 'a2ui_action';
const MSG_TYPE_DATA_MODEL_CHANGE = 'a2ui_data_model_change';
const MSG_TYPE_FUNCTION_CALL = 'a2ui_function_call';
const MSG_TYPE_FUNCTION_RESULT = 'a2ui_function_result';
const MSG_TYPE_APP_FRAME_INIT = 'a2ui_app_frame_init';
const MSG_TYPE_HOST_CONTEXT_UPDATE = 'a2ui_host_context_update';
const MSG_TYPE_DATA_MODEL_UPDATE = 'a2ui_data_model_update';
const MSG_TYPE_APP_FRAME_READY = 'a2ui_app_frame_ready';

let localPlayerScore = 0;
let localCpuScore = 0;
let winningScore;

let functionCallId = 0;
let appPort = null;

function validateAppPort() {
  if (!appPort) {
    throw new Error('A2UI Protocol Violation: appPort is not initialized.');
  }
}

function dispatchAction(action, data = {}) {
  validateAppPort();
  const msg = {type: MSG_TYPE_ACTION, action, data};
  appPort.postMessage(msg);
}

function dispatchDataModelChange(key, subpath, value) {
  validateAppPort();
  const msg = {type: MSG_TYPE_DATA_MODEL_CHANGE, key, subpath, value};
  appPort.postMessage(msg);
}

function dispatchFunctionCall(call, args = {}) {
  validateAppPort();
  // Capture a local reference to ensure the listener is cleaned up on the correct port instance
  // even if the global appPort is reassigned while this call is pending.
  const port = appPort;
  const callId = String(++functionCallId);
  const msg = {type: MSG_TYPE_FUNCTION_CALL, call, callId, args};
  port.postMessage(msg);

  return new Promise((resolve, reject) => {
    const listener = event => {
      if (event.data?.type === MSG_TYPE_FUNCTION_RESULT && event.data?.callId === callId) {
        port.removeEventListener('message', listener);
        if (event.data.status === 'success') {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data.error?.message || 'Error'));
        }
      }
    };
    port.addEventListener('message', listener);
    port.start();
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

function applyInitialPayload(data) {
  const configData = data.value.config;
  const matchingScore = configData?.matchingScore;
  if (typeof matchingScore === 'number' && matchingScore > 0) {
    winningScore = matchingScore;
  }
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
}

function handleHostContextUpdate(data) {
  if (data.value.containerDimensions) {
    applyContainerDimensions(data.value.containerDimensions);
  }
}

function handleDataModelUpdate(data) {
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
      if (typeof isPaused !== 'undefined' && isPaused) {
        isPaused = false;
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
}

function configureAppPort(port) {
  if (appPort) {
    appPort.close();
  }
  appPort = port;

  // Stop listening to window messages once the MessagePort is established
  window.removeEventListener('message', handleWindowMessage);

  // 2. Subsequent messages over the port do NOT need origin checks
  appPort.addEventListener('message', portEvent => {
    const portData = portEvent.data;
    if (portData?.type === MSG_TYPE_HOST_CONTEXT_UPDATE) {
      handleHostContextUpdate(portData);
    } else if (portData?.type === MSG_TYPE_DATA_MODEL_UPDATE) {
      handleDataModelUpdate(portData);
    }
  });
  appPort.start();
}

function handleWindowMessage(event) {
  // 1. Initial Handshake MUST still verify origin!
  if (PARENT_ORIGIN !== '*' && event.origin !== PARENT_ORIGIN) {
    return; // Ignore messages from untrusted origins
  }

  const data = event.data;
  if (data?.type === MSG_TYPE_APP_FRAME_INIT) {
    if (!event.ports || !event.ports[0]) {
      const errorMsg =
        'A2UI Protocol Violation: Host failed to provide a MessagePort during initialization. Ambient postMessage will be ignored by the host.';
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    configureAppPort(event.ports[0]);
    applyInitialPayload(data);
  } else {
    console.warn(
      `A2UI Web Frame: Ignored ambient message of type "${data?.type}" received before MSG_TYPE_APP_FRAME_INIT.`,
    );
  }
}

window.addEventListener('message', handleWindowMessage);

// Initialize
window.parent.postMessage({type: MSG_TYPE_APP_FRAME_READY}, PARENT_ORIGIN);
