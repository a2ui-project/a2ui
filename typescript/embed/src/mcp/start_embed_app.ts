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

// Must stay the first import; see zod_jitless.ts.
import {ZOD_JITLESS} from './zod_jitless.js';
import {App, type McpUiHostContext} from '@modelcontextprotocol/ext-apps';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {LitComponentApi} from '@a2ui/lit';
import type {ActionPayload, Catalog} from '@a2ui/web_core/v1_0';
import {ACTION_TOOL_NAME, type ActionCall} from '../contract/action_call.js';
import {readEmbedPayload} from '../contract/embed_payload.js';
import {MAX_IN_FLIGHT_CALLS, TaskQueue} from './action_queue.js';
import {keepDialogsVisible} from './dialog_height.js';
import {EmbedView} from './embed_view.js';
import {DEFAULT_MODEL_CONTEXT_MAX_BYTES, ModelContextSync} from './model_context.js';
import {SurfaceSession} from './surface_session.js';
import {applyHostContext, injectEmbedStyles} from './theme.js';

/** Options of {@link startEmbedApp}. */
export interface StartEmbedAppOptions {
  /** The catalogs the app renders with. Every catalog a tool result names must be here. */
  catalogs: Catalog<LitComponentApi>[];
  /** The name and version the app reports to the host. */
  appInfo?: {name: string; version: string}; // Optional (default: {name: 'a2ui-embed', version: '1.0.0'})
  /** The element the app renders into. */
  root?: HTMLElement; // Optional (default: document.body)
  /** How the app shares the data models of `sendDataModel` surfaces with the model. */
  modelContext?: ModelContextOptions; // Optional (default: {maxBytes: 16384})
}

/** Options of the model context updates, see {@link StartEmbedAppOptions.modelContext}. */
export interface ModelContextOptions {
  /**
   * The limit on the JSON of the data models in one update, in bytes. Data models above it are
   * left out, largest first, and named instead.
   */
  maxBytes?: number; // Optional (default: 16384)
}

/** A running app, returned by {@link startEmbedApp}. */
export interface EmbedAppHandle {
  /** The MCP Apps connection to the host. */
  readonly app: App;
  /** Settles once the host handshake is done; rejects if it fails. */
  readonly ready: Promise<void>;
  /** Disconnects from the host and removes the app's elements. */
  close(): Promise<void>;
}

const DEFAULT_APP_INFO = {name: 'a2ui-embed', version: '1.0.0'};

/**
 * Starts an MCP App that renders the A2UI payload of its tool result.
 *
 * The app connects to the host, follows the host theme, and renders the A2UI v1.0 messages in
 * `structuredContent.a2ui` of each tool result with the given catalogs. A2UI actions call the
 * server's `a2ui_action` tool; its messages update the surfaces in place, and its follow-up text
 * is posted to the conversation when the host supports `ui/message`. Invalid payloads show an
 * error card instead of the surfaces; a text-only result shows nothing.
 */
export function startEmbedApp({
  catalogs,
  appInfo = DEFAULT_APP_INFO,
  root = document.body,
  modelContext: {maxBytes = DEFAULT_MODEL_CONTEXT_MAX_BYTES} = {},
}: StartEmbedAppOptions): EmbedAppHandle {
  void ZOD_JITLESS;
  injectEmbedStyles(root.ownerDocument);
  const view = new EmbedView(root);
  const stopKeepingDialogsVisible = keepDialogsVisible(root);
  const app = new App(appInfo, {}, {autoResize: true});
  const actions = new TaskQueue(MAX_IN_FLIGHT_CALLS, busy => view.setBusy(busy));
  let session: SurfaceSession | undefined;
  const modelContextSync = new ModelContextSync(text => {
    if (!app.getHostCapabilities()?.updateModelContext) return;
    // The context is a hint for the model's next turn; a failed update leaves nothing to show.
    app
      .updateModelContext({content: text === undefined ? [] : [{type: 'text', text}]})
      .catch(() => {});
  }, maxBytes);

  const replaceSession = (next: SurfaceSession | undefined) => {
    modelContextSync.clear();
    session?.dispose();
    session = next;
  };

  const showToolResult = (result: CallToolResult) => {
    if (result.isError) {
      replaceSession(undefined);
      view.showStatus({kind: 'error', title: 'The tool failed', message: textOf(result)});
      return;
    }
    const read = readEmbedPayload(result);
    if (!read.ok && read.code === 'missing') {
      // A text-only result is legitimate: the tool chose to return no view. Show nothing, so the
      // app reports its size as 0 and the host can collapse the frame.
      replaceSession(undefined);
      view.showStatus({kind: 'empty'});
      return;
    }
    if (!read.ok) {
      replaceSession(undefined);
      view.showStatus({
        kind: 'error',
        title:
          read.code === 'unsupported-version'
            ? 'This view needs a different version of the app'
            : 'This view could not be shown',
        message: read.message,
      });
      return;
    }
    const next: SurfaceSession = new SurfaceSession(
      catalogs,
      action => {
        void runAction(next, action);
      },
      () => modelContextSync.schedule(() => next.sharedDataModels),
    );
    try {
      next.apply(read.payload.messages);
    } catch (error) {
      next.dispose();
      replaceSession(undefined);
      view.showStatus({
        kind: 'error',
        title: 'This view could not be shown',
        message: errorText(error),
      });
      return;
    }
    const rerender = () => view.update();
    next.processor.onSurfaceCreated(rerender);
    next.processor.onSurfaceDeleted(() => {
      rerender();
      modelContextSync.refresh(() => next.sharedDataModels);
    });
    view.showSurfaces(() => next.surfaces);
    replaceSession(next);
  };

  const runAction = async (origin: SurfaceSession, action: ActionPayload) => {
    const call: ActionCall = {
      name: action.name,
      surfaceId: action.surfaceId,
      context: action.context,
      ...(action.sourceComponentId ? {sourceComponentId: action.sourceComponentId} : {}),
    };
    let result: CallToolResult;
    try {
      result = await actions.run(() =>
        app.callServerTool({name: ACTION_TOOL_NAME, arguments: call}),
      );
    } catch (error) {
      if (origin === session) view.setNotice(`The action failed: ${errorText(error)}`);
      return;
    }
    // A newer tool result replaced the surfaces the action came from.
    if (origin !== session) return;
    if (result.isError) {
      view.setNotice(`The action failed: ${textOf(result)}`);
      return;
    }
    const read = readEmbedPayload(result);
    if (!read.ok) {
      // A result without A2UI content has nothing to apply.
      if (read.code !== 'missing') view.setNotice(`The action failed: ${read.message}`);
      return;
    }
    try {
      // The user triggered the action, so its data model changes update the model context.
      origin.apply(read.payload.messages, {userCaused: true});
    } catch (error) {
      view.setNotice(`The update could not be shown: ${errorText(error)}`);
      return;
    }
    view.update();
    const followUp = read.payload.followUp?.text;
    if (followUp && app.getHostCapabilities()?.message) {
      try {
        await app.sendMessage({role: 'user', content: [{type: 'text', text: followUp}]});
      } catch (error) {
        view.setNotice(`The follow-up could not be sent: ${errorText(error)}`);
      }
    }
  };

  // Handlers go in before connect(), so no notification sent right after the handshake is lost.
  app.ontoolinput = () => {
    if (!session) view.showStatus({kind: 'loading'});
  };
  app.ontoolresult = showToolResult;
  app.ontoolcancelled = () => {
    if (!session) view.showStatus({kind: 'cancelled'});
  };
  app.onhostcontextchanged = (context: McpUiHostContext) => applyHostContext(context);
  app.onteardown = () => {
    replaceSession(undefined);
    return {};
  };

  const ready = app.connect().then(
    () => applyHostContext(app.getHostContext()),
    (error: unknown) => {
      view.showStatus({
        kind: 'error',
        title: 'Could not connect to the host',
        message: errorText(error),
      });
      throw error;
    },
  );
  // Callers that do not await `ready` still see the failure in the error card.
  ready.catch(() => {});

  return {
    app,
    ready,
    async close() {
      replaceSession(undefined);
      stopKeepingDialogsVisible();
      view.dispose();
      await app.close();
    },
  };
}

function textOf(result: CallToolResult): string {
  const text = result.content
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n');
  return text || 'No details were given.';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
