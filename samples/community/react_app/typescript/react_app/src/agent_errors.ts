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
 * Turns app errors into A2UI v1.0 renderer-to-agent `error` payloads, so the agent learns that
 * the app it wrote failed (bridge protocol section 7.1).
 */

import type {ReactAppError} from './react_app_bridge.js';

/** The `code` of every app error the element reports to the agent. */
export const REACT_APP_ERROR_CODE = 'REACT_APP_ERROR';

/** The `ui/error` phases the element reports to the agent; `bridge` errors stay in the page. */
export const AGENT_REPORTED_PHASES: ReadonlySet<string> = new Set([
  'compile',
  'load',
  'render',
  'runtime',
  'csp',
]);

/** Most app errors one element reports to the agent per minute, across app documents. */
export const MAX_AGENT_ERRORS_PER_MINUTE = 3;

/** Longest `message` sent to the agent; longer ones are cut. */
const MAX_MESSAGE_LENGTH = 1000;

/**
 * The body of a v1.0 renderer-to-agent `error` message for an app error: the generic branch of
 * `specification/v1_0/json/renderer_to_agent.json`, with the extra fields the agent needs to
 * repair the app.
 */
export interface ReactAppAgentError {
  readonly code: typeof REACT_APP_ERROR_CODE;
  readonly message: string;
  readonly surfaceId: string;
  readonly componentId: string;
  readonly phase: string;
  readonly line?: number;
  readonly column?: number;
  /** Allows assignment to web_core's `A2uiErrorPayload`, which has an index signature. */
  readonly [key: string]: unknown;
}

/** Where an app error happened. */
export interface ReactAppErrorTarget {
  readonly surfaceId: string;
  readonly componentId: string;
}

/** Builds the agent error payload of an app error. */
export function toAgentError(
  error: ReactAppError,
  target: ReactAppErrorTarget,
): ReactAppAgentError {
  const where = error.line === undefined ? '' : ` at line ${error.line}`;
  const message = `The ReactApp ${target.componentId} failed in phase ${error.phase}${where}: ${error.message}`;
  return {
    code: REACT_APP_ERROR_CODE,
    message:
      message.length > MAX_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
        : message,
    surfaceId: target.surfaceId,
    componentId: target.componentId,
    phase: error.phase,
    ...(error.line === undefined ? {} : {line: error.line}),
    ...(error.column === undefined ? {} : {column: error.column}),
  };
}

/**
 * Decides which app errors of one element reach the agent: only the phases in
 * {@link AGENT_REPORTED_PHASES}, the first such error of each app document, and at most
 * {@link MAX_AGENT_ERRORS_PER_MINUTE} per minute. An app that crashes keeps failing the same way,
 * so one report per document tells the agent everything, and the limit stops a host that reloads
 * apps quickly from flooding it.
 */
export class AgentErrorReporter {
  private lastReportedDocument: string | null = null;
  private readonly sentAt: number[] = [];

  constructor(
    private readonly send: (error: ReactAppAgentError) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /**
   * Sends `error` to the agent unless the rules above drop it. `appDocument` identifies the app
   * document that failed. Returns whether it sent the error.
   */
  report(error: ReactAppError, appDocument: string, target: ReactAppErrorTarget): boolean {
    if (!AGENT_REPORTED_PHASES.has(error.phase) || appDocument === this.lastReportedDocument) {
      return false;
    }
    const time = this.now();
    while (this.sentAt.length > 0 && time - this.sentAt[0] >= 60_000) {
      this.sentAt.shift();
    }
    if (this.sentAt.length >= MAX_AGENT_ERRORS_PER_MINUTE) {
      return false;
    }
    this.sentAt.push(time);
    this.lastReportedDocument = appDocument;
    this.send(toAgentError(error, target));
    return true;
  }
}
