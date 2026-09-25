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
 * The MCP App of the real-frame scenarios, written against the MCP Apps App SDK the way a real
 * app is. `scripts/build-test-fixtures.mjs` bundles it into `tests/fixtures/generated/`, and the
 * scenarios inline the bundle into the `htmlContent` of a `McpApp` component.
 *
 * The app reports everything it observes through tool calls, which the host turns into actions
 * when the tool is allowed, so the tests never reach into the sandboxed frame:
 *
 * - `app_ready`: sent once the handshake completed, with what the host announced.
 * - `data_seen`: one per `ui/notifications/data-model-update` for a key other than `command`.
 * - `tool_result`, `function_result`, `navigate_top_result`: the outcome of a command.
 *
 * Commands reach the app as JSON strings written to the bound `command` key:
 *
 * - `{kind: 'call_tool', name, args}`: calls the tool and reports the result or the error.
 * - `{kind: 'call_function', call, callId, args}`: sends `ui/requests/function-call`.
 * - `{kind: 'set', key, subpath?, value}`: sends `ui/notifications/data-model-change`.
 * - `{kind: 'resize', width?, height?}`: sends `ui/notifications/size-changed`.
 * - `{kind: 'navigate_top', url}`: tries to navigate the top window and reports the outcome.
 *
 * Every command carries a `seq` number so that a repeated update of the same command is run once.
 */

import {App} from '@modelcontextprotocol/ext-apps';
import type {Protocol} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {Notification, Request, Result} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

const DataModelUpdateNotificationSchema = z.object({
  method: z.literal('ui/notifications/data-model-update'),
  params: z.object({key: z.string(), subpath: z.string().optional(), value: z.unknown()}),
});

const FunctionCallResultSchema = z
  .object({status: z.literal('success'), result: z.unknown()})
  .passthrough();

interface Command {
  readonly kind: string;
  readonly seq: number;
  readonly [key: string]: unknown;
}

const app = new App({name: 'A2UI McpApp test app', version: '1.0.0'}, {}, {autoResize: false});
// The App SDK types close the request and notification unions over the standard methods; the
// protocol underneath sends any method, which is how the A2UI extension messages go out.
const protocol: Pick<Protocol<Request, Notification, Result>, 'request' | 'notification'> = app;

let lastSeq = 0;

function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {message: String(error)};
  }
  const described: Record<string, unknown> = {name: error.name, message: error.message};
  const code = (error as {code?: unknown}).code;
  if (typeof code === 'number') {
    described['code'] = code;
  }
  return described;
}

/** Reports an observation as a tool call; the host dispatches it as an action of that name. */
function report(name: string, args: Record<string, unknown>): void {
  app.callServerTool({name, arguments: args}).catch(() => {
    // The host refused the report; nothing else to do inside the sandbox.
  });
}

async function callTool(name: string, args: Record<string, unknown>): Promise<void> {
  try {
    const result = await app.callServerTool({name, arguments: args});
    report('tool_result', {name, status: 'success', result});
  } catch (error) {
    report('tool_result', {name, status: 'error', error: describeError(error)});
  }
}

async function callFunction(
  call: string,
  callId: string,
  args: Record<string, unknown> | undefined,
): Promise<void> {
  try {
    const response = await protocol.request(
      {method: 'ui/requests/function-call', params: {call, args}},
      FunctionCallResultSchema,
    );
    report('function_result', {call, callId, status: response.status, result: response.result});
  } catch (error) {
    report('function_result', {call, callId, status: 'error', error: describeError(error)});
  }
}

function setData(key: string, subpath: string | undefined, value: unknown): void {
  const params: Record<string, unknown> = {key, value};
  if (subpath !== undefined) {
    params['subpath'] = subpath;
  }
  protocol.notification({method: 'ui/notifications/data-model-change', params}).catch(error => {
    report('unknown_command', {kind: 'set', error: describeError(error)});
  });
}

function navigateTop(url: string): void {
  try {
    window.top!.location.href = url;
    report('navigate_top_result', {blocked: false});
  } catch (error) {
    report('navigate_top_result', {blocked: true, error: describeError(error)['name']});
  }
}

function runCommand(command: Command): void {
  switch (command.kind) {
    case 'call_tool':
      void callTool(String(command['name']), (command['args'] as Record<string, unknown>) ?? {});
      break;
    case 'call_function':
      void callFunction(
        String(command['call']),
        String(command['callId']),
        command['args'] as Record<string, unknown> | undefined,
      );
      break;
    case 'set':
      setData(String(command['key']), command['subpath'] as string | undefined, command['value']);
      break;
    case 'resize':
      void app.sendSizeChanged({
        width: command['width'] as number | undefined,
        height: command['height'] as number | undefined,
      });
      break;
    case 'navigate_top':
      navigateTop(String(command['url']));
      break;
    default:
      report('unknown_command', {kind: command.kind});
  }
}

function onCommand(value: unknown): void {
  if (typeof value !== 'string' || value === '') {
    return;
  }
  const command = JSON.parse(value) as Command;
  if (command.seq <= lastSeq) {
    return;
  }
  lastSeq = command.seq;
  runCommand(command);
}

app.setNotificationHandler(DataModelUpdateNotificationSchema, ({params}) => {
  if (params.key === 'command') {
    onCommand(params.value);
    return;
  }
  const seen: Record<string, unknown> = {key: params.key, value: params.value};
  if (params.subpath !== undefined) {
    seen['subpath'] = params.subpath;
  }
  report('data_seen', seen);
});

app
  .connect()
  .then(() => {
    report('app_ready', {
      hostInfo: app.getHostVersion(),
      hostCapabilities: app.getHostCapabilities(),
      hostContext: app.getHostContext(),
      location: {href: window.location.href},
      sandboxed: window.origin === 'null',
    });
  })
  .catch((error: unknown) => {
    document.body.textContent = `Failed to connect: ${describeError(error)['message']}`;
  });
