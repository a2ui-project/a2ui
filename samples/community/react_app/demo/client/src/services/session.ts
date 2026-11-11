/*
 * Copyright 2026 Google LLC
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
 * The conversation: turns, their A2UI surfaces, latency checkpoints and bridge logs. One
 * `MessageProcessor` renders every surface of the conversation; each surface belongs to the turn
 * that created it.
 */
import type {ReactAppBridgeEvent, ReactAppTimings} from '@a2ui-labs/react-app';
import type {ReactCatalogComponent} from '@a2ui/react';
import {MessageProcessor, type ActionPayload} from '@a2ui/web_core/v1_0';
import {catalogs} from '../a2ui/catalogs';
import {
  sendRendererMessage,
  streamChat,
  type AgentEvent,
  type ChatRequest,
  type TurnDebug,
} from './agent_client';
import {BridgeLog} from './bridge_log';

/** The latency checkpoints of docs/use_cases.md. */
export const CHECKPOINTS = [
  {id: 'T0', label: 'Request sent', where: 'client'},
  {id: 'T1', label: 'First token', where: 'agent'},
  {id: 'T2', label: 'First A2UI message', where: 'client'},
  {id: 'T3', label: 'Native components painted', where: 'client'},
  {id: 'T4', label: 'ReactApp source complete', where: 'agent'},
  {id: 'T5', label: 'Iframe ready', where: 'client'},
  {id: 'T6', label: 'App initialized', where: 'client'},
  {id: 'T7', label: 'ui/rendered', where: 'client'},
  {id: 'T8', label: 'Stream complete', where: 'client'},
] as const;

export type CheckpointId = (typeof CHECKPOINTS)[number]['id'];

/** Agent checkpoint names, as the `timing` events send them. */
const AGENT_CHECKPOINTS: Record<string, CheckpointId> = {
  firstToken: 'T1',
  reactAppSource: 'T4',
};

export interface TurnState {
  readonly id: string;
  readonly kind: 'prompt' | 'action';
  /** The prompt, or a label for the action. */
  readonly prompt: string;
  readonly status: 'streaming' | 'done' | 'error';
  readonly text: string;
  readonly surfaceIds: readonly string[];
  /** Set while the model writes a ReactApp that hasn't arrived yet. */
  readonly pendingApp: {readonly title: string | null; readonly height: number | null} | null;
  readonly retries: ReadonlyArray<{readonly attempt: number; readonly errors: readonly string[]}>;
  readonly error: string | null;
  readonly debug: TurnDebug | null;
  /** Checkpoints, in `performance.now()` milliseconds. */
  readonly marks: Readonly<Partial<Record<CheckpointId, number>>>;
  /** Timings the first app frame reported with `ui/rendered`. */
  readonly frameTimings: ReactAppTimings | null;
  readonly model: string | null;
  readonly mode: string | null;
}

/** Converts an epoch-milliseconds agent timestamp to this page's `performance.now()` clock. */
function toPerformanceTime(epochMs: number): number {
  return epochMs - performance.timeOrigin;
}

function humanize(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** The conversation store, read by React through `useSyncExternalStore`. */
export class DemoSession {
  readonly conversationId = crypto.randomUUID();
  readonly processor: MessageProcessor<ReactCatalogComponent>;
  private turns: readonly TurnState[] = [];
  private readonly bridgeLogs = new Map<string, BridgeLog>();
  private readonly initializeIds = new Map<string, number | string>();
  private readonly listeners = new Set<() => void>();
  private activeTurnId: string | null = null;
  private nextTurn = 1;

  constructor() {
    this.processor = new MessageProcessor<ReactCatalogComponent>(
      catalogs,
      action => this.sendAction(action),
      {outboundListener: message => this.forwardToAgent(message)},
    );
    this.processor.model.onSurfaceCreated.subscribe(surface => {
      const turnId = this.activeTurnId;
      if (turnId) {
        this.update(turnId, turn => ({...turn, surfaceIds: [...turn.surfaceIds, surface.id]}));
      }
    });
    this.processor.model.onSurfaceDeleted.subscribe(surfaceId => {
      this.turns = this.turns.map(turn =>
        turn.surfaceIds.includes(surfaceId)
          ? {...turn, surfaceIds: turn.surfaceIds.filter(id => id !== surfaceId)}
          : turn,
      );
      this.notify();
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getTurns = (): readonly TurnState[] => this.turns;

  get busy(): boolean {
    return this.activeTurnId !== null;
  }

  /** The bridge log of a turn's ReactApps. */
  bridgeLog(turnId: string): BridgeLog {
    let log = this.bridgeLogs.get(turnId);
    if (!log) {
      log = new BridgeLog();
      this.bridgeLogs.set(turnId, log);
    }
    return log;
  }

  /** Sends a user prompt. */
  send(text: string): Promise<void> {
    return this.runTurn('prompt', text, {conversationId: this.conversationId, text});
  }

  /** Sends a button press from a surface as a new turn. */
  sendAction(action: ActionPayload): Promise<void> {
    return this.runTurn('action', humanize(action.name), {
      conversationId: this.conversationId,
      action: action as unknown as Record<string, unknown>,
    });
  }

  /** Records a bridge event from a turn's ReactApp element, and the checkpoints it marks. */
  recordBridgeEvent(turnId: string, event: ReactAppBridgeEvent): void {
    const entry = this.bridgeLog(turnId).record(event);
    if (event.type === 'ready') {
      this.mark(turnId, 'T5', event.time);
    } else if (event.type === 'rendered') {
      this.mark(turnId, 'T7', entry.time);
      this.update(turnId, turn =>
        turn.frameTimings ? turn : {...turn, frameTimings: event.timings},
      );
    } else if (event.type === 'message') {
      const message = event.message as {method?: string; id?: number | string; result?: unknown};
      if (event.direction === 'in' && message.method === 'reactApp/initialize') {
        this.initializeIds.set(turnId, message.id ?? '');
      } else if (
        event.direction === 'out' &&
        message.result !== undefined &&
        message.id === this.initializeIds.get(turnId)
      ) {
        this.mark(turnId, 'T6', event.time);
      }
    }
  }

  private async runTurn(kind: TurnState['kind'], prompt: string, request: ChatRequest) {
    if (this.activeTurnId) {
      return;
    }
    const id = `turn-${this.nextTurn++}`;
    this.activeTurnId = id;
    this.turns = [
      ...this.turns,
      {
        id,
        kind,
        prompt,
        status: 'streaming',
        text: '',
        surfaceIds: [],
        pendingApp: null,
        retries: [],
        error: null,
        debug: null,
        marks: {T0: performance.now()},
        frameTimings: null,
        model: null,
        mode: null,
      },
    ];
    this.notify();
    try {
      await streamChat(request, event => this.handleEvent(id, event));
      this.update(id, turn => (turn.status === 'streaming' ? {...turn, status: 'done'} : turn));
    } catch (error) {
      this.update(id, turn => ({
        ...turn,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      this.mark(id, 'T8', performance.now());
      this.activeTurnId = null;
      this.notify();
    }
  }

  private handleEvent(turnId: string, event: AgentEvent): void {
    switch (event.type) {
      case 'turn':
        this.update(turnId, turn => ({...turn, model: event.data.model, mode: event.data.mode}));
        break;
      case 'timing': {
        const checkpoint = AGENT_CHECKPOINTS[event.data.checkpoint];
        if (checkpoint) {
          this.mark(turnId, checkpoint, toPerformanceTime(event.data.at));
        }
        break;
      }
      case 'text':
        this.update(turnId, turn => ({...turn, text: turn.text + event.data.text}));
        break;
      case 'a2ui':
        this.processA2ui(turnId, event.data.message);
        break;
      case 'app_pending':
        this.update(turnId, turn => ({
          ...turn,
          pendingApp: {title: event.data.title, height: event.data.height},
        }));
        break;
      case 'retry':
        this.update(turnId, turn => ({
          ...turn,
          text: '',
          pendingApp: null,
          retries: [...turn.retries, {attempt: event.data.attempt, errors: event.data.errors}],
        }));
        break;
      case 'debug':
        this.update(turnId, turn => ({...turn, debug: event.data}));
        break;
      case 'error':
        this.update(turnId, turn => ({
          ...turn,
          status: 'error',
          pendingApp: null,
          error: [event.data.message, ...(event.data.errors ?? [])].join('\n'),
        }));
        break;
      case 'done':
        break;
    }
  }

  private processA2ui(turnId: string, message: Record<string, unknown>): void {
    this.mark(turnId, 'T2', performance.now());
    try {
      this.processor.processMessages([message as never]);
    } catch (error) {
      console.error('[demo] Rejected A2UI message', message, error);
      return;
    }
    const body = (message['updateComponents'] ?? message['createSurface']) as
      {components?: Array<{component?: string}>} | undefined;
    const components = body?.components ?? [];
    if (components.length > 0) {
      const marks = this.turns.find(turn => turn.id === turnId)?.marks;
      if (marks && marks.T3 === undefined) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => this.mark(turnId, 'T3', performance.now())),
        );
      }
    }
    if (components.some(component => component.component === 'ReactApp')) {
      this.update(turnId, turn => ({...turn, pendingApp: null}));
    }
  }

  private forwardToAgent(message: unknown): void {
    if (!message || typeof message !== 'object' || !('callAgentFunction' in message)) {
      return;
    }
    sendRendererMessage(this.conversationId, message).then(
      replies => this.processor.processMessages(replies as never),
      error => console.error('[demo] Agent function call failed', error),
    );
  }

  private mark(turnId: string, checkpoint: CheckpointId, time: number): void {
    this.update(turnId, turn =>
      turn.marks[checkpoint] === undefined
        ? {...turn, marks: {...turn.marks, [checkpoint]: time}}
        : turn,
    );
  }

  private update(turnId: string, change: (turn: TurnState) => TurnState): void {
    let changed = false;
    this.turns = this.turns.map(turn => {
      if (turn.id !== turnId) {
        return turn;
      }
      const next = change(turn);
      changed ||= next !== turn;
      return next;
    });
    if (changed) {
      this.notify();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
