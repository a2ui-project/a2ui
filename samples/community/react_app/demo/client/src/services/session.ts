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
  type AppErrorReport,
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
  /** `repair` turns ask the agent to fix an app that failed in the browser. */
  readonly kind: 'prompt' | 'action' | 'repair';
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
  /** Problems the page saw after the agent answered: app errors, rejected messages. */
  readonly problems: readonly string[];
  /** Surfaces a later turn rewrote; they now show in that turn. */
  readonly superseded: readonly string[];
}

/** How long a turn may stream before the client gives up. */
const TURN_TIMEOUT_MS = 180_000;
/** How long an agent function call may take before the app gets an error. */
const AGENT_CALL_TIMEOUT_MS = 10_000;

/**
 * A random conversation id. `crypto.randomUUID` only exists in secure contexts, and the demo is
 * also opened over plain HTTP by machine name, so this falls back to `getRandomValues`.
 */
function newConversationId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
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
  readonly conversationId = newConversationId();
  readonly processor: MessageProcessor<ReactCatalogComponent>;
  private turns: readonly TurnState[] = [];
  private readonly bridgeLogs = new Map<string, BridgeLog>();
  private readonly initializeIds = new Map<string, number | string>();
  private readonly listeners = new Set<() => void>();
  private activeTurnId: string | null = null;
  private nextTurn = 1;
  /** The turn that shows each surface, and the one that showed it before it was deleted. */
  private readonly owner = new Map<string, string>();
  private readonly previousOwner = new Map<string, string>();
  /** Surfaces the agent is restoring after a failed attempt, and the turn they go back to. */
  private readonly restoring = new Map<string, string>();
  /** Turns that already asked the agent for a repair. */
  private readonly repairRequested = new Set<string>();

  constructor() {
    this.processor = new MessageProcessor<ReactCatalogComponent>(
      catalogs,
      action => this.sendAction(action),
      {outboundListener: message => this.forwardToAgent(message)},
    );
    // Errors surfaces report (an app that failed, a sandbox that stopped it) go to the agent,
    // which tells the model at the start of the next turn.
    this.processor.model.onError.subscribe(
      error =>
        void sendRendererMessage(this.conversationId, {version: '1.0', error}).catch(
          () => undefined,
        ),
    );
    this.processor.model.onSurfaceCreated.subscribe(surface => this.surfaceCreated(surface.id));
    this.processor.model.onSurfaceDeleted.subscribe(surfaceId => this.surfaceDeleted(surfaceId));
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

  /**
   * Records an app that failed in the browser: the turn shows it, and the agent gets one chance
   * to repair it in a new turn. Repair turns don't ask again, so a broken fix can't loop.
   */
  recordAppError(turnId: string, report: AppErrorReport): void {
    this.addProblem(turnId, `The app failed (${report.phase}): ${report.message}`);
    const turn = this.turns.find(candidate => candidate.id === turnId);
    if (turn && turn.kind !== 'repair' && !this.repairRequested.has(turnId) && !this.busy) {
      this.repairRequested.add(turnId);
      void this.runTurn('repair', 'Fix the app error', {
        conversationId: this.conversationId,
        appError: report,
      });
    }
    // Otherwise the element already reported the error to the agent through the surface.
  }

  /** Records that the sandbox stopped an app (for example, the app tried to navigate away). */
  recordSandboxError(turnId: string, error: {code: string; message: string}): void {
    this.addProblem(turnId, `The sandbox stopped the app: ${error.message}`);
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
        problems: [],
        superseded: [],
      },
    ];
    this.notify();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);
    let finished = false;
    try {
      await streamChat(
        request,
        event => {
          finished ||= event.type === 'done';
          this.handleEvent(id, event);
        },
        abort.signal,
      );
      this.update(id, turn => {
        if (turn.status !== 'streaming') {
          return turn;
        }
        return finished
          ? {...turn, status: 'done'}
          : {...turn, status: 'error', error: 'The agent stopped answering before the turn ended.'};
      });
    } catch (error) {
      this.update(id, turn => ({
        ...turn,
        status: 'error',
        pendingApp: null,
        error: abort.signal.aborted
          ? 'The agent took too long to answer.'
          : error instanceof Error
            ? error.message
            : String(error),
      }));
    } finally {
      clearTimeout(timer);
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
      case 'restore_surface': {
        const {surfaceId} = event.data;
        const target = this.previousOwner.get(surfaceId) ?? this.owner.get(surfaceId);
        if (target) {
          this.restoring.set(surfaceId, target);
        }
        break;
      }
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
      const reason = error instanceof Error ? error.message : String(error);
      console.warn('[demo] Rejected A2UI message', message, error);
      this.addProblem(turnId, `The page rejected a message from the agent: ${reason}`);
      this.reportToAgent('MESSAGE_REJECTED', null, reason);
      return;
    }
    const body = (message['updateComponents'] ?? message['createSurface']) as
      | {components?: Array<{component?: string}>}
      | undefined;
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

  /**
   * Sends the processor's outbound messages to the agent. An agent function call that fails or
   * takes too long is answered locally with an error, so the app's `function/call` settles.
   */
  private forwardToAgent(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    if ('error' in message) {
      void sendRendererMessage(this.conversationId, message).catch(() => undefined);
      return;
    }
    if (!('callAgentFunction' in message)) {
      return;
    }
    const call = (message as {callAgentFunction: {functionCallId?: string}}).callAgentFunction;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), AGENT_CALL_TIMEOUT_MS);
    sendRendererMessage(this.conversationId, message, abort.signal)
      .then(
        replies => this.processor.processMessages(replies as never),
        (error: unknown) => {
          const reason = abort.signal.aborted
            ? `The agent didn't answer within ${AGENT_CALL_TIMEOUT_MS / 1000} s.`
            : `The agent couldn't be reached: ${error instanceof Error ? error.message : String(error)}`;
          this.processor.processMessages([
            {
              version: '1.0',
              agentFunctionResponse: {
                functionCallId: call.functionCallId ?? '',
                error: {code: 'AGENT_UNAVAILABLE', message: reason},
              },
            } as never,
          ]);
        },
      )
      .finally(() => clearTimeout(timer));
  }

  /** Tells the agent about a problem on the page; it hears about it on the next turn. */
  private reportToAgent(code: string, surfaceId: string | null, message: string): void {
    void sendRendererMessage(this.conversationId, {
      version: '1.0',
      error: {code, message, ...(surfaceId ? {surfaceId} : {})},
    }).catch(() => undefined);
  }

  private addProblem(turnId: string, problem: string): void {
    this.update(turnId, turn =>
      turn.problems.includes(problem) ? turn : {...turn, problems: [...turn.problems, problem]},
    );
  }

  /** A new surface belongs to the turn it's restored to, or else to the streaming turn. */
  private surfaceCreated(surfaceId: string): void {
    const restoredTo = this.restoring.get(surfaceId);
    this.restoring.delete(surfaceId);
    const target = restoredTo ?? this.activeTurnId;
    if (!target) {
      return;
    }
    this.owner.set(surfaceId, target);
    this.update(target, turn => ({
      ...turn,
      surfaceIds: turn.surfaceIds.includes(surfaceId)
        ? turn.surfaceIds
        : [...turn.surfaceIds, surfaceId],
      superseded: turn.superseded.filter(id => id !== surfaceId),
    }));
    const before = this.previousOwner.get(surfaceId);
    if (!restoredTo && before && before !== target) {
      this.update(before, turn => ({...turn, superseded: [...turn.superseded, surfaceId]}));
    }
  }

  /** A deleted surface leaves its turn, unless the agent is about to restore it there. */
  private surfaceDeleted(surfaceId: string): void {
    const turnId = this.owner.get(surfaceId);
    if (!turnId) {
      return;
    }
    if (this.restoring.get(surfaceId) === turnId) {
      this.notify();
      return;
    }
    this.owner.delete(surfaceId);
    this.previousOwner.set(surfaceId, turnId);
    this.update(turnId, turn => ({
      ...turn,
      surfaceIds: turn.surfaceIds.filter(id => id !== surfaceId),
    }));
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
